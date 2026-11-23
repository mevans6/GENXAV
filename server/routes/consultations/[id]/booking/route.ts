import { z } from 'zod';
import { approvedRequest } from '@lib/consulting';
import { body, checked, db, fail, HttpError, rateLimit, supportConfig } from '@lib/server';
import { CalendlyError, createConsultationLink } from '@lib/calendly';
import { bookingCorrelation, reservationEventType } from '@lib/reservation-policy';
import { schedulerHealthy } from '@lib/reservations';
export async function POST(request:Request, {params}:{params:Promise<{id:string}>}) {
 try {
  z.object({consent:z.literal(true)}).parse(await body(request));
  await rateLimit(request,'consultation-scheduling',8);
  const {id}=await params;z.uuid().parse(id);
  const intake=await approvedRequest(id);
  if(intake.case_id)throw new HttpError(409,'A previous payment attempt exists. Contact your consultant before booking again.');
  if(!supportConfig(id).consultationAvailable)throw new HttpError(503,'Consultation scheduling is not configured yet.');
  if(!await schedulerHealthy())throw new HttpError(503,'Scheduling is temporarily paused while appointment automation is checked. Contact your consultant.');
  if(intake.has_reservation)throw new HttpError(409,'An appointment already exists for this request. Use your latest Calendly confirmation to manage it.');
  // Separate fields keep old native-paid booking links out of the new free flow.
  if(intake.reservation_booking_url)return Response.json({url:intake.reservation_booking_url});
  const claimed=checked(await db().from('consulting_requests').update({reservation_booking_pending:true}).eq('id',id).eq('review_status','approved').eq('reservation_booking_pending',false).is('reservation_booking_url',null).select('id'));
  if(!claimed.length)throw new HttpError(409,'Your scheduling link is being prepared. Try again shortly or contact your consultant.');
  try {
   const url=new URL(await createConsultationLink(reservationEventType(),true,true));
   url.searchParams.set('utm_source','genxav');url.searchParams.set('utm_content',bookingCorrelation(id));
   url.searchParams.set('email',intake.email);url.searchParams.set('name',intake.name);
   const saved=checked(await db().from('consulting_requests').update({reservation_booking_url:url.href,reservation_booking_pending:false,updated_at:new Date().toISOString()}).eq('id',id).eq('review_status','approved').select('id'));
   if(!saved.length)throw new HttpError(409,'Request approval changed. Contact your consultant.');
   return Response.json({url:url.href});
  }catch(error){
   if(error instanceof CalendlyError && error.safeToRetry){checked(await db().from('consulting_requests').update({reservation_booking_pending:false}).eq('id',id));throw new HttpError(503,error.message)}
   throw new HttpError(503,'Scheduling could not be confirmed. Contact your consultant so we can check the link before retrying.');
  }
 }catch(error){return fail(error)}
}
