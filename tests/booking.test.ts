import {beforeEach,it,expect,vi} from 'vitest';
const {approved,createLink,from,available,updates,eq,healthy}=vi.hoisted(()=>({approved:vi.fn(),createLink:vi.fn(),from:vi.fn(),available:vi.fn(),updates:vi.fn(),eq:vi.fn(),healthy:vi.fn()}));
vi.mock('../server/lib/reservations',()=>({schedulerHealthy:healthy}));
vi.mock('../server/lib/consulting',()=>({approvedRequest:approved}));
vi.mock('../server/lib/calendly',()=>({createConsultationLink:createLink,CalendlyError:class extends Error{constructor(message:string,public safeToRetry:boolean){super(message)}}}));
vi.mock('../server/lib/server',async(importOriginal)=>({...await importOriginal<any>(),db:()=>({from}),supportConfig:available,rateLimit:vi.fn()}));
import {POST} from '../server/routes/consultations/[id]/booking/route';
import {POST as oldCheckout} from '../server/routes/consultations/[id]/checkout/route';
const id=crypto.randomUUID();
function request(consent=true){return new Request(`https://genxav.com/api/consulting/consultations/${id}/booking`,{method:'POST',headers:{origin:'https://genxav.com','Content-Type':'application/json'},body:JSON.stringify({consent})})}
const context={params:Promise.resolve({id})};
beforeEach(()=>{
 process.env.NEXT_PUBLIC_SITE_URL='https://genxav.com';process.env.CALENDLY_RESERVATION_EVENT_TYPE='https://api.calendly.com/event_types/free-event';process.env.ACCESS_TOKEN_SECRET='a'.repeat(64);healthy.mockReset().mockResolvedValue(true);
 approved.mockReset().mockResolvedValue({id,case_id:null,reservation_booking_url:null,email:'client@example.com',name:'Client'});available.mockReset().mockReturnValue({consultationAvailable:true});createLink.mockReset().mockResolvedValue('https://calendly.com/d/single-use');updates.mockReset();eq.mockReset();
 from.mockReset().mockImplementation(()=>{const q:any={update:vi.fn(v=>{updates(v);return q}),eq:vi.fn((...args)=>{eq(...args);return q}),is:vi.fn(()=>q),select:vi.fn(async()=>({data:[{id}],error:null}))};return q});
});
it('uses a free Zoom event and signs the intake correlation before storing a single-use link',async()=>{const r=await POST(request(),context);expect(r.status).toBe(200);expect(createLink).toHaveBeenCalledWith(process.env.CALENDLY_RESERVATION_EVENT_TYPE,true,true);expect(eq).toHaveBeenCalledWith('reservation_booking_pending',false);const url=new URL((await r.json()).url);expect(url.searchParams.get('utm_content')).toMatch(new RegExp(`^${id}\\.[a-f0-9]{64}$`));expect(url.searchParams.get('email')).toBe('client@example.com');expect(updates).toHaveBeenCalledWith(expect.objectContaining({reservation_booking_url:expect.stringContaining('https://calendly.com/d/single-use'),reservation_booking_pending:false}))});
it('returns the same saved single-use link without creating another',async()=>{approved.mockResolvedValue({case_id:null,reservation_booking_url:'https://calendly.com/d/existing'});expect(await (await POST(request(),context)).json()).toEqual({url:'https://calendly.com/d/existing'});expect(createLink).not.toHaveBeenCalled()});
it('does not send existing prepaid or pending-checkout customers to a second paywall',async()=>{approved.mockResolvedValue({case_id:'legacy-case'});expect((await POST(request(),context)).status).toBe(409);expect(createLink).not.toHaveBeenCalled()});
it('blocks scheduling until payment and automation setup is ready',async()=>{available.mockReturnValue({consultationAvailable:false});expect((await POST(request(),context)).status).toBe(503);expect(createLink).not.toHaveBeenCalled()});
it('blocks scheduling when the five-minute scheduler heartbeat is stale',async()=>{healthy.mockResolvedValue(false);expect((await POST(request(),context)).status).toBe(503);expect(createLink).not.toHaveBeenCalled()});
it('does not issue a second link when a reservation already exists',async()=>{approved.mockResolvedValue({has_reservation:true});expect((await POST(request(),context)).status).toBe(409);expect(createLink).not.toHaveBeenCalled()});
it('checks invitation approval before creating a link',async()=>{approved.mockRejectedValue(Error('unapproved'));expect((await POST(request(),context)).status).toBe(503);expect(createLink).not.toHaveBeenCalled()});
it('requires consent',async()=>{expect((await POST(request(false),context)).status).toBe(400);expect(createLink).not.toHaveBeenCalled()});
it('retires the separate website checkout',async()=>{expect((await oldCheckout()).status).toBe(410)});
it('retains the claim for operator reconciliation after an ambiguous provider failure',async()=>{createLink.mockRejectedValue(Error('response lost'));expect((await POST(request(),context)).status).toBe(503);expect(updates.mock.calls).toEqual([[{reservation_booking_pending:true}]])});
