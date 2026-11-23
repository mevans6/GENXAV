"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { business, consultationPrice } from "@lib/business";
type Detail = {
  name: string;
  need: string;
  description: string;
  available: boolean;
  paymentStatus: string;
  ticketUrl: string | null;
  previousCheckout: boolean;
  reservation: {appointment_status:string;payment_status:string;starts_at:string;payment_due_at:string;timezone:string;checkout_url:string|null} | null;
};
export function ConsultationInvitation({ id }: { id: string }) {
  const [data, setData] = useState<Detail>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const token = location.hash.slice(1);
        if (token) {
          const r = await fetch("/api/consulting/consultations/access", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, token }),
            signal: controller.signal,
          });
          const d = await r.json();
          if (!r.ok) throw Error(d.error);
          history.replaceState(null, "", location.pathname + location.search);
        }
        const r = await fetch(`/api/consulting/consultations/${id}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setData(d);
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      }
    }
    void load();
    return () => controller.abort();
  }, [id]);
  async function book(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/consulting/consultations/${id}/booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      const u = new URL(d.url);
      if (u.protocol !== "https:" || u.hostname !== "calendly.com")
        throw Error("Invalid scheduling address.");
      location.assign(u.href);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data ? (
        <p>Open the full private invitation sent by your consultant.</p>
      ) : (
        <div className="form-panel">
          <h2>Hello, {data.name}.</h2>
          <p>Your request has been reviewed for an initial consultation.</p>
          <h3>{data.need}</h3>
          <p className="preserve-lines">{data.description}</p>
          {data.paymentStatus === "paid" && data.ticketUrl ? (
            <Link className="button" href={data.ticketUrl}>
              Open your paid consultation
            </Link>
          ) : data.paymentStatus === "refunded" ? (
            <p>
              This consultation has been refunded. Contact your consultant
              before arranging further work.
            </p>
          ) : data.reservation ? (
            <ReservationStatus reservation={data.reservation}/>
          ) : (
            <>
              <h3>
                {business.consultation.name} · {consultationPrice} /{" "}
                {business.consultation.minutes} minutes
              </h3>
              <p>
                A scheduled {business.consultation.channel} appointment for one
                primary issue, project, or technical decision. Includes
                assessment, initial advice, safe troubleshooting where feasible,
                and recommended next steps. Additional work is separate, is not
                automatically credited, and requires your approval.
              </p>
              <p>
                Choose an available time at least 24 hours ahead. After scheduling,
                we email a $99 payment link with a 12-hour deadline. Reminders follow
                at 6 and 11 hours if unpaid. Unpaid reservations are canceled after
                the deadline. Calendly sends the calendar invitation and Zoom details;
                your reservation remains conditional until payment is verified.
              </p>
              {!data.available && (
                <div className="notice">
                  {data.previousCheckout
                    ? "A previous payment attempt exists for this request. Contact your consultant before making another booking."
                    : "Scheduling is not open yet. Your reviewed request remains saved; contact your consultant to arrange the next step."}
                </div>
              )}
              <form onSubmit={book}>
                <label className="check-label">
                  <input type="checkbox" required disabled={busy} />
                  <span>
                    I agree to the <Link href="/consulting/terms">terms</Link>,{" "}
                    <Link href="/privacy.html">privacy policy</Link>, and{" "}
                    <Link href="/consulting/refunds">refund policy</Link>. I understand
                    that $99 payment is required to retain my appointment, and I am
                    purchasing advice and time, not a guaranteed repair. I will book
                    using the email address from my request.
                  </span>
                </label>
                <button className="button" disabled={busy || !data.available}>
                  {busy
                    ? "Opening available times…"
                    : `Choose a time · ${consultationPrice} / 30 minutes`}
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}

export function ReservationStatus({reservation:r}:{reservation:NonNullable<Detail['reservation']>}) {
  const time = (value:string) => {try{return new Intl.DateTimeFormat('en-US',{dateStyle:'full',timeStyle:'short',timeZone:r.timezone}).format(new Date(value)) + ` (${r.timezone})`}catch{return new Date(value).toISOString()+' (UTC)'}};
  const canceled = r.appointment_status === 'canceled';
  const paid = r.payment_status === 'paid' && !canceled && r.appointment_status === 'scheduled';
  return <section aria-label="Appointment status">
    <h3>{canceled ? 'Appointment canceled' : paid ? 'Consultation confirmed' : r.appointment_status === 'canceling' ? 'Cancellation in progress' : r.appointment_status === 'rescheduling' ? 'Reschedule in progress' : r.payment_status === 'processing' ? 'Payment processing' : ['review','refunded'].includes(r.payment_status) ? 'Contact your consultant' : 'Payment required to retain your appointment'}</h3>
    <p>30-minute Zoom consultation: {time(r.starts_at)}</p>
    {paid ? <p>Your $99 payment is verified. Use the Zoom details and management links in your latest Calendly confirmation.</p>
      : canceled ? <p>This reservation is canceled. Contact consulting@genxav.com to arrange another time. If you paid, contact us before making another payment.</p>
      : r.appointment_status === 'canceling' ? <p>The payment deadline has passed and cancellation is being verified. Do not pay through an old link. Contact consulting@genxav.com if you already paid.</p>
      : r.appointment_status === 'rescheduling' ? <p>We are waiting for the replacement appointment from Calendly. {r.payment_status === 'paid' ? 'Your existing payment is verified; no new payment is needed.' : 'The original payment deadline remains in effect. Check your payment email or contact consulting@genxav.com.'}</p>
      : r.payment_status === 'processing' ? <p>Your payment is being verified. Do not pay again. Automatic cancellation is paused while payment is processing.</p>
      : ['review','refunded'].includes(r.payment_status) ? <p>This reservation needs personal follow-up. Email consulting@genxav.com before paying or booking again.</p>
      : <><p>Pay $99 by <strong>{time(r.payment_due_at)}</strong>. Unpaid reservations are canceled after this deadline. Your calendar invitation and Zoom link alone do not confirm payment.</p>
        {r.checkout_url ? <a className="button" href={r.checkout_url}>Pay $99 to retain appointment</a> : <p>Your payment link is being prepared or has closed. Check your email or contact consulting@genxav.com. Refresh this page to check the latest status.</p>}</>}
    <p>Manage or reschedule through your latest Calendly confirmation. Rescheduling keeps the original payment deadline; a verified payment carries over.</p>
    <button className="subtle-button" onClick={()=>location.reload()}>Refresh appointment status</button>
  </section>;
}
