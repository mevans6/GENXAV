import { fail, HttpError } from '@lib/server';
import { validCalendlySignature } from '@lib/reservation-policy';
import { calendlyResourceUri, receiveCalendlyReservation } from '@lib/calendly-reservations';
import { processReservations } from '@lib/reservations';

export async function POST(request: Request) {
  try {
    const key = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
    if (!key || process.env.RESERVATION_AUTOMATION_ENABLED !== 'true') throw new HttpError(503, 'Booking automation is not configured.');
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 256000) throw new HttpError(413, 'Webhook is too large.');
    if (!validCalendlySignature(raw, request.headers.get('calendly-webhook-signature'), key)) throw new HttpError(400, 'Invalid signature.');
    let event;
    try { event = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid payload.'); }
    if (!['invitee.created', 'invitee.canceled'].includes(event.event)) return Response.json({ received: true });
    if (!calendlyResourceUri(event.payload?.uri, 'invitee')) throw new HttpError(400, 'Invalid appointment.');
    const id = await receiveCalendlyReservation(event.payload, event.event);
    if (id) await processReservations(id, 1);
    return Response.json({ received: true });
  } catch (error) { return fail(error); }
}
