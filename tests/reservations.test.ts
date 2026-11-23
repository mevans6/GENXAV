import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { pgSupabase } from './support/pg-supabase';
const fakes=vi.hoisted(()=>({db:null as any,checkout:{sessions:{create:vi.fn(),retrieve:vi.fn(),expire:vi.fn()}},paymentIntents:{retrieve:vi.fn()}}));
vi.mock('../server/lib/server',async original=>({...await original<any>(),db:()=>fakes.db}));
vi.mock('stripe',async original=>{
 const actual=await original<typeof import('stripe')>();
 return {...actual,default:class {checkout=fakes.checkout;paymentIntents=fakes.paymentIntents;webhooks=new actual.default('sk_test_fixture').webhooks;}};
});
import { bookingCorrelation,correlationRequest,validCalendlySignature } from '../server/lib/reservation-policy';
import { receiveCalendlyReservation } from '../server/lib/calendly-reservations';
import { processReservations,recordReservationPayment,schedulerHealthy } from '../server/lib/reservations';
import { POST as webhook } from '../server/routes/webhooks/calendly/route';
import { POST as stripeWebhook } from '../server/routes/webhooks/stripe/route';
import { GET as maintenance } from '../server/routes/maintenance/route';
vi.mock('../server/lib/consulting',async original=>({...await original<any>(),flushConsultingNotifications:vi.fn().mockResolvedValue({sent:0})}));
vi.mock('../server/lib/notifications',()=>({flushNotifications:vi.fn().mockResolvedValue({sent:0}),emailReady:()=>true}));
vi.mock('../server/integrator-notifications',()=>({flushIntegratorNotifications:vi.fn().mockResolvedValue({sent:0})}));

let pg:PGlite;
let sessions:Map<string,any>,resources:Map<string,any>,emails:any[],cancellations:string[],emailDown=false,cancelDown=false;
const type='https://api.calendly.com/event_types/11111111-1111-4111-8111-111111111111';
beforeAll(async()=>{
 pg=new PGlite();
 await pg.exec('create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
 for(const file of ['supabase/reference-migrations/001_initial.sql','supabase/reference-migrations/20261107012503_support_photos_and_notifications.sql','supabase/reference-migrations/20261107201451_consulting_intake.sql','supabase/genx-calendly-paid-booking-link.sql','supabase/migrations/20261122230644_schedule_first_consultations.sql'])await pg.exec(readFileSync(file,'utf8'));
 fakes.db=pgSupabase(pg);
},30000);
afterAll(async()=>{await pg?.close()});
beforeEach(async()=>{
 await pg.exec('truncate public.consulting_reservation_notices,public.consulting_reservation_events,public.consulting_reservations,public.consulting_requests cascade; truncate public.consulting_automation_health;');
 Object.assign(process.env,{NEXT_PUBLIC_SITE_URL:'https://genxav.com',ACCESS_TOKEN_SECRET:'a'.repeat(64),STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture',CALENDLY_WEBHOOK_SIGNING_KEY:'b'.repeat(64),CALENDLY_API_TOKEN:'fixture-token',CALENDLY_RESERVATION_EVENT_TYPE:type,RESERVATION_AUTOMATION_ENABLED:'true',RESEND_API_KEY:'re_fixture',EMAIL_FROM:'test@example.com',SUPPORT_NOTIFY_EMAIL:'owner@example.com',CRON_SECRET:'c'.repeat(64)});
 sessions=new Map();resources=new Map();emails=[];cancellations=[];emailDown=false;cancelDown=false;vi.clearAllMocks();
 fakes.checkout.sessions.create.mockImplementation(async(params:any)=>{
  const id='cs_'+params.metadata.reservation_id;let s=sessions.get(id);
  if(!s){s={id,status:'open',mode:'payment',payment_status:'unpaid',metadata:params.metadata,amount_total:9900,currency:'usd',url:'https://checkout.stripe.com/c/pay/'+id,payment_intent:'pi_'+params.metadata.reservation_id};sessions.set(id,s)}return structuredClone(s);
 });
 fakes.checkout.sessions.retrieve.mockImplementation(async(id:string)=>{if(!sessions.has(id))throw Error('Unknown session');return structuredClone(sessions.get(id))});
 fakes.checkout.sessions.expire.mockImplementation(async(id:string)=>{const s=sessions.get(id);if(s.status!=='open')throw Error('Already complete');s.status='expired';return structuredClone(s)});
 fakes.paymentIntents.retrieve.mockResolvedValue({status:'processing'});
 vi.stubGlobal('fetch',vi.fn(async(input:string,options:any={})=>{
  if(input==='https://api.resend.com/emails'){if(emailDown)return Response.json({error:'unavailable'},{status:503});emails.push(JSON.parse(options.body));return Response.json({id:crypto.randomUUID()})}
  if(input.endsWith('/cancellation')){if(cancelDown)return Response.json({}, {status:503});cancellations.push(input);const r=resources.get(input.replace('/cancellation',''));r.status='canceled';return Response.json({resource:{}})}
  if(resources.has(input))return Response.json({resource:resources.get(input)});
  return Response.json({error:'unknown fixture'},{status:404});
 }));
});
afterEach(()=>{vi.unstubAllGlobals()});
async function fixture(options:{email?:string;noticeHours?:number;approved?:boolean;legacy?:boolean}={}){
 const id=crypto.randomUUID(),event=`https://api.calendly.com/scheduled_events/${crypto.randomUUID()}`,uri=`${event}/invitees/${crypto.randomUUID()}`;
 await pg.query("insert into public.consulting_requests(id,visitor_hash,name,email,location,need,description,review_status,invitation_hash) values($1,'owner','Customer','client@example.com','Charlotte','Advice','Test scope',$2,'hash')",[id,options.approved===false?'new':'approved']);
 if(options.legacy){const cid=crypto.randomUUID();await pg.query("insert into public.support_cases(id,visitor_hash,plan,name,email,issue,token_hash) values($1,'owner','consultation','Customer','client@example.com','Scope','hash')",[cid]);await pg.query('update public.consulting_requests set case_id=$2 where id=$1',[id,cid])}
 const start=new Date(Date.now()+(options.noticeHours??72)*3600000).toISOString();
 const invitee={uri,event,email:options.email||'client@example.com',status:'active',timezone:'America/New_York',created_at:new Date().toISOString(),tracking:{utm_content:bookingCorrelation(id)},old_invitee:null,rescheduled:false};
 resources.set(uri,invitee);resources.set(event,{uri:event,event_type:type,status:'active',start_time:start,end_time:new Date(Date.parse(start)+30*60000).toISOString(),location:{type:'zoom'}});
 return {id,event,uri,invitee};
}
async function register(){const f=await fixture();const id=await receiveCalendlyReservation({uri:f.uri},'invitee.created');return {...f,reservationId:id!}}
async function row(id:string){return (await pg.query<any>('select * from public.consulting_reservations where id=$1',[id])).rows[0]}
async function due(id:string,hoursRemaining:number){await pg.query("update public.consulting_reservations set payment_due_at=now()+$2*interval '1 hour',next_action_at=now(),locked_until='epoch' where id=$1",[id,hoursRemaining])}
function paid(id:string){const s=[...sessions.values()].find(s=>s.metadata.reservation_id===id);s.payment_status='paid';s.status='complete';return s}
function signedWebhook(uri:string,event='invitee.created',valid=true){const raw=JSON.stringify({event,payload:{uri}}),t=Math.floor(Date.now()/1000);const sig=createHmac('sha256',process.env.CALENDLY_WEBHOOK_SIGNING_KEY!).update(`${t}.${raw}`).digest('hex');return new Request('https://genxav.com/api/consulting/webhooks/calendly',{method:'POST',headers:{'calendly-webhook-signature':`t=${t},v1=${valid?sig:'0'.repeat(64)}`},body:raw})}

describe('schedule-first reservation lifecycle',()=>{
 it('verifies a signed booking, persists it, and sends one separate $99 checkout with an exact deadline',async()=>{
  const f=await fixture();expect((await webhook(signedWebhook(f.uri))).status).toBe(200);
  const b=(await pg.query<any>('select * from public.consulting_reservations')).rows[0];
  expect(b.payment_status).toBe('unpaid');expect(emails).toHaveLength(1);expect(emails[0].text).toContain('Pay $99 USD by');expect(emails[0].text).toContain('America/New_York');
  expect(fakes.checkout.sessions.create.mock.calls[0][0]).toMatchObject({mode:'payment',line_items:[{price_data:{unit_amount:9900,currency:'usd'},quantity:1}]});
  expect(fakes.checkout.sessions.create.mock.calls[0][0]).not.toHaveProperty('payment_method_types');
  expect(new Date(b.payment_due_at).getTime()-Date.now()).toBeGreaterThan(11.9*3600000);
  await webhook(signedWebhook(f.uri));expect(emails).toHaveLength(1);expect(fakes.checkout.sessions.create).toHaveBeenCalledTimes(1);
 });
 it('rejects forged, stale and modified signatures before provider access',async()=>{
  const f=await fixture();expect((await webhook(signedWebhook(f.uri,'invitee.created',false))).status).toBe(400);expect(fetch).not.toHaveBeenCalled();
  const raw='{}',t=Math.floor(Date.now()/1000)-181,sig=createHmac('sha256',process.env.CALENDLY_WEBHOOK_SIGNING_KEY!).update(`${t}.${raw}`).digest('hex');
  expect(validCalendlySignature(raw,`t=${t},v1=${sig}`,process.env.CALENDLY_WEBHOOK_SIGNING_KEY!)).toBe(false);
  expect(correlationRequest(bookingCorrelation(f.id).replace(/^./,'0'))).toBeNull();
 });
 it('does not trust a signed event URI that points outside Calendly',async()=>{const req=signedWebhook('https://attacker.example/private');expect((await webhook(req)).status).toBe(400);expect(fetch).not.toHaveBeenCalled()});
 it.each([{email:'someone-else@example.com'},{approved:false},{legacy:true}])('does not bill another email, unapproved intake, or legacy prepaid case: %j',async options=>{const f=await fixture(options);expect(await receiveCalendlyReservation({uri:f.uri},'invitee.created')).toBeNull();expect((await pg.query('select * from public.consulting_reservations')).rows).toHaveLength(0)});
 it('rejects an appointment that lacks 24-hour notice',async()=>{const f=await fixture({noticeHours:8});await expect(receiveCalendlyReservation({uri:f.uri},'invitee.created')).rejects.toThrow();expect((await pg.query('select * from public.consulting_reservations')).rows).toHaveLength(0)});
 it('sends reminders at 6 and 11 hours, once each',async()=>{const f=await register();await processReservations(f.reservationId);await due(f.reservationId,6);await processReservations(f.reservationId);expect(emails.at(-1).subject).toContain('Reminder');await due(f.reservationId,5);await processReservations(f.reservationId);expect(emails).toHaveLength(2);await due(f.reservationId,1);await processReservations(f.reservationId);expect(emails.at(-1).subject).toContain('Final reminder');expect(emails).toHaveLength(3)});
 it('does not send both catch-up reminders after a scheduler gap',async()=>{const f=await register();await processReservations(f.reservationId);await due(f.reservationId,0.5);await processReservations(f.reservationId);expect(emails).toHaveLength(2);expect(emails.at(-1).subject).toContain('Final reminder')});
 it('verifies payment and stops reminders and cancellation even if the webhook repeats',async()=>{const f=await register();await processReservations(f.reservationId);const s=paid(f.reservationId);await recordReservationPayment(s);await recordReservationPayment(s);await processReservations(f.reservationId);expect((await row(f.reservationId)).payment_status).toBe('paid');expect(emails.filter(e=>e.subject.includes('Payment received'))).toHaveLength(1);await due(f.reservationId,-1);await processReservations(f.reservationId);expect(cancellations).toHaveLength(0);expect(emails.filter(e=>e.subject.includes('reminder'))).toHaveLength(0)});
 it('rejects a paid session with the wrong amount, currency, session, or request',async()=>{const f=await register();await processReservations(f.reservationId);const s=paid(f.reservationId);for(const patch of [{amount_total:1},{currency:'eur'},{id:'other'},{metadata:{...s.metadata,request_id:crypto.randomUUID()}}])await expect(recordReservationPayment({...s,...patch})).rejects.toThrow('match');expect((await row(f.reservationId)).payment_status).toBe('unpaid')});
 it('expires checkout before canceling the appointment',async()=>{const f=await register();await processReservations(f.reservationId);await due(f.reservationId,-0.1);await processReservations(f.reservationId);expect((await row(f.reservationId)).appointment_status).toBe('canceled');expect(cancellations).toHaveLength(1);expect(sessions.get((await row(f.reservationId)).stripe_session_id).status).toBe('expired');expect(emails.at(-1).subject).toContain('canceled')});
 it('preserves an appointment when payment wins the expiration race',async()=>{const f=await register();await processReservations(f.reservationId);await due(f.reservationId,-1);fakes.checkout.sessions.expire.mockImplementationOnce(async()=>{paid(f.reservationId);throw Error('Already paid')});await processReservations(f.reservationId);expect((await row(f.reservationId)).payment_status).toBe('paid');expect(cancellations).toHaveLength(0)});
 it('defers cancellation if checkout cannot be safely closed',async()=>{const f=await register();await processReservations(f.reservationId);await due(f.reservationId,-1);fakes.checkout.sessions.expire.mockRejectedValueOnce(Error('network'));expect((await processReservations(f.reservationId)).failed).toBe(1);expect(cancellations).toHaveLength(0);expect((await row(f.reservationId)).appointment_status).toBe('scheduled')});
 it('does not cancel a complete checkout whose payment is processing',async()=>{const f=await register();await processReservations(f.reservationId);const s=[...sessions.values()][0];s.status='complete';await due(f.reservationId,-1);await processReservations(f.reservationId);expect((await row(f.reservationId)).payment_status).toBe('processing');expect(cancellations).toHaveLength(0)});
 it('does not cancel when the initial payment email was never delivered',async()=>{const f=await register();emailDown=true;await processReservations(f.reservationId);emailDown=false;await due(f.reservationId,-1);await processReservations(f.reservationId);expect((await row(f.reservationId)).payment_status).toBe('review');expect(cancellations).toHaveLength(0);expect(emails.at(-1).to).toEqual(['owner@example.com'])});
 it('retries a failed cancellation without claiming it succeeded',async()=>{const f=await register();await processReservations(f.reservationId);await due(f.reservationId,-1);cancelDown=true;await processReservations(f.reservationId);expect((await row(f.reservationId)).appointment_status).toBe('canceling');cancelDown=false;await due(f.reservationId,-1);await processReservations(f.reservationId);expect((await row(f.reservationId)).appointment_status).toBe('canceled')});
 it('records late payment for review without sending a paid appointment confirmation',async()=>{const f=await register();await processReservations(f.reservationId);await due(f.reservationId,-1);await processReservations(f.reservationId);await recordReservationPayment(paid(f.reservationId));await processReservations(f.reservationId);expect((await row(f.reservationId)).payment_status).toBe('review');expect(emails.some(e=>e.subject.includes('Payment received'))).toBe(false);expect(emails.at(-1).subject).toContain('Action required')});
 it('prevents overlapping workers from leasing the same booking',async()=>{const f=await register();const args={p_id:f.reservationId,p_limit:1};const a=await fakes.db.rpc('claim_consulting_reservations',args),b=await fakes.db.rpc('claim_consulting_reservations',args);expect(a.data).toHaveLength(1);expect(b.data).toHaveLength(0)});
 it('counts consecutive failures rather than normal successful reminder polls',async()=>{const f=await register();await processReservations(f.reservationId);expect((await row(f.reservationId)).attempts).toBe(0);for(let i=0;i<7;i++){await due(f.reservationId,8);await processReservations(f.reservationId)}fakes.checkout.sessions.retrieve.mockRejectedValueOnce(Error('temporary outage'));await due(f.reservationId,8);await processReservations(f.reservationId);expect((await row(f.reservationId)).attempts).toBe(1);expect((await row(f.reservationId)).payment_status).toBe('unpaid')});
 it('denies direct browser access to financial records and privileged functions',async()=>{for(const role of ['anon','authenticated']){await pg.exec(`set role ${role}`);await expect(pg.query('select * from public.consulting_reservations')).rejects.toThrow();await expect(pg.query('select * from public.claim_consulting_reservations()')).rejects.toThrow();await pg.exec('reset role')}});
 it('requires authenticated five-minute maintenance before admitting new bookings',async()=>{expect(await schedulerHealthy()).toBe(false);expect((await maintenance(new Request('https://genxav.com/api/consulting/maintenance'))).status).toBe(401);const request=new Request('https://genxav.com/api/consulting/maintenance',{headers:{authorization:'Bearer '+process.env.CRON_SECRET,'x-genxav-scheduler':'five-minute'}});expect((await maintenance(request)).status).toBe(200);expect(await schedulerHealthy()).toBe(true)});
 it('rejects a forged Stripe webhook without fulfilling any booking',async()=>{const r=await stripeWebhook(new Request('https://genxav.com/api/consulting/webhooks/stripe',{method:'POST',headers:{'stripe-signature':'t=1,v1=bad'},body:'{}'}));expect(r.status).toBe(400)});
 it.each(['checkout.session.completed','checkout.session.async_payment_succeeded'])('fulfills %s only through the signed Stripe webhook',async eventType=>{
  const f=await register();await processReservations(f.reservationId);const session=paid(f.reservationId);
  const raw=JSON.stringify({id:'evt_fixture',object:'event',type:eventType,data:{object:session}}),t=Math.floor(Date.now()/1000);
  const sig=createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET!).update(`${t}.${raw}`).digest('hex');
  const response=await stripeWebhook(new Request('https://genxav.com/api/consulting/webhooks/stripe',{method:'POST',headers:{'stripe-signature':`t=${t},v1=${sig}`},body:raw}));
  expect(response.status).toBe(200);expect((await row(f.reservationId)).payment_status).toBe('paid');expect(emails.filter(e=>e.subject.includes('Payment received'))).toHaveLength(1);
 });
 it('handles a full refund arriving before the paid webhook without confirming the refunded appointment',async()=>{
  const f=await register();await processReservations(f.reservationId);const session=paid(f.reservationId);
  fakes.paymentIntents.retrieve.mockResolvedValue({id:session.payment_intent,metadata:session.metadata});
  const charge={id:'ch_fixture',amount:9900,amount_refunded:9900,currency:'usd',payment_intent:session.payment_intent};
  const raw=JSON.stringify({id:'evt_refund',object:'event',type:'charge.refunded',data:{object:charge}}),t=Math.floor(Date.now()/1000),sig=createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET!).update(`${t}.${raw}`).digest('hex');
  expect((await stripeWebhook(new Request('https://genxav.com/api/consulting/webhooks/stripe',{method:'POST',headers:{'stripe-signature':`t=${t},v1=${sig}`},body:raw}))).status).toBe(200);
  await recordReservationPayment(session);expect((await row(f.reservationId)).payment_status).toBe('refunded');expect(emails.some(e=>e.subject.includes('Payment received'))).toBe(false);
 });
 it.each([false,true])('carries the original deadline and payment across a reschedule (paid=%s), ignoring stale cancellations',async wasPaid=>{
  const f=await register();await processReservations(f.reservationId);if(wasPaid){await recordReservationPayment(paid(f.reservationId));await processReservations(f.reservationId)}
  const before=await row(f.reservationId);
  const event=`https://api.calendly.com/scheduled_events/${crypto.randomUUID()}`,uri=`${event}/invitees/${crypto.randomUUID()}`;
  const old=resources.get(f.uri);old.status='canceled';old.rescheduled=true;
  await receiveCalendlyReservation({uri:f.uri},'invitee.canceled');
  const start=new Date(Date.now()+96*3600000).toISOString();resources.set(event,{...resources.get(f.event),uri:event,start_time:start,end_time:new Date(Date.parse(start)+30*60000).toISOString()});
  resources.set(uri,{...old,uri,event,status:'active',old_invitee:f.uri,tracking:{},created_at:new Date().toISOString()});
  expect(await receiveCalendlyReservation({uri},'invitee.created')).toBe(f.reservationId);
  await receiveCalendlyReservation({uri:f.uri},'invitee.canceled');await processReservations(f.reservationId);
  const after=await row(f.reservationId);expect(after.invitee_uri).toBe(uri);expect(after.appointment_status).toBe('scheduled');expect(after.payment_due_at).toEqual(before.payment_due_at);expect(after.stripe_session_id).toBe(before.stripe_session_id);expect(after.payment_status).toBe(wasPaid?'paid':'unpaid');expect(fakes.checkout.sessions.create).toHaveBeenCalledTimes(1);
 });
 it('does not reset a deadline or create a second payment for an unrelated second booking',async()=>{const f=await register();const event=`https://api.calendly.com/scheduled_events/${crypto.randomUUID()}`,uri=`${event}/invitees/${crypto.randomUUID()}`;resources.set(event,{...resources.get(f.event),uri:event});resources.set(uri,{...resources.get(f.uri),uri,event});await expect(receiveCalendlyReservation({uri},'invitee.created')).rejects.toThrow();expect((await pg.query('select * from public.consulting_reservations')).rows).toHaveLength(1)});
});
