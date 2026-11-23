import Stripe from "stripe";
import { checked, db, fail, HttpError } from "@lib/server";
import { paidCheckout, type Plan } from "@lib/security";
import { flushNotifications } from "@lib/notifications";
import { processReservations, recordReservationPayment } from '@lib/reservations';
export async function POST(request: Request) {
  try {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET)
      throw new HttpError(503, "Payments are not configured.");
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const signature = request.headers.get("stripe-signature");
    if (!signature) throw new HttpError(400, "Missing signature.");
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        await request.text(),
        signature,
        process.env.STRIPE_WEBHOOK_SECRET.trim(),
      );
    } catch (error) {
      // Log only a category; SDK error messages can contain the received payload.
      const message = error instanceof Error ? error.message : "";
      console.warn(
        "Stripe signature rejected:",
        message.includes("Timestamp")
          ? "timestamp"
          : message.includes("No signatures found")
            ? "secret_mismatch"
            : "malformed_signature",
      );
      throw new HttpError(400, "Invalid signature.");
    }
    if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      if (charge.amount_refunded === charge.amount && charge.payment_intent) {
        const intent = await stripe.paymentIntents.retrieve(
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent.id,
        );
        const caseId = intent.metadata.case_id;
        if (intent.metadata.flow === 'schedule_first' && intent.metadata.reservation_id) {
          const b=checked(await db().from('consulting_reservations').select('*').eq('id',intent.metadata.reservation_id).single());
          const session=await stripe.checkout.sessions.retrieve(b.stripe_session_id);
          const sessionIntent=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;
          if(sessionIntent!==intent.id || session.metadata?.reservation_id!==b.id || charge.currency!=='usd' || charge.amount!==9900)throw new HttpError(400,'Refund did not match the reservation.');
          // Refund can arrive before the checkout-paid webhook; don't depend on a previously saved intent id.
          checked(await db().from('consulting_reservations').update({payment_status:'refunded',stripe_payment_intent:intent.id,review_reason:'A full refund was recorded. Check Calendly to cancel or arrange the appointment separately.',next_action_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',b.id));
          await processReservations(b.id,1);
        }
        if (caseId)
          checked(
            await db()
              .from("support_cases")
              .update({ payment_status: "refunded", status: "closed" })
              .eq("id", caseId),
          );
      }
      return Response.json({ received: true });
    }
    if (
      ![
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
      ].includes(event.type)
    )
      return Response.json({ received: true });
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.flow === 'schedule_first') {
      if(session.payment_status === 'paid') {
        // Retrieve the session to verify authoritative payment state, amount, and metadata.
        await recordReservationPayment(await stripe.checkout.sessions.retrieve(session.id));
        await processReservations(session.metadata.reservation_id,1);
      }
      return Response.json({received:true});
    }
    if (session.payment_status !== "paid")
      return Response.json({ received: true });
    const id = session.metadata?.case_id;
    if (!id) return Response.json({ received: true });
    const supportCase = checked(
      await db().from("support_cases").select("*").eq("id", id).single(),
    );
    if (
      !supportCase ||
      supportCase.stripe_session_id !== session.id ||
      !paidCheckout(
        session,
        supportCase.plan as Plan,
        id,
        supportCase.expected_amount ?? undefined,
      )
    )
      throw new HttpError(400, "Payment did not match the support request.");
    if (supportCase.payment_status === "refunded")
      return Response.json({ received: true });
    checked(
      await db().rpc("fulfill_checkout", {
        p_case_id: id,
        p_session_id: session.id,
        p_amount: session.amount_total!,
        p_event_id: event.id,
      }),
    );
    await flushNotifications(id);
    return Response.json({ received: true });
  } catch (e) {
    return fail(e);
  }
}
