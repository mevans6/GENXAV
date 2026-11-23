import { z } from "zod";
import { cookies } from "@cookies";
import { body, checked, db, fail, HttpError, rateLimit } from "@lib/server";
import { matchesHash, ticketToken } from "@lib/security";
import { invitationCookie } from "@lib/consulting";
import { setTicketCookie } from "@lib/tickets";
export async function POST(request: Request) {
  try {
    const { id, token } = z
      .object({ id: z.uuid(), token: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(await body(request));
    await rateLimit(request, "consultation-access", 30, 300);
    const r = checked(
      await db()
        .from("consulting_requests")
        .select("review_status,invitation_hash,case_id")
        .eq("id", id)
        .maybeSingle(),
    );
    if (
      !r ||
      r.review_status !== "approved" ||
      !r.invitation_hash ||
      !matchesHash(token, r.invitation_hash)
    )
      throw new HttpError(404, "This consultation invitation is unavailable.");
    (await cookies()).set(invitationCookie(id), token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: `/api/consulting/consultations/${id}`,
      maxAge: 60 * 60 * 24 * 7,
    });
    if (r.case_id) {
      const c = checked(
        await db()
          .from("support_cases")
          .select("payment_status")
          .eq("id", r.case_id)
          .maybeSingle(),
      );
      if (c?.payment_status === "paid")
        await setTicketCookie(r.case_id, ticketToken(r.case_id));
    }
    return Response.json({ access: true });
  } catch (e) {
    return fail(e);
  }
}
