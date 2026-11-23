import { z } from "zod";
import {
  body,
  checked,
  db,
  fail,
  HttpError,
  rateLimit,
} from "@lib/server";
import { privateTicket } from "@lib/tickets";
import { casePhotos, removeCasePhotos } from "@lib/photos";
import { flushNotifications } from "@lib/notifications";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    z.uuid().parse(id);
    const t = await privateTicket(id);
    const messages = checked(
      await db()
        .from("ticket_messages")
        .select("id,role,content,created_at")
        .eq("case_id", id)
        .order("seq"),
    );
    return Response.json(
      {
        ticket: {
          id: t.id,
          name: t.name,
          issue: t.issue,
          equipment: t.equipment,
          summary: t.summary,
          plan: t.plan,
          status: t.status,
          clarification_used: t.clarification_used,
        },
        messages,
        photos: await casePhotos(id),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const input = z
      .object({ message: z.string().trim().min(1).max(3000) })
      .parse(await body(request));
    await rateLimit(request, "clarification", 10);
    const t = await privateTicket(id);
    if (t.plan !== "expert")
      throw new HttpError(400, "Messaging is only included in expert support.");
    const messageId = checked(
      await db().rpc("add_clarification", {
        p_case_id: id,
        p_content: input.message,
      }),
    );
    if (!messageId)
      throw new HttpError(
        409,
        "A clarification is available once after your expert responds.",
      );
    const notifications = await flushNotifications(id);
    return Response.json({ sent: true, notificationPending: notifications.pending });
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    await body(request);
    const { id } = await params;
    await privateTicket(id);
    await removeCasePhotos(id);
    checked(await db().from("support_cases").delete().eq("id", id));
    return Response.json({ deleted: true });
  } catch (e) {
    return fail(e);
  }
}
