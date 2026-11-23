import { createClient } from "@supabase/supabase-js";
import { cookies } from "../cookies";
import { digest, newToken, safeOrigin } from "./security";
import { FREE_CHAT_ENABLED } from "./features";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const databaseReady = () =>
  !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
export function db() {
  if (!databaseReady())
    throw new HttpError(503, "Secure storage is not configured yet.");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export function checked<T>({
  data,
  error,
}: {
  data: T;
  error: unknown;
}): NonNullable<T> {
  if (error)
    throw new HttpError(
      503,
      "Secure storage could not complete the request. Please try again.",
    );
  return data as NonNullable<T>;
}
export async function body(request: Request) {
  if (!safeOrigin(request))
    throw new HttpError(403, "This request must come from this site.");
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 32000)
    throw new HttpError(413, "Please send a shorter message.");
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid request.");
  }
}
export function fail(error: unknown) {
  if (error instanceof HttpError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof Error && error.name === "ZodError")
    return Response.json(
      { error: "Please check the information and try again." },
      { status: 400 },
    );
  console.error(
    "Request failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return Response.json(
    { error: "The service could not complete this request. Please try again." },
    { status: 503 },
  );
}
export async function visitor() {
  const jar = await cookies();
  let token = jar.get("hav_visitor")?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    token = newToken();
    jar.set("hav_visitor", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return digest(token);
}
const localLimits = new Map<string, { count: number; until: number }>();
export async function rateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowSeconds = 3600,
) {
  const ip = process.env.VERCEL
    ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0] || "unknown"
    : "local";
  const key = digest(`${scope}:${ip}`);
  if (databaseReady()) {
    const ok = checked(
      await db().rpc("consume_rate_limit", {
        p_key: key,
        p_limit: limit,
        p_window: windowSeconds,
      }),
    );
    if (!ok)
      throw new HttpError(
        429,
        "You’ve reached the usage limit. Please try again later.",
      );
  } else {
    const now = Date.now();
    if (localLimits.size > 10000) localLimits.clear();
    const bucket = localLimits.get(key);
    if (!bucket || bucket.until < now)
      localLimits.set(key, { count: 1, until: now + windowSeconds * 1000 });
    else if (++bucket.count > limit)
      throw new HttpError(
        429,
        "You’ve reached the usage limit. Please try again later.",
      );
  }
}
export async function admin(request: Request) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!bearer) throw new HttpError(401, "Sign in to continue.");
  const { data, error } = await db().auth.getUser(bearer);
  if (error || !data.user || data.user.app_metadata.role !== "admin")
    throw new HttpError(403, "Administrator access required.");
  return data.user;
}
export function supportConfig(requestId?: string) {
  const base =
    databaseReady() &&
    !!process.env.RESEND_API_KEY &&
    !!process.env.EMAIL_FROM &&
    !!process.env.SUPPORT_NOTIFY_EMAIL &&
    (process.env.ACCESS_TOKEN_SECRET?.length || 0) >= 32 &&
    process.env.POLICIES_APPROVED === "true" &&
    !!process.env.NEXT_PUBLIC_SITE_URL;
  const responseWindow = process.env.SUPPORT_RESPONSE_WINDOW || "";
  // Exercise privately approved test requests without opening sandbox checkout
  // to real customers. A live key can never use this exception.
  const sandboxRequest = !!requestId && /^(rk|sk)_test_/.test(process.env.STRIPE_SECRET_KEY || "") &&
    (process.env.CONSULTATION_SANDBOX_REQUEST_IDS || "").split(',').map(id => id.trim()).includes(requestId);
  return {
    expertAvailable: false,
    videoAvailable: false,
    consultationAvailable:
      base &&
      (process.env.CONSULTATIONS_ENABLED === "true" || sandboxRequest) &&
      process.env.RESERVATION_AUTOMATION_ENABLED === "true" &&
      !!process.env.CALENDLY_API_TOKEN &&
      !!process.env.CALENDLY_RESERVATION_EVENT_TYPE &&
      !!process.env.CALENDLY_WEBHOOK_SIGNING_KEY &&
      !!process.env.STRIPE_SECRET_KEY &&
      !!process.env.STRIPE_WEBHOOK_SECRET &&
      !!process.env.CRON_SECRET,
    responseWindow,
    aiAvailable:
      FREE_CHAT_ENABLED &&
      databaseReady() &&
      !!process.env.AI_GATEWAY_API_KEY &&
      !!process.env.AI_MODEL,
  };
}
export type EmailAttachment = { filename: string; content: string };

export async function email(
  to: string,
  subject: string,
  text: string,
  key: string,
  replyTo = "consulting@genxav.com",
  attachments: EmailAttachment[] = [],
) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [to],
      reply_to: replyTo,
      subject,
      text,
      ...(attachments.length ? { attachments } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok)
    throw new HttpError(
      503,
      "Email delivery is temporarily unavailable. Please try again.",
    );
}
