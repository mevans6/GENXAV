import { z } from "zod";
import { reviewStatuses } from "@lib/business";
import { admin, body, checked, db, fail, HttpError } from "@lib/server";
import { digest } from "@lib/security";
import {
  flushConsultingNotifications,
  invitationToken,
  invitationUrl,
} from "@lib/consulting";
import { emailReady } from "@lib/notifications";
const quote = z.object({
  id: z.uuid().optional(),
  service: z.string().trim().min(1).max(150),
  scope: z.string().trim().min(5).max(6000),
  price_cents: z.number().int().min(1).max(100000000),
  approval_status: z.enum(["pending", "approved", "declined"]),
  payment_status: z.enum(["unpaid", "paid", "partially_paid", "refunded"]),
  project_status: z.enum(["proposed", "active", "completed", "canceled"]),
  internal_notes: z.string().max(6000),
});
export async function GET(request: Request) {
  try {
    await admin(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id)
      return Response.json(
        {
          requests: checked(
            await db()
              .from("consulting_requests")
              .select("id,name,email,location,need,review_status,created_at")
              .order("created_at", { ascending: false })
              .limit(100),
          ),
          emailReady: emailReady(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    z.uuid().parse(id);
    const [r, files, quotes] = await Promise.all([
      db().from("consulting_requests").select("*").eq("id", id).single(),
      db()
        .from("consulting_attachments")
        .select("id,filename,mime,bytes")
        .eq("request_id", id)
        .gt("expires_at", new Date().toISOString()),
      db()
        .from("consulting_quotes")
        .select("*")
        .eq("request_id", id)
        .order("created_at", { ascending: false }),
    ]);
    const detail = checked(r);
    const reservation = checked(await db().from('consulting_reservations').select('id,starts_at,timezone,payment_due_at,appointment_status,payment_status,paid_at,canceled_at,review_reason,stripe_session_id').eq('request_id',id).maybeSingle());
    delete detail.invitation_hash;
    delete detail.visitor_hash;
    return Response.json(
      {
        request: detail,
        attachments: checked(files),
        quotes: checked(quotes),
        reservation,
        emailReady: emailReady(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request) {
  try {
    await admin(request);
    const input = z
      .object({
        id: z.uuid(),
        action: z.enum(["review", "invite", "respond", "quote"]),
        status: z.enum(reviewStatuses).optional(),
        notes: z.string().max(6000).optional(),
        message: z.string().trim().min(1).max(6000).optional(),
        quote: quote.optional(),
      })
      .parse(await body(request));
    const r = checked(
      await db()
        .from("consulting_requests")
        .select("id,review_status")
        .eq("id", input.id)
        .single(),
    );
    if (!r) throw new HttpError(404, "Request unavailable.");
    const now = new Date().toISOString();
    if (input.action === "quote") {
      if (!input.quote) throw new HttpError(400, "Complete the quote fields.");
      const { id, ...details } = input.quote;
      if (id)
        checked(
          await db()
            .from("consulting_quotes")
            .update({ ...details, updated_at: now })
            .eq("id", id)
            .eq("request_id", input.id),
        );
      else
        checked(
          await db()
            .from("consulting_quotes")
            .insert({ ...details, request_id: input.id }),
        );
      checked(
        await db()
          .from("consulting_requests")
          .update({ updated_at: now })
          .eq("id", input.id),
      );
      return Response.json({ saved: true });
    }
    if (input.action === "review") {
      if (!input.status) throw new HttpError(400, "Choose a review status.");
      checked(
        await db()
          .from("consulting_requests")
          .update({
            review_status: input.status,
            internal_notes: input.notes || "",
            updated_at: now,
            ...(input.status !== "approved" ? { invitation_hash: null } : {}),
          })
          .eq("id", input.id),
      );
      return Response.json({ saved: true });
    }
    if (input.action === "invite") {
      if (r.review_status !== "approved")
        throw new HttpError(
          409,
          "Approve this request for a consultation before sending an invitation.",
        );
      checked(
        await db()
          .from("consulting_requests")
          .update({
            invitation_hash: digest(invitationToken(input.id)),
            updated_at: now,
          })
          .eq("id", input.id)
          .eq("review_status", "approved"),
      );
      checked(
        await db()
          .from("consulting_notifications")
          .upsert(
            {
              request_id: input.id,
              kind: "invitation",
              delivery_key: "invitation",
            },
            {
              onConflict: "request_id,kind,delivery_key",
              ignoreDuplicates: true,
            },
          ),
      );
      try {
        await flushConsultingNotifications();
      } catch {
        console.warn("Invitation notification queued.");
      }
      return Response.json({
        url: invitationUrl(input.id),
        queued: !emailReady(),
        message: emailReady()
          ? "Invitation queued for email delivery. You can also copy the private link."
          : "Email is not configured. Copy this private link and send it manually to the customer.",
      });
    }
    if (!input.message) throw new HttpError(400, "Write your response first.");
    checked(
      await db()
        .from("consulting_notifications")
        .upsert(
          {
            request_id: input.id,
            kind: "response",
            body: input.message,
            delivery_key: digest(input.message),
          },
          {
            onConflict: "request_id,kind,delivery_key",
            ignoreDuplicates: true,
          },
        ),
    );
    try {
      await flushConsultingNotifications();
    } catch {
      console.warn("Customer response queued.");
    }
    return Response.json({
      saved: true,
      message: emailReady()
        ? "Response queued for delivery."
        : "Response saved in the email queue. Email is not configured; send it manually if needed.",
    });
  } catch (e) {
    return fail(e);
  }
}
