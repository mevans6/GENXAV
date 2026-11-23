import {beforeEach,describe,it,expect,vi} from 'vitest';
import {requestContext} from '../server/cookies';
const {rpc,upsert,flush}=vi.hoisted(()=>({rpc:vi.fn(),upsert:vi.fn(),flush:vi.fn()}));
vi.mock('../server/lib/server',async(importOriginal)=>({...await importOriginal<any>(),db:()=>({rpc,from:()=>({upsert})}),rateLimit:vi.fn()}));
vi.mock('../server/lib/consulting',()=>({flushConsultingNotifications:flush}));
vi.mock('../server/integrator-notifications',()=>({flushIntegratorNotifications:flush}));
import {POST} from '../server/routes/intake/route';
import {submit} from '../server/integrator';
import {GET as admin} from '../server/routes/integrator-leads/route';
const payload={id:crypto.randomUUID(),name:'Synthetic test',email:'test@example.com',phone:'7042477074',location:'Charlotte, NC',need:'Reviewing an AV proposal',description:'Please review my proposed residential system scope.',attachments:[],consent:true};
function request(data:any,origin='https://genxav.com'){return new Request('https://genxav.com/api/consulting/intake',{method:'POST',headers:{'Content-Type':'application/json',origin},body:JSON.stringify(data)})}
function run(fn:any,req:Request){return requestContext.run({request:req,cookies:[]},()=>fn(req))}
beforeEach(()=>{process.env.NEXT_PUBLIC_SITE_URL='https://genxav.com';rpc.mockReset().mockResolvedValue({data:payload.id,error:null});upsert.mockReset().mockResolvedValue({data:null,error:null});flush.mockReset().mockResolvedValue({sent:1})});
describe('ported request boundaries',()=>{
 it('persists free consulting intake before attempting email',async()=>{const response=await run(POST,request(payload));expect(response.status).toBe(201);expect(rpc).toHaveBeenCalledWith('submit_consulting_request',expect.objectContaining({p_id:payload.id,p_name:payload.name,p_attachments:[]}));expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(flush.mock.invocationCallOrder[0])});
 it('keeps a saved request successful when its durable email queue must retry',async()=>{flush.mockRejectedValue(new Error('provider down'));expect((await run(POST,request(payload))).status).toBe(201)});
 it('never reports success when persistence fails',async()=>{rpc.mockResolvedValue({data:null,error:{message:'database down'}});expect((await run(POST,request(payload))).status).toBe(503);expect(flush).not.toHaveBeenCalled()});
 it('rejects cross-origin submissions',async()=>{expect((await run(POST,request(payload,'https://other.example'))).status).toBe(403);expect(rpc).not.toHaveBeenCalled()});
 it('requires explicit intake consent',async()=>{expect((await run(POST,request({...payload,consent:false}))).status).toBe(400);expect(rpc).not.toHaveBeenCalled()});
 it('rejects honeypot content',async()=>{expect((await run(POST,request({...payload,website:'spam'}))).status).toBe(400);expect(rpc).not.toHaveBeenCalled()});
 it('stores integrator inquiries in a distinct category',async()=>{expect((await run(submit,request(payload))).status).toBe(201);expect(upsert).toHaveBeenCalledWith(expect.objectContaining({lead_category:'integrator',id:payload.id}),{onConflict:'id',ignoreDuplicates:true})});
 it('integrator storage failure is visible to the caller',async()=>{upsert.mockResolvedValue({data:null,error:{message:'offline'}});expect((await run(submit,request(payload))).status).toBe(503)});
 it('does not expose integrator leads without administrator authentication',async()=>{expect((await admin(new Request('https://genxav.com/api/consulting/integrator-leads'))).status).toBe(401)});
});
