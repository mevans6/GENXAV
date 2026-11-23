import { cookies } from "../cookies";
import { db, HttpError } from "./server";
import { matchesHash } from "./security";
export const ticketCookie = (id: string) => `hav_ticket_${id}`;
export async function setTicketCookie(id: string, token: string) {
  (await cookies()).set(ticketCookie(id), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: `/api/consulting/tickets/${id}`,
    maxAge: 60 * 60 * 24 * 30,
  });
}
export async function privateTicket(id: string, token?: string) {
  const { data: row, error } = await db()
    .from("support_cases")
    .select("*")
    .eq("id", id)
    .eq("payment_status", "paid")
    .maybeSingle();
  if (error || !row)
    throw new HttpError(404, "This support link is invalid or expired.");
  const secret = token || (await cookies()).get(ticketCookie(id))?.value;
  if (!row || !secret || !matchesHash(secret, row.token_hash))
    throw new HttpError(404, "This support link is invalid or expired.");
  return row;
}
