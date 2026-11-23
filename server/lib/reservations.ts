import Stripe from 'stripe';
import { business } from './business';
import { checked, db, email, HttpError } from './server';
import { invitationUrl } from './consulting';
import { calendlyResource, cancelCalendlyReservation } from './calendly-reservations';
import { reservationTime } from './reservation-policy';

export type Reservation = {
  id: string; request_id: string; invitee_uri: string; event_uri: string; starts_at: string; timezone: string;
  booked_at: string; payment_due_at: string; created_at: string; appointment_status: string; payment_status: string;
  stripe_session_id: string | null; stripe_payment_intent: string | null; checkout_url: string | null;
  review_reason: string | null; cancellation_reason: string | null; lock_token: string; attempts: number;
};
export function reservationStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new HttpError(503, 'Payments are not configured.');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}
export function matchingReservationPayment(session: Stripe.Checkout.Session, b: Reservation) {
  return session.id === b.stripe_session_id && session.mode === 'payment' && session.payment_status === 'paid' &&
    session.amount_total === business.consultation.amount && session.currency === 'usd' &&
    session.metadata?.flow === 'schedule_first' && session.metadata.reservation_id === b.id && session.metadata.request_id === b.request_id;
}
export async function recordReservationPayment(session: Stripe.Checkout.Session) {
  const id = session.metadata?.reservation_id;
  if (!id || session.metadata?.flow !== 'schedule_first') return false;
  const b = checked(await db().from('consulting_reservations').select('*').eq('id', id).single()) as Reservation;
  if (!matchingReservationPayment(session, b)) throw new HttpError(400, 'Payment did not match the reservation.');
  const intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
  checked(await db().rpc('record_consulting_payment', { p_id: b.id, p_session: session.id, p_intent: intent, p_amount: session.amount_total }));
  return true;
}

/** Expire first, then retrieve again. A payment completing at the deadline wins. */
export async function closeReservationCheckout(stripe: Stripe, session: Stripe.Checkout.Session) {
  if (session.status === 'open') {
    try { await stripe.checkout.sessions.expire(session.id); }
    catch { /* Expiration can lose a race to payment; authoritative retrieve below decides. */ }
  }
  return stripe.checkout.sessions.retrieve(session.id);
}

async function reservation(id: string) {
  return checked(await db().from('consulting_reservations').select('*').eq('id', id).single()) as Reservation;
}
async function update(b: Reservation, values: Record<string, unknown>) {
  const rows = checked(await db().from('consulting_reservations').update({ ...values, updated_at: new Date().toISOString() }).eq('id', b.id).eq('lock_token', b.lock_token).select('id'));
  if (!rows.length) throw new HttpError(409, 'Reservation is being processed elsewhere.');
}
async function enqueue(b: Reservation, kind: string, deliveryKey = '') {
  checked(await db().from('consulting_reservation_notices').upsert({ reservation_id: b.id, kind, delivery_key: deliveryKey }, { onConflict: 'reservation_id,kind,delivery_key', ignoreDuplicates: true }));
}
async function review(b: Reservation, reason: string) {
  await update(b, { payment_status: 'review', review_reason: reason });
  await enqueue(b, 'operator_review');
}
async function sent(b: Reservation, kind: string) {
  return !!checked(await db().from('consulting_reservation_notices').select('sent_at').eq('reservation_id', b.id).eq('kind', kind).eq('delivery_key', '').maybeSingle())?.sent_at;
}

function noticeText(kind: string, b: Reservation, name: string) {
  const time = reservationTime(b.starts_at, b.timezone), due = reservationTime(b.payment_due_at, b.timezone);
  const page = invitationUrl(b.request_id);
  const policy = 'Your appointment is reserved pending payment. The calendar invitation and Zoom link alone do not confirm a paid consultation. Unpaid reservations are canceled after the payment deadline.';
  if (kind === 'paid_customer') return { subject: 'Payment received — your Gen X AV consultation', text: `Hello ${name},\n\nYour $99 payment is verified. Your 30-minute consultation is confirmed for ${time}.\n\nUse the Zoom details in your current Calendly confirmation. Manage your appointment through that confirmation.\n\nPrivate appointment status: ${page}\n\nContact consulting@genxav.com with questions.` };
  if (kind === 'paid_operator') return { subject: 'Paid consultation confirmed', text: `A $99 consultation payment is verified. Review reservation ${b.id} at ${process.env.NEXT_PUBLIC_SITE_URL}/consulting/admin. Appointment: ${time}.` };
  if (kind === 'operator_review') return { subject: 'Action required — consultation reservation', text: `Reservation ${b.id} requires review. ${b.review_reason || 'The reservation could not be safely automated.'}\n\nAppointment: ${time}\n\nReview ${process.env.NEXT_PUBLIC_SITE_URL}/consulting/admin and check Stripe and Calendly before changing payment or booking status. Do not charge again without reconciling the existing payment.` };
  if (kind === 'canceled_customer') return { subject: 'Your Gen X AV reservation was canceled', text: `Hello ${name},\n\nThe reservation for ${time} has been canceled. ${b.cancellation_reason || 'Please check your Calendly confirmation for details.'}\n\nAny unpaid checkout link has been closed. If you have already paid, or payment is still processing, contact consulting@genxav.com so we can arrange the next step or review a refund. Please do not pay again through an old link.\n\nPrivate appointment status: ${page}` };
  if (kind === 'rescheduled_customer') return { subject: 'Your Gen X AV consultation time changed', text: `Hello ${name},\n\nYour consultation is now scheduled for ${time}. Use the latest Calendly confirmation for Zoom details.\n\n${b.payment_status === 'paid' ? 'Your existing $99 payment carries over; no new payment is needed.' : `The original payment deadline remains ${due}. ${policy}\n\nPayment and status: ${page}`}\n\nContact consulting@genxav.com with questions.` };
  return { subject: kind === 'payment_request' ? 'Payment required — retain your Gen X AV appointment' : kind === 'reminder_11h' ? 'Final reminder — consultation payment due' : 'Reminder — consultation payment due', text: `Hello ${name},\n\n${kind === 'payment_request' ? 'Your 30-minute consultation is reserved' : 'Your $99 consultation payment is still outstanding'} for ${time}.\n\nPay $99 USD by ${due}:\n${b.checkout_url}\n\n${policy}\n\n${kind === 'reminder_11h' ? 'This is the final scheduled reminder before cancellation.\n\n' : ''}Appointment status: ${page}\n\nIf you have already paid, contact consulting@genxav.com; do not pay twice. This consultation purchases advice and time, not a guaranteed repair.` };
}

async function deliverNotices(b: Reservation) {
  const customer = checked(await db().from('consulting_requests').select('name,email').eq('id', b.request_id).single());
  const notices = checked(await db().from('consulting_reservation_notices').select('*').eq('reservation_id', b.id).is('sent_at', null).order('created_at'));
  for (const notice of notices) {
    const current = await reservation(b.id);
    const paymentNotice = ['payment_request', 'reminder_6h', 'reminder_11h'].includes(notice.kind);
    const eligible = paymentNotice ? current.payment_status === 'unpaid' && current.appointment_status === 'scheduled' && !!current.checkout_url && Date.parse(current.payment_due_at) > Date.now()
      : notice.kind.startsWith('paid_') ? current.payment_status === 'paid' && current.appointment_status === 'scheduled'
      : notice.kind === 'canceled_customer' ? current.appointment_status === 'canceled'
      : notice.kind === 'operator_review' ? !!current.review_reason
      : notice.kind === 'rescheduled_customer' ? current.appointment_status === 'scheduled' && current.invitee_uri === notice.delivery_key : false;
    if (eligible) {
      // Skip an old 6-hour reminder if the final reminder is due; never send a catch-up burst.
      if (!(notice.kind === 'reminder_6h' && Date.now() >= Date.parse(current.payment_due_at) - 3600000)) {
        const content = noticeText(notice.kind, current, customer.name);
        const operator = ['paid_operator', 'operator_review'].includes(notice.kind);
        await email(operator ? process.env.SUPPORT_NOTIFY_EMAIL! : customer.email, content.subject, content.text, `reservation-${notice.id}`);
      }
    }
    checked(await db().from('consulting_reservation_notices').update({ sent_at: new Date().toISOString() }).eq('id', notice.id));
  }
}

async function makeCheckout(stripe: Stripe, b: Reservation) {
  const customer = checked(await db().from('consulting_requests').select('email').eq('id', b.request_id).single());
  if (Date.parse(b.payment_due_at) - Date.now() < 31 * 60000 || Date.parse(b.starts_at) <= Date.parse(b.payment_due_at)) {
    await review(b, 'Payment setup was delayed. No unpaid appointment was automatically canceled without a usable payment request. Contact the client to arrange a deadline.');
    return null;
  }
  const metadata = { flow: 'schedule_first', reservation_id: b.id, request_id: b.request_id };
  const session = await stripe.checkout.sessions.create({
    mode: 'payment', customer_email: customer.email, client_reference_id: b.id,
    line_items: [{ price_data: { currency: 'usd', unit_amount: business.consultation.amount, product_data: { name: 'Gen X AV — 30-Minute Consultation' } }, quantity: 1 }],
    expires_at: Math.floor(Date.parse(b.payment_due_at) / 1000), metadata, payment_intent_data: { metadata },
    success_url: invitationUrl(b.request_id), cancel_url: invitationUrl(b.request_id),
    integration_identifier: 'genxav_reservations_qmrtwzla',
  }, { idempotencyKey: `genxav-reservation-${b.id}` });
  if (!session.url || new URL(session.url).origin !== 'https://checkout.stripe.com') throw new HttpError(503, 'Payment link could not be verified.');
  await update(b, { stripe_session_id: session.id, checkout_url: session.url });
  return session;
}

async function reconcile(stripe: Stripe, b: Reservation, session: Stripe.Checkout.Session) {
  if (session.payment_status === 'paid') {
    await recordReservationPayment(session);
    return 'paid';
  }
  if (session.status === 'complete') {
    const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!intentId) { await review(b, 'Completed checkout has no verifiable payment intent.'); return 'review'; }
    const intent = await stripe.paymentIntents.retrieve(intentId);
    if (['processing', 'requires_action', 'succeeded'].includes(intent.status)) {
      await update(b, { payment_status: 'processing', stripe_payment_intent: intentId });
      if (Date.now() > Date.parse(b.payment_due_at) + 24 * 3600000) await review(b, 'Payment is still processing after the deadline. Check Stripe before canceling or charging again.');
      return 'processing';
    }
    // Failed asynchronous payments have no reusable Checkout Session. Operator handles re-payment safely.
    await review(b, 'The attempted payment did not complete. Contact the client to arrange payment or cancellation.');
    return 'review';
  }
  return 'unpaid';
}

async function processOne(stripe: Stripe, claimed: Reservation) {
  let b = await reservation(claimed.id);
  if (b.payment_status === 'review' || b.payment_status === 'refunded') {
    if (b.review_reason) await enqueue(b, 'operator_review');
    await deliverNotices(b); return true;
  }
  let session = b.stripe_session_id ? await stripe.checkout.sessions.retrieve(b.stripe_session_id) : null;
  if (session) await reconcile(stripe, b, session);
  b = await reservation(b.id);
  if (b.appointment_status === 'rescheduling') {
    if (Date.now() > Date.parse(b.payment_due_at)) await review(b, 'A reschedule has not completed. Check Calendly and payment before taking action.');
    await deliverNotices(await reservation(b.id)); return false;
  }
  if (b.appointment_status === 'canceled') {
    if (session && b.payment_status === 'unpaid') {
      session = await closeReservationCheckout(stripe, session);
      await reconcile(stripe, b, session);
    }
    b = await reservation(b.id);
    if (['paid', 'processing'].includes(b.payment_status)) {
      await update(b, { review_reason: 'The appointment was canceled with a paid or processing payment. Arrange a new time or review a refund.' });
      await enqueue(b, 'operator_review');
    }
    await enqueue(b, 'canceled_customer');
    await deliverNotices(await reservation(b.id));
    return b.payment_status !== 'processing';
  }
  if (b.payment_status === 'paid') { await deliverNotices(b); return true; }
  if (b.payment_status === 'processing' || b.payment_status === 'review') { await deliverNotices(b); return b.payment_status === 'review'; }
  if (!session) session = await makeCheckout(stripe, b);
  b = await reservation(b.id);
  if (!session || b.payment_status === 'review') { await deliverNotices(b); return true; }
  if (Date.now() >= Date.parse(b.payment_due_at) || b.appointment_status === 'canceling') {
    session = await closeReservationCheckout(stripe, session);
    const payment = await reconcile(stripe, b, session);
    if (payment !== 'unpaid') { await deliverNotices(await reservation(b.id)); return payment === 'paid' || payment === 'review'; }
    if (session.status !== 'expired') throw new HttpError(503, 'Checkout has not safely closed; cancellation deferred.');
    if (!await sent(b, 'payment_request')) {
      await review(b, 'The initial payment email was not delivered. Contact the client before canceling.');
      await deliverNotices(await reservation(b.id)); return true;
    }
    // Calendly may have rescheduled before its webhook arrives. Verify the invitee before canceling.
    const invitee = await calendlyResource(b.invitee_uri, 'invitee');
    if (invitee.status === 'canceled' && invitee.rescheduled) {
      await update(b, { appointment_status: 'rescheduling' }); return false;
    }
    const claim = checked(await db().from('consulting_reservations').update({ appointment_status: 'canceling' }).eq('id', b.id).eq('lock_token', b.lock_token).eq('payment_status', 'unpaid').in('appointment_status', ['scheduled', 'canceling']).select('id'));
    if (!claim.length) return false;
    await cancelCalendlyReservation(b.event_uri);
    // Concurrent payment webhooks must never turn a canceled reservation into a paid confirmation.
    await update(b, { appointment_status: 'canceled', canceled_at: new Date().toISOString(), cancellation_reason: 'The $99 payment was not received by the stated deadline.' });
    b = await reservation(b.id);
    if (b.payment_status !== 'unpaid') {
      await review(b, 'Payment changed during cancellation. Check Stripe and arrange service or a refund.');
    }
    await enqueue(b, 'canceled_customer');
    await deliverNotices(await reservation(b.id)); return true;
  }
  if (session.status === 'expired') {
    await review(b, 'Checkout expired before the payment deadline. Contact the client; no automatic cancellation was made.');
    await deliverNotices(await reservation(b.id)); return true;
  }
  const elapsed = Date.now() - (Date.parse(b.payment_due_at) - 12 * 3600000);
  if (elapsed >= 11 * 3600000) await enqueue(b, 'reminder_11h');
  else if (elapsed >= 6 * 3600000) await enqueue(b, 'reminder_6h');
  await deliverNotices(b);
  return false;
}

export async function processReservations(id?: string, limit = 5) {
  if (process.env.RESERVATION_AUTOMATION_ENABLED !== 'true') return { processed: 0, failed: 0, disabled: true };
  const stripe = reservationStripe();
  const rows = checked(await db().rpc('claim_consulting_reservations', { p_id: id || null, p_limit: limit })) as Reservation[];
  let processed = 0, failed = 0;
  for (const b of rows) {
    let terminal = false;
    let retryFailed = false;
    try { terminal = await processOne(stripe, b); processed++; }
    catch {
      retryFailed = true;
      failed++; console.warn('Consultation reservation queued for retry.', b.id);
      if(b.attempts>=6) {
        try {
          await review(b,'Repeated provider or delivery failures prevented safe automation. Check Stripe, Calendly, and email delivery before changing this reservation.');
          await deliverNotices(await reservation(b.id));terminal=true;
        } catch { /* Keep the durable operator notice pending until email recovers. */ }
      }
    }
    checked(await db().from('consulting_reservations').update({ locked_until: new Date(0).toISOString(), ...(!retryFailed ? {attempts:0} : {}), next_action_at: terminal ? '9999-01-01T00:00:00Z' : new Date(Date.now() + 5 * 60000).toISOString() }).eq('id', b.id).eq('lock_token', b.lock_token));
  }
  return { processed, failed };
}

export async function schedulerHealthy() {
  const health = checked(await db().from('consulting_automation_health').select('last_run_at').eq('id', true).maybeSingle());
  return !!health && Date.now() - Date.parse(health.last_run_at) < 15 * 60000;
}
