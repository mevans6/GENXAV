import { checked, db, HttpError } from './server';
import { correlationRequest, reservationEventType } from './reservation-policy';

const eventPattern = /^https:\/\/api\.calendly\.com\/scheduled_events\/[a-f0-9-]{36}$/;
const inviteePattern = /^https:\/\/api\.calendly\.com\/scheduled_events\/[a-f0-9-]{36}\/invitees\/[a-f0-9-]{36}$/;
export function calendlyResourceUri(value: unknown, kind: 'event' | 'invitee'): value is string {
  return typeof value === 'string' && (kind === 'event' ? eventPattern : inviteePattern).test(value);
}
export async function calendlyResource(uri: string, kind: 'event' | 'invitee'): Promise<any> {
  if (!calendlyResourceUri(uri, kind)) throw new HttpError(400, 'Invalid Calendly resource.');
  if (!process.env.CALENDLY_API_TOKEN) throw new HttpError(503, 'Calendly is not configured.');
  const response = await fetch(uri, { headers: { Authorization: `Bearer ${process.env.CALENDLY_API_TOKEN}` }, signal: AbortSignal.timeout(10000), cache: 'no-store' });
  if (!response.ok) throw new HttpError(503, 'Calendly could not verify the appointment.');
  const { resource } = await response.json();
  if (resource?.uri !== uri) throw new HttpError(503, 'Calendly returned an unexpected appointment.');
  return resource;
}
export async function cancelCalendlyReservation(eventUri: string) {
  const event = await calendlyResource(eventUri, 'event');
  if (event.status === 'canceled') return;
  if (event.event_type !== reservationEventType()) throw new HttpError(409, 'Appointment type changed.');
  const response = await fetch(`${eventUri}/cancellation`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.CALENDLY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'The $99 consultation payment was not received by the stated deadline. Please contact consulting@genxav.com to arrange a new appointment.' }),
    signal: AbortSignal.timeout(15000),
  });
  // A lost response is reconciled with GET on the next retry, never assumed successful.
  if (!response.ok) throw new HttpError(503, 'Appointment cancellation needs another attempt.');
}

export async function receiveCalendlyReservation(payload: { uri: string }, eventName: string) {
  const invitee = await calendlyResource(payload.uri, 'invitee');
  const event = await calendlyResource(invitee.event, 'event');
  if (event.event_type !== reservationEventType()) return null; // Legacy prepaid appointments are untouched.
  if (eventName === 'invitee.canceled' || invitee.status === 'canceled') {
    // Only the current invitee can change this reservation. A stale reschedule cancellation cannot cancel its replacement.
    const rows = checked(await db().from('consulting_reservations').select('id').eq('invitee_uri', invitee.uri));
    if (!rows.length) return null;
    const status = invitee.rescheduled ? 'rescheduling' : 'canceled';
    checked(await db().from('consulting_reservations').update({ appointment_status: status, ...(status === 'canceled' ? { canceled_at: new Date().toISOString(), cancellation_reason: 'Canceled through Calendly' } : {}), next_action_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', rows[0].id).eq('invitee_uri', invitee.uri));
    return rows[0].id as string;
  }
  if (invitee.status !== 'active' || event.status !== 'active') return null;
  let requestId = correlationRequest(invitee.tracking?.utm_content);
  if (!requestId && calendlyResourceUri(invitee.old_invitee, 'invitee')) {
    const previous = checked(await db().from('consulting_reservation_events').select('reservation_id').eq('invitee_uri', invitee.old_invitee).maybeSingle());
    if (previous) requestId = checked(await db().from('consulting_reservations').select('request_id').eq('id', previous.reservation_id).single()).request_id;
  }
  if (!requestId) return null; // A public/forwarded legacy link never creates a payment request.
  const request = checked(await db().from('consulting_requests').select('id,email,review_status,invitation_hash,case_id').eq('id', requestId).maybeSingle());
  if (!request || request.review_status !== 'approved' || !request.invitation_hash || request.case_id || request.email.trim().toLowerCase() !== String(invitee.email).trim().toLowerCase()) return null;
  const start = Date.parse(event.start_time), end = Date.parse(event.end_time), booked = Date.parse(invitee.created_at);
  if (!Number.isFinite(start) || !Number.isFinite(booked) || booked > Date.now() + 120000 || end - start !== 30 * 60000 || event.location?.type !== 'zoom') throw new HttpError(409, 'Appointment requires manual review.');
  const result = await db().rpc('register_consulting_reservation', {
    p_request_id: requestId, p_invitee: invitee.uri, p_event: event.uri, p_start: event.start_time,
    p_timezone: typeof invitee.timezone === 'string' ? invitee.timezone : 'America/New_York', p_booked: invitee.created_at,
    p_old_invitee: calendlyResourceUri(invitee.old_invitee, 'invitee') ? invitee.old_invitee : null,
  });
  return checked(result) as string;
}
