import {timingSafeEqual} from 'node:crypto';
import {flushConsultingNotifications} from '@lib/consulting';
import {flushNotifications} from '@lib/notifications';
import {flushIntegratorNotifications} from '../../integrator-notifications';
import {processReservations} from '@lib/reservations';
import {checked,db} from '@lib/server';
export async function GET(request:Request){
 const expected=process.env.CRON_SECRET,actual=request.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!expected||!actual||Buffer.byteLength(expected)!==Buffer.byteLength(actual)||!timingSafeEqual(Buffer.from(expected),Buffer.from(actual)))return Response.json({error:'Unauthorized'},{status:401});
 const reservations=await processReservations();
 // Daily fallback calls don't satisfy the five-minute scheduler heartbeat.
 if(request.headers.get('x-genxav-scheduler')==='five-minute')checked(await db().from('consulting_automation_health').upsert({id:true,last_run_at:new Date().toISOString()}));
 return Response.json({reservations,consulting:await flushConsultingNotifications(),paid:await flushNotifications(undefined,20),integrator:await flushIntegratorNotifications()});
}
export const POST=GET;
