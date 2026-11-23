import { z } from "zod";
import { approvedRequest } from "@lib/consulting";
import { checked, db, fail, supportConfig } from "@lib/server";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    z.uuid().parse(id);
    const r = await approvedRequest(id);
    const reservation = r.has_reservation ? checked(await db().from('consulting_reservations').select('appointment_status,payment_status,starts_at,payment_due_at,timezone,checkout_url').eq('request_id',id).maybeSingle()) : null;
    const payable = reservation?.appointment_status === 'scheduled' && reservation.payment_status === 'unpaid' && Date.parse(reservation.payment_due_at) > Date.now();
    const c = r.case_id
      ? checked(
          await db()
            .from("support_cases")
            .select("id,payment_status,stripe_session_id")
            .eq("id", r.case_id)
            .maybeSingle(),
        )
      : null;
    return Response.json(
      {
        name: r.name,
        need: r.need,
        description: r.description,
        paymentStatus: c?.payment_status || "pending",
        ticketUrl: c?.payment_status === "paid" ? `/consulting/ticket/${c.id}` : null,
        available: supportConfig(id).consultationAvailable && !c && !reservation,
        previousCheckout: !!c,
        reservation: reservation ? {...reservation,checkout_url:payable ? reservation.checkout_url : null} : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
