import {checked,db,email} from './lib/server';
export async function flushIntegratorNotifications(){
 if(!process.env.RESEND_API_KEY||!process.env.EMAIL_FROM)return {sent:0,pending:true};
 const rows=checked(await db().from('inquiries').select('id').eq('lead_category','integrator').is('notified_at',null).order('created_at').limit(10));
 let sent=0;
 for(const row of rows){await email('matt@genxav.com','Gen X AV — integrator project intake',`A new integrator inquiry is saved in your private dashboard: ${process.env.NEXT_PUBLIC_SITE_URL}/consulting/admin\nReference: ${row.id}`,`integrator-${row.id}`,"matt@genxav.com");checked(await db().from('inquiries').update({notified_at:new Date().toISOString()}).eq('id',row.id));sent++}
 return {sent,pending:false};
}
