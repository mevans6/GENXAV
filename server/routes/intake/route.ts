import { z } from "zod";
import { intakeNeeds } from "@lib/business";
import {
  body,
  checked,
  db,
  fail,
  HttpError,
  rateLimit,
  visitor,
} from "@lib/server";
import { flushConsultingNotifications } from "@lib/consulting";
export async function POST(request: Request) {
  try {
    const input = z
      .object({
        id: z.uuid(),
        name: z.string().trim().min(1).max(100),
        email: z.email().max(254),
        phone: z.string().trim().max(50).default(""),
        location: z.string().trim().min(2).max(150),
        need: z.enum(intakeNeeds),
        description: z.string().trim().min(20).max(6000),
        attachments: z.array(z.uuid()).max(6).default([]),
        consent: z.literal(true),
        website: z.string().max(0).default(""),
      })
      .parse(await body(request));
    await rateLimit(request, "consulting-intake", 5);
    const result = await db().rpc("submit_consulting_request", {
      p_id: input.id,
      p_owner: await visitor(),
      p_name: input.name,
      p_email: input.email,
      p_phone: input.phone,
      p_location: input.location,
      p_need: input.need,
      p_description: input.description,
      p_attachments: input.attachments,
    });
    if (result.error?.message.includes("Request limit"))
      throw new HttpError(
        429,
        "You’ve reached the request limit. Please try again later.",
      );
    checked(result);
    // The request and owner notification are already durably stored in one transaction.
    try {
      await flushConsultingNotifications();
    } catch {
      console.warn("Request saved; owner notification is queued.");
    }
    return Response.json(
      { received: true, reference: input.id },
      { status: 201 },
    );
  } catch (e) {
    return fail(e);
  }
}
