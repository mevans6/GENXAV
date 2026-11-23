"use client";
import { useCallback, useEffect, useState } from "react";
import {
  business,
  consultationPrice,
  reviewLabels,
  reviewStatuses,
} from "@lib/business";
import { PhotoGallery } from "./photo-gallery";
type Intake = {
  id: string;
  name: string;
  email: string;
  phone: string;
  location: string;
  need: string;
  description: string;
  review_status: string;
  internal_notes: string;
  created_at: string;
};
type Attachment = { id: string; filename: string; mime: string; bytes: number };
type Quote = {
  id?: string;
  service: string;
  scope: string;
  price_cents: number;
  approval_status: string;
  payment_status: string;
  project_status: string;
  internal_notes: string;
};
const blank: Quote = {
  service: "",
  scope: "",
  price_cents: 0,
  approval_status: "pending",
  payment_status: "unpaid",
  project_status: "proposed",
  internal_notes: "",
};
export function ConsultingAdmin({ token }: { token: string }) {
  const [requests, setRequests] = useState<Intake[]>([]);
  const [selected, setSelected] = useState<Intake>();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [quote, setQuote] = useState<Quote>({ ...blank });
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("new");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailReady, setEmailReady] = useState(true);
  const [reservation, setReservation] = useState<{id:string;starts_at:string;timezone:string;payment_due_at:string;appointment_status:string;payment_status:string;review_reason:string|null;stripe_session_id:string|null}|null>(null);
  const api = useCallback(
    async (path = "", payload?: object) => {
      const r = await fetch(`/api/consulting/admin/consulting${path}`, {
        method: payload ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload ? { "Content-Type": "application/json" } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        cache: "no-store",
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      return d;
    },
    [token],
  );
  async function refresh() {
    const d = await api();
    setRequests(d.requests);
    setEmailReady(d.emailReady);
  }
  useEffect(() => {
    let active = true;
    async function start() {
      try {
        const d = await api();
        if (active) {
          setRequests(d.requests);
          setEmailReady(d.emailReady);
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    }
    void start();
    return () => {
      active = false;
    };
  }, [api]);
  async function select(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    setInvite("");
    try {
      const d = await api(`?id=${id}`);
      setSelected(d.request);
      setStatus(d.request.review_status);
      setNotes(d.request.internal_notes);
      setAttachments(d.attachments);
      setQuotes(d.quotes);
      setReservation(d.reservation);
      setQuote({ ...blank });
      setAmount("");
      setMessage("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(kind: string) {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const d = await api("", {
        id: selected.id,
        action: kind,
        ...(kind === "review"
          ? { status, notes }
          : kind === "respond"
            ? { message }
            : kind === "quote"
              ? {
                  quote: {
                    ...quote,
                    price_cents: Math.round(Number(amount) * 100),
                  },
                }
              : {}),
      });
      setNotice(d.message || "Saved.");
      if (d.url) setInvite(d.url);
      await refresh();
      if (kind === "review")
        setSelected({
          ...selected,
          review_status: status,
          internal_notes: notes,
        });
      if (kind === "quote") {
        const fresh = await api(`?id=${selected.id}`);
        setQuotes(fresh.quotes);
        setQuote({ ...blank });
        setAmount("");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied. Send it privately to the customer.");
    } catch {
      setNotice("Copy the text from the field below.");
    }
  }
  async function download(file: Attachment) {
    try {
      const r = await fetch(`/api/consulting/admin/consulting/attachments/${file.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw Error("Attachment unavailable.");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const quoteText = `${business.name}\n\n${quote.service}\nScope: ${quote.scope}\nProposed price: ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(amount) || 0)}\n\nThis is a separate quote. Work and payment require your explicit authorization. The ${consultationPrice} initial consultation is not automatically credited toward this work.`;
  return (
    <section className="consulting-admin">
      <div className="admin-section-heading">
        <h2>Consultation requests</h2>
        <button
          className="subtle-button"
          disabled={busy}
          onClick={() => refresh().catch((e) => setError(e.message))}
        >
          Refresh requests
        </button>
      </div>
      {!emailReady && (
        <div className="notice warning">
          Email delivery is not configured. New requests are saved. Copy
          consultation invitations or responses and send them manually until a
          verified sender is connected.
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      <div className="admin-grid">
        <div className="admin-tickets">
          {requests.map((r) => (
            <button key={r.id} disabled={busy} onClick={() => select(r.id)}>
              {r.name}
              <small>
                {reviewLabels[r.review_status]} · {r.need}
                <br />
                {r.location}
              </small>
            </button>
          ))}
          {!requests.length && <p>No consultation requests yet.</p>}
        </div>
        <div>
          {selected ? (
            <div className="form-panel">
              <h2>{selected.name}</h2>
              <p>
                {selected.email}
                {selected.phone ? ` · ${selected.phone}` : ""}
                <br />
                {selected.location}
              </p>
              <h3>{selected.need}</h3>
              <p className="preserve-lines">{selected.description}</p>
              <PhotoGallery
                photos={attachments
                  .filter((f) => f.mime === "image/jpeg")
                  .map((f) => ({ id: f.id, width: 1, height: 1 }))}
                caseId={selected.id}
                bearer={token}
                basePath="/api/consulting/admin/consulting/attachments"
              />
              {attachments.length > 0 && (
                <ul className="intake-files">
                  {attachments.map((file) => (
                    <li key={file.id}>
                      <span>{file.filename}</span>
                      <button
                        className="subtle-button"
                        onClick={() => download(file)}
                      >
                        Download
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="form-field">
                <label htmlFor="review-status">Review status</label>
                <select
                  id="review-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {reviewStatuses.map((s) => (
                    <option key={s} value={s}>
                      {reviewLabels[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="request-notes">
                  Internal notes — never sent to the customer
                </label>
                <textarea
                  id="request-notes"
                  value={notes}
                  maxLength={6000}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              <button
                className="button"
                disabled={busy}
                onClick={() => action("review")}
              >
                Save review
              </button>
              <div className="admin-subsection">
                {reservation && <section aria-label="Reservation billing"><h3>Reservation and payment</h3><p>Appointment: {new Date(reservation.starts_at).toLocaleString()} · {reservation.appointment_status}</p><p>Payment: {reservation.payment_status} · Due {new Date(reservation.payment_due_at).toLocaleString()}</p>{reservation.review_reason && <p className="notice" role="status">Action required: {reservation.review_reason}</p>}<p>Reservation: {reservation.id}</p>{reservation.stripe_session_id && <p>Stripe checkout: {reservation.stripe_session_id}</p>}<p>Check Stripe and Calendly before resolving a payment exception or issuing a refund. Refunds and appointment cancellations are separate actions.</p></section>}
                <h3>Consultation invitation</h3>
                <p>
                  Approve the request and save the review first. The invitation
                  offers a {consultationPrice} / {business.consultation.minutes}
                  -minute {business.consultation.channel} consultation. It never
                  confirms payment. Customers reserve a time first, receive a
                  payment link, and have 12 hours to pay. Reminders follow at 6
                  and 11 hours; unpaid reservations are canceled after the deadline.
                </p>
                <button
                  className="button button-secondary"
                  disabled={busy || selected.review_status !== "approved"}
                  onClick={() => action("invite")}
                >
                  Prepare / send private invitation
                </button>
                {invite && (
                  <>
                    <label htmlFor="private-invitation">
                      Private invitation — send only to this customer
                    </label>
                    <textarea id="private-invitation" readOnly value={invite} />
                    <button
                      className="subtle-button"
                      onClick={() => copy(invite)}
                    >
                      Copy invitation
                    </button>
                  </>
                )}
              </div>
              <div className="admin-subsection">
                <h3>Customer response</h3>
                <button
                  className="subtle-button"
                  onClick={() =>
                    setMessage(
                      `Hello ${selected.name},\n\nBased on your request, a local onsite technician may be the better next step. Please contact a qualified local AV professional or your original integrator. We have not booked or charged you for a consultation.\n\n${business.name}`,
                    )
                  }
                >
                  Use local-technician response
                </button>
                <label htmlFor="customer-response">Message to customer</label>
                <textarea
                  id="customer-response"
                  value={message}
                  maxLength={6000}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <div className="admin-actions">
                  <button
                    className="button button-secondary"
                    disabled={busy || !message.trim()}
                    onClick={() => action("respond")}
                  >
                    Queue email response
                  </button>
                  <button
                    className="subtle-button"
                    disabled={!message.trim()}
                    onClick={() => copy(message)}
                  >
                    Copy for manual sending
                  </button>
                </div>
              </div>
              <div className="admin-subsection">
                <h3>Additional work / custom quotes</h3>
                <p>
                  Record the agreed scope and status here. Quotes are sent
                  manually; saving a record does not charge the customer or
                  prove their approval. Record written authorization before
                  starting work or collecting payment.
                </p>
                {quotes.map((q) => (
                  <button
                    className="quote-record"
                    key={q.id}
                    onClick={() => {
                      setQuote(q);
                      setAmount(String(q.price_cents / 100));
                    }}
                  >
                    {q.service} · ${(q.price_cents / 100).toFixed(2)}
                    <small>
                      Approval: {q.approval_status} · Payment:{" "}
                      {q.payment_status} · Project: {q.project_status}
                    </small>
                  </button>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action("quote");
                  }}
                >
                  <div className="form-field">
                    <label htmlFor="quote-service">Type of service</label>
                    <input
                      id="quote-service"
                      value={quote.service}
                      required
                      maxLength={150}
                      onChange={(e) =>
                        setQuote({ ...quote, service: e.target.value })
                      }
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="quote-scope">Description and scope</label>
                    <textarea
                      id="quote-scope"
                      value={quote.scope}
                      required
                      minLength={5}
                      maxLength={6000}
                      onChange={(e) =>
                        setQuote({ ...quote, scope: e.target.value })
                      }
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="quote-price">Proposed price (USD)</label>
                    <input
                      id="quote-price"
                      type="number"
                      min="0.01"
                      max="1000000"
                      step="0.01"
                      required
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                  {(
                    [
                      [
                        "approval_status",
                        "Customer approval",
                        ["pending", "approved", "declined"],
                      ],
                      [
                        "payment_status",
                        "Payment status",
                        ["unpaid", "paid", "partially_paid", "refunded"],
                      ],
                      [
                        "project_status",
                        "Project status",
                        ["proposed", "active", "completed", "canceled"],
                      ],
                    ] as const
                  ).map(([field, label, options]) => (
                    <div className="form-field" key={field}>
                      <label htmlFor={`quote-${field}`}>{label}</label>
                      <select
                        id={`quote-${field}`}
                        value={quote[field]}
                        onChange={(e) =>
                          setQuote({ ...quote, [field]: e.target.value })
                        }
                      >
                        {options.map((option) => (
                          <option key={option} value={option}>
                            {option.replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <div className="form-field">
                    <label htmlFor="quote-notes">
                      Internal notes / authorization reference
                    </label>
                    <textarea
                      id="quote-notes"
                      value={quote.internal_notes}
                      maxLength={6000}
                      onChange={(e) =>
                        setQuote({ ...quote, internal_notes: e.target.value })
                      }
                    />
                  </div>
                  <div className="admin-actions">
                    <button className="button" disabled={busy}>
                      {quote.id ? "Update quote record" : "Save quote record"}
                    </button>
                    <button
                      type="button"
                      className="subtle-button"
                      onClick={() => {
                        setQuote({ ...blank });
                        setAmount("");
                      }}
                    >
                      New quote
                    </button>
                  </div>
                  <details>
                    <summary>Manual quote text</summary>
                    <textarea
                      aria-label="Manual quote text"
                      readOnly
                      value={quoteText}
                    />
                    <button
                      type="button"
                      className="subtle-button"
                      onClick={() => copy(quoteText)}
                    >
                      Copy quote
                    </button>
                  </details>
                </form>
              </div>
            </div>
          ) : (
            <p>Select a request to review its details and attachments.</p>
          )}
        </div>
      </div>
    </section>
  );
}
