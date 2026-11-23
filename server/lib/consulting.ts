import { CONSULTING_BUCKET, intakeEmailAttachments, intakeEmailText } from "./intake-email";
import { createHmac } from "node:crypto";
import { cookies } from "../cookies";
import { business, consultationPrice } from "./business";
import { checked, db, email, HttpError } from "./server";
import { digest, matchesHash } from "./security";
import { emailReady } from "./notifications";
export { CONSULTING_BUCKET } from "./intake-email";
export function invitationToken(id: string) {
  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!secret || secret.length < 32)
    throw new HttpError(503, "Private invitation access is not configured.");
  return createHmac("sha256", secret)
    .update(`consultation-invitation:${id}`)
    .digest("hex");
}
export const invitationCookie = (id: string) => `consultation_${id}`;
export async function approvedRequest(id: string) {
  const row = checked(
    await db()
      .from("consulting_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle(),
  );
  const token = (await cookies()).get(invitationCookie(id))?.value;
  if (
    !row ||
    row.review_status !== "approved" ||
    !row.invitation_hash ||
    !token ||
    !matchesHash(token, row.invitation_hash)
  )
    throw new HttpError(
      404,
      "This invitation is unavailable. Please contact the consultant.",
    );
  return row;
}
export function invitationUrl(id: string) {
  return `${process.env.NEXT_PUBLIC_SITE_URL}/consulting/invitation/${id}#${invitationToken(id)}`;
}
export async function flushConsultingNotifications(limit = 5) {
  if (!emailReady()) return { sent: 0, pending: true };
  const notices = checked(
    await db().rpc("claim_consulting_notifications", { p_limit: limit }),
  );
  let sent = 0;
  for (const notice of notices) {
    try {
      const r = checked(
        await db()
          .from("consulting_requests")
          .select("id,name,email,phone,location,need,description,created_at,review_status,invitation_hash")
          .eq("id", notice.request_id)
          .single(),
      );
      const validInvite =
        notice.kind !== "invitation" ||
        (r.review_status === "approved" &&
          r.invitation_hash === digest(invitationToken(r.id)));
      if (validInvite) {
        const owner = notice.kind === "owner";
        const attachments = owner ? await intakeEmailAttachments(r.id) : [];
        const text = owner
          ? intakeEmailText(r, attachments.map(file => file.filename))
          : notice.kind === "invitation"
            ? `Hello ${r.name},\n\nYour request has been reviewed and is suitable for an initial consultation.\n\n${business.consultation.name}: ${consultationPrice} / ${business.consultation.minutes} minutes, via ${business.consultation.channel}.\n\nUse this private invitation to review the terms and reserve an available time at least 24 hours ahead: ${invitationUrl(r.id)}\n\nAfter scheduling, we email a $99 payment link. Payment is due within 12 hours of the payment request being prepared; the email states your exact deadline. Unpaid reservations receive reminders at 6 and 11 hours and are canceled after the deadline. Calendly's calendar invitation and Zoom details alone do not confirm payment. Use the same email address when booking.\n\nThis purchases advice and time, not a guaranteed repair. Additional work requires a separate agreement and authorization. Keep this link private.`
            : notice.body;
        await email(
          owner ? process.env.SUPPORT_NOTIFY_EMAIL! : r.email,
          `${business.name} — ${owner ? "new request" : notice.kind === "invitation" ? "consultation invitation" : "your request"}`,
          text,
          `consulting-${notice.id}`,
          owner ? r.email : "consulting@genxav.com",
          attachments,
        );
        sent++;
      }
      checked(
        await db()
          .from("consulting_notifications")
          .update({
            sent_at: new Date().toISOString(),
            locked_until: new Date(0).toISOString(),
          })
          .eq("id", notice.id),
      );
    } catch {
      await db()
        .from("consulting_notifications")
        .update({
          locked_until: new Date(0).toISOString(),
          retry_after: new Date(
            Date.now() +
              Math.min(60, 2 ** Math.min(notice.attempts, 6)) * 60000,
          ).toISOString(),
        })
        .eq("id", notice.id);
      console.warn("Consulting notification queued for retry.");
    }
  }
  return { sent, pending: sent < notices.length };
}
export async function purgeConsultingData() {
  // Requests and attached quote records follow the disclosed 90-day content retention.
  checked(
    await db()
      .from("consulting_requests")
      .delete()
      .eq("has_reservation",false)
      .lt("updated_at", new Date(Date.now() - 90 * 86400000).toISOString()),
  );
  let removed = 0;
  for (let i = 0; i < 5; i++) {
    const files = checked(
      await db()
        .from("consulting_attachments")
        .select("id,storage_path")
        .lt("expires_at", new Date().toISOString())
        .limit(100),
    );
    if (!files.length) break;
    checked(
      await db()
        .storage.from(CONSULTING_BUCKET)
        .remove(files.map((f) => f.storage_path)),
    );
    checked(
      await db()
        .from("consulting_attachments")
        .delete()
        .in(
          "id",
          files.map((f) => f.id),
        ),
    );
    removed += files.length;
  }
  return removed;
}
