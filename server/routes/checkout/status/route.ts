import { z } from "zod";
import { body, checked, db, fail, HttpError, rateLimit, visitor } from "@lib/server";
import { ticketToken } from "@lib/security";
import { setTicketCookie } from "@lib/tickets";

export async function POST(request: Request) {
  try {
    const { sessionId } = z.object({ sessionId: z.string().regex(/^cs_(?:test_|live_)?[A-Za-z0-9]+$/).max(300) }).parse(await body(request));
    await rateLimit(request, "checkout-status", 60, 300);
    const owner = await visitor();
    const ticket = checked(await db().from("support_cases").select("id,payment_status").eq("stripe_session_id", sessionId).eq("visitor_hash", owner).maybeSingle());
    if (!ticket) throw new HttpError(404, "Open checkout from the same browser used to submit your request, or use your emailed private link.");
    if (ticket.payment_status === "refunded") throw new HttpError(403, "This payment was refunded.");
    // Only the verified webhook can mark this record paid. A success URL cannot.
    if (ticket.payment_status !== "paid") return Response.json({ state: "pending" }, { headers: { "Cache-Control": "no-store" } });
    await setTicketCookie(ticket.id, ticketToken(ticket.id));
    return Response.json({ state: "paid", ticketUrl: `/consulting/ticket/${ticket.id}` }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
