import { z } from "zod";
import { body, fail, rateLimit } from "@lib/server";
import { privateTicket, setTicketCookie } from "@lib/tickets";
export async function POST(request: Request) {
  try {
    const input = z
      .object({ id: z.uuid(), token: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(await body(request));
    await rateLimit(request, "ticket-access", 20);
    await privateTicket(input.id, input.token);
    await setTicketCookie(input.id, input.token);
    return Response.json({ authorized: true });
  } catch (e) {
    return fail(e);
  }
}
