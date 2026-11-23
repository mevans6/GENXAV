import { createHmac, timingSafeEqual } from 'node:crypto';

export const reservationPolicy = { paymentHours: 12, reminderHours: [6, 11], minimumNoticeHours: 24 } as const;
export const reservationEventType = () => process.env.CALENDLY_RESERVATION_EVENT_TYPE || '';

export function bookingCorrelation(id: string) {
  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!secret || secret.length < 32) throw new Error('Private booking access is not configured.');
  return `${id}.${createHmac('sha256', secret).update(`schedule-first:${id}`).digest('hex')}`;
}
export function correlationRequest(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(value)) return null;
  const id = value.slice(0, 36);
  const expected = bookingCorrelation(id);
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected)) ? id : null;
}
export function validCalendlySignature(raw: string, header: string | null, secret: string, now = Date.now()) {
  if (!secret || !header) return false;
  const parts = header.split(',').map(part => part.trim());
  const timestamp = parts.find(part => part.startsWith('t='))?.slice(2);
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 180) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return parts.filter(part => part.startsWith('v1=')).some(part => {
    const value = part.slice(3);
    return /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(expected, 'hex'));
  });
}
export function reservationTime(iso: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: timezone }).format(new Date(iso)) + ` (${timezone})`;
  } catch {
    return new Date(iso).toISOString() + ' (UTC)';
  }
}
