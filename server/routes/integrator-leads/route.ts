import {admin,checked,db,fail} from '@lib/server';
export async function GET(request:Request){try{await admin(request);return Response.json({leads:checked(await db().from('inquiries').select('id,name,email,message,created_at,notified_at').eq('lead_category','integrator').order('created_at',{ascending:false}).limit(100))})}catch(e){return fail(e)}}
