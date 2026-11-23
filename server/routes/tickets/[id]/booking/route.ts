import { body, checked, db, fail, HttpError, rateLimit } from "@lib/server";
import { privateTicket } from "@lib/tickets";
import { CalendlyError, createConsultationLink } from "@lib/calendly";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await body(request);
    await rateLimit(request, "booking", 15);
    const { id } = await params;
    const t = await privateTicket(id);
    if (t.status === "closed")
      throw new HttpError(
        403,
        "This request is closed. Please contact the service.",
      );
    if (!["video", "consultation"].includes(t.plan))
      throw new HttpError(403, "A paid video consultation is required.");
    if (t.booking_url) return Response.json({ url: t.booking_url });
    const claimed = checked(
      await db()
        .from("support_cases")
        .update({ booking_pending: true })
        .eq("id", id)
        .eq("booking_pending", false)
        .is("booking_url", null)
        .select("id"),
    );
    if (!claimed.length)
      throw new HttpError(
        409,
        "Your scheduling link is being prepared. Please try again shortly.",
      );
    try {
      const created = await createConsultationLink();
      const bookingUrl = new URL(created);
      if (t.plan === "consultation") {
        bookingUrl.searchParams.set("utm_source", "consulting");
        bookingUrl.searchParams.set("utm_content", id);
      }
      const url = bookingUrl.href;
      checked(
        await db()
          .from("support_cases")
          .update({ booking_url: url, booking_pending: false })
          .eq("id", id),
      );
      return Response.json({ url });
    } catch (error) {
      // Only a definite rejection before link creation is safe to retry automatically.
      if (error instanceof CalendlyError && error.safeToRetry) {
        checked(
          await db()
            .from("support_cases")
            .update({ booking_pending: false })
            .eq("id", id),
        );
        throw new HttpError(503, error.message);
      }
      // A timeout or lost response may have created a link. An operator must reconcile it.
      throw new HttpError(
        503,
        "Scheduling is temporarily unavailable. Your payment remains recorded; please try again or use the contact form.",
      );
    }
  } catch (e) {
    return fail(e);
  }
}
