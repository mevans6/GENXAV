import { business } from "./business";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const newToken = () => randomBytes(32).toString("hex");
export function ticketToken(id: string) {
  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Secure access is not configured.");
  return createHmac("sha256", secret).update(`ticket:${id}`).digest("hex");
}
export function matchesHash(token: string, expected: string) {
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(
    Buffer.from(digest(token), "hex"),
    Buffer.from(expected, "hex"),
  );
}
export const plans = {
  consultation: {
    name: business.consultation.name,
    amount: business.consultation.amount,
  },
  expert: { name: "Expert support", amount: 2900 },
  video: { name: "30-minute video consultation", amount: 7900 },
} as const;
export type Plan = keyof typeof plans;
export function paidCheckout(
  session: {
    payment_status: string;
    amount_total: number | null;
    currency: string | null;
    metadata: Record<string, string> | null;
  },
  plan: Plan,
  caseId: string,
  expectedAmount?: number,
) {
  return (
    session.payment_status === "paid" &&
    session.amount_total === (expectedAmount ?? plans[plan].amount) &&
    session.currency === "usd" &&
    session.metadata?.case_id === caseId &&
    session.metadata?.plan === plan
  );
}
export function safeOrigin(request: Request) {
  const actual = request.headers.get("origin");
  const expected = process.env.NEXT_PUBLIC_SITE_URL;
  return !!actual && !!expected && actual === new URL(expected).origin;
}
