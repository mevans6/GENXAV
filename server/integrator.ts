import { z } from 'zod';
import {adapt} from './adapter';
import {body,checked,db,fail,rateLimit,admin} from './lib/server';
import {flushIntegratorNotifications} from './integrator-notifications';
export async function submit(request:Request) {
 try {
  if(request.method!=='POST')return Response.json({error:'Method not allowed'},{status:405,headers:{Allow:'POST'}});
  const input=z.object({id:z.uuid(),name:z.string().trim().min(1).max(120),email:z.email().max(254),phone:z.string().trim().min(1).max(80),company:z.string().trim().max(160).default(''),platform:z.string().trim().max(160).default(''),timeline:z.string().trim().max(80).default(''),description:z.string().trim().min(12).max(4000),website:z.string().max(0).default('')}).parse(await body(request));
  await rateLimit(request,'genx-integrator-intake',5);
  checked(await db().from('inquiries').upsert({id:input.id,name:input.name,email:input.email,lead_category:'integrator',message:`Phone: ${input.phone}\nCompany: ${input.company}\nPlatform: ${input.platform}\nTimeline: ${input.timeline}\n\n${input.description}`},{onConflict:'id',ignoreDuplicates:true}));
  try{await flushIntegratorNotifications()}catch{console.warn('Integrator notification queued.');}
  return Response.json({ok:true,reference:input.id},{status:201});
 }catch(error){return fail(error)}
}
export default adapt(submit);
