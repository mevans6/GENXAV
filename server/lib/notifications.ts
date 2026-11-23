import { business } from "./business";
import { checked, db, email } from "./server";
import { ticketToken } from "./security";

export function emailReady() {
  return !!(
    process.env.RESEND_API_KEY &&
    process.env.EMAIL_FROM &&
    process.env.SUPPORT_NOTIFY_EMAIL
  );
}

// The SQL transaction queues these alongside the payment/reply. Delivery failures
// never undo a saved message or cause duplicate fulfillment on a webhook replay.
export async function flushNotifications(caseId?: string, limit = 2) {
  if (!emailReady()) return { sent: 0, pending: true };
  const rows = checked(
    await db().rpc("claim_support_notifications", {
      p_case_id: caseId || null,
      p_limit: limit,
    }),
  );
  let sent = 0;
  await Promise.all(
    rows.map(
      async (notice: {
        id: string;
        case_id: string;
        kind: string;
        attempts: number;
      }) => {
        try {
          const ticket = checked(
            await db()
              .from("support_cases")
              .select("id,email,plan,payment_status")
              .eq("id", notice.case_id)
              .single(),
          );
          if (ticket.payment_status !== "paid") {
            checked(
              await db()
                .from("support_notifications")
                .update({
                  sent_at: new Date().toISOString(),
                  locked_until: new Date(0).toISOString(),
                })
                .eq("id", notice.id),
            );
            return;
          }
          const url = `${process.env.NEXT_PUBLIC_SITE_URL}/consulting/ticket/${ticket.id}#${ticketToken(ticket.id)}`;
          const adminUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/consulting/admin`;
          const customer = ["paid_customer", "expert_reply"].includes(
            notice.kind,
          );
          const subject =
            notice.kind === "paid_customer"
              ? `Your ${business.name} private consultation link`
              : notice.kind === "paid_operator"
                ? `New paid ${business.name} request`
                : notice.kind === "expert_reply"
                  ? "Your AV expert has replied"
                  : "Support clarification received";
          const text =
            notice.kind === "paid_customer"
              ? `Your payment is verified.\n\nOpen your private support page: ${url}\n\n${ticket.plan !== "expert" ? "Your page includes a one-time scheduling link." : `Your initial expert response window: ${process.env.SUPPORT_RESPONSE_WINDOW}. This is written support, not live chat.`}\n\nKeep this link private.`
              : notice.kind === "expert_reply"
                ? `Your expert response is ready. Open your private support page: ${url}\n\nFor privacy, the reply is not included in this notification.`
                : `A ${notice.kind === "clarification" ? "customer clarification" : ticket.plan + " support request"} is ready in your admin dashboard. Sign in at ${adminUrl}.`;
          await email(
            customer ? ticket.email : process.env.SUPPORT_NOTIFY_EMAIL!,
            subject,
            text,
            `notice-${notice.id}`,
          );
          checked(
            await db()
              .from("support_notifications")
              .update({
                sent_at: new Date().toISOString(),
                locked_until: new Date(0).toISOString(),
              })
              .eq("id", notice.id),
          );
          sent++;
        } catch {
          await db()
            .from("support_notifications")
            .update({
              locked_until: new Date(0).toISOString(),
              retry_after: new Date(
                Date.now() +
                  Math.min(60, 2 ** Math.min(notice.attempts, 6)) * 60000,
              ).toISOString(),
            })
            .eq("id", notice.id);
          console.warn("Support notification queued for retry.");
        }
      },
    ),
  );
  let query = db()
    .from("support_notifications")
    .select("id", { head: true, count: "exact" })
    .is("sent_at", null);
  if (caseId) query = query.eq("case_id", caseId);
  const pending = await query;
  checked(pending);
  return { sent, pending: !!pending.count };
}
