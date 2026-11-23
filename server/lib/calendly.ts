import { business } from "./business";
/** Provider boundary: all credentials stay on the server. */
export class CalendlyError extends Error {
  constructor(
    message: string,
    public safeToRetry: boolean,
  ) {
    super(message);
  }
}
function config(eventType?: string) {
  const token = process.env.CALENDLY_API_TOKEN;
  const owner =
    eventType || business.consultation.eventType || process.env.CALENDLY_EVENT_TYPE;
  if (!token || !owner)
    throw new CalendlyError(
      "Consultation scheduling is not configured yet.",
      true,
    );
  let url: URL;
  try {
    url = new URL(owner);
  } catch {
    throw new CalendlyError(
      "The consultation event is not configured correctly.",
      true,
    );
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.calendly.com" ||
    !/^\/event_types\/[^/]+$/.test(url.pathname) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new CalendlyError(
      "The consultation event is not configured correctly.",
      true,
    );
  return { token, owner };
}
export async function assertConsultationEvent(eventType?: string, requireZoom = false, requireFree = false) {
  const { token, owner } = config(eventType);
  try {
    const response = await fetch(owner, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!response.ok)
      throw new CalendlyError(
        "Consultation availability could not be verified. Please try again later.",
        true,
      );
    const { resource } = await response.json();
    if (
      resource?.uri !== owner ||
      resource.active !== true ||
      resource.duration !== business.consultation.minutes ||
      (requireFree && resource.is_paid !== false) ||
      (requireZoom && !resource.locations?.some((location: {kind?: string} | null) => location?.kind === "zoom_conference"))
    )
      throw new CalendlyError(
        "The consultation must be an active 30-minute event with the required meeting location. Please contact the service.",
        true,
      );
  } catch (error) {
    if (error instanceof CalendlyError) throw error;
    throw new CalendlyError(
      "Consultation availability could not be verified. Please try again later.",
      true,
    );
  }
}
export async function createConsultationLink(eventType?: string, requireZoom = false, requireFree = false) {
  await assertConsultationEvent(eventType, requireZoom, requireFree);
  const { token, owner } = config(eventType);
  let response: Response;
  try {
    response = await fetch("https://api.calendly.com/scheduling_links", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        max_event_count: 1,
        owner,
        owner_type: "EventType",
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new CalendlyError(
      "Scheduling confirmation was interrupted. Please contact the service so we can check your link.",
      false,
    );
  }
  if (!response.ok)
    throw new CalendlyError(
      "Scheduling is temporarily unavailable. Please contact the consultant if you need help.",
      response.status >= 400 && response.status < 500,
    );
  try {
    const { resource } = await response.json();
    const url = new URL(resource.booking_url);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "calendly.com" ||
      url.username ||
      url.password ||
      resource.owner !== owner ||
      resource.owner_type !== "EventType"
    )
      throw new Error("Invalid provider response");
    return url.href;
  } catch {
    throw new CalendlyError(
      "The scheduling response could not be verified. Please contact the service before trying again.",
      false,
    );
  }
}
