"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ShieldCheck, Video, RefreshCw } from "lucide-react";
import { business } from "@lib/business";
import { PhotoGallery, type SupportPhoto } from "./photo-gallery";
type TicketData = {
  id: string;
  name: string;
  issue: string;
  equipment: string;
  summary: string;
  plan: "expert" | "video" | "consultation";
  status: string;
  clarification_used: boolean;
};
type Message = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};
export default function Ticket() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [ticket, setTicket] = useState<TicketData>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [photos, setPhotos] = useState<SupportPhoto[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [deleted, setDeleted] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch(`/api/consulting/tickets/${id}`, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setTicket(d.ticket);
    setMessages(d.messages);
    setPhotos(d.photos || []);
  }, [id]);
  useEffect(() => {
    let active = true;
    async function start() {
      try {
        const token = location.hash.slice(1);
        if (token) {
          const r = await fetch("/api/consulting/tickets/access", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, token }),
          });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error);
        }
        history.replaceState(null, "", location.pathname);
        if (active) await load();
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    }
    void start();
    return () => {
      active = false;
    };
  }, [id, load]);
  useEffect(() => {
    if (!ticket?.status || ticket.status === "closed") return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load().catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [load, ticket?.status]);
  async function post(path: string, payload: object) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      return d;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const d = await post(`/api/consulting/tickets/${id}`, { message: draft });
    if (d) {
      setDraft("");
      await load();
    }
  }
  async function booking() {
    const d = await post(`/api/consulting/tickets/${id}/booking`, {});
    if (d) {
      const u = new URL(d.url);
      if (u.protocol === "https:" && u.hostname === "calendly.com")
        location.assign(u.href);
      else setError("Invalid scheduling address. Please contact support.");
    }
  }
  async function remove() {
    setBusy(true);
    try {
      const r = await fetch(`/api/consulting/tickets/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setDeleted(true);
      setTicket(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (deleted)
    return (
      <div className="notice">
        Your support request and messages have been deleted. Required payment
        accounting records may be retained without the ticket contents.
      </div>
    );
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!ticket ? (
        <p>
          Open the full private link from your email to access your request.
        </p>
      ) : (
        <>
          <div className="notice">
            <ShieldCheck />
            Private support page · Keep your emailed link secure. Status:{" "}
            {ticket.status}
          </div>
          <div className="form-panel">
            <h2>Hello, {ticket.name}.</h2>
            <div className="prose">
              <h3>Your issue</h3>
              <p style={{ whiteSpace: "pre-wrap" }}>{ticket.issue}</p>
              <h3>Your equipment</h3>
              <p>{ticket.equipment || "No equipment details provided."}</p>
            </div>
            <PhotoGallery photos={photos} caseId={id} />
            {ticket.summary && (
              <details>
                <summary
                  style={{ cursor: "pointer", fontSize: 13, marginBottom: 15 }}
                >
                  Your troubleshooting context
                </summary>
                <pre className="summary-box">{ticket.summary}</pre>
              </details>
            )}
            {ticket.plan !== "expert" ? (
              <>
                <div className="notice">
                  <Video />
                  Your{" "}
                  {ticket.plan === "consultation"
                    ? business.consultation.minutes
                    : 30}
                  -minute consultation is paid. Choose a time using your
                  private, single-use scheduling link. Choose phone or Zoom
                  during booking. Calendly supplies the meeting details.
                </div>
                <button
                  className="button"
                  disabled={busy || ticket.status === "closed"}
                  onClick={booking}
                >
                  Choose an appointment
                </button>
              </>
            ) : (
              <>
                <h3 style={{ margin: "25px 0 15px" }}>
                  Your expert conversation
                </h3>
                {!messages.length && (
                  <p>
                    Your request is in the queue. We’ll email when your expert
                    response is ready.
                  </p>
                )}
                {messages.map((m) => (
                  <div className={`ticket-message ${m.role}`} key={m.id}>
                    <small>
                      {m.role === "expert" ? "AV EXPERT" : "YOU"} ·{" "}
                      {new Date(m.created_at).toLocaleString()}
                    </small>
                    <p>{m.content}</p>
                  </div>
                ))}
                {ticket.status === "answered" && !ticket.clarification_used && (
                  <form onSubmit={send}>
                    <label htmlFor="clarification">
                      Your one included clarification
                    </label>
                    <textarea
                      id="clarification"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      maxLength={3000}
                      required
                    />
                    <button
                      className="button"
                      disabled={busy || !draft.trim()}
                      style={{ marginTop: 15 }}
                    >
                      Send clarification
                    </button>
                  </form>
                )}
                {ticket.clarification_used && (
                  <div className="notice">
                    Your included clarification has been received. This support
                    package includes one expert response and one customer
                    clarification.
                  </div>
                )}
                <button
                  className="subtle-button"
                  onClick={() => load().catch((e) => setError(e.message))}
                  style={{ marginTop: 20 }}
                >
                  <RefreshCw size={13} />
                  Refresh conversation
                </button>
              </>
            )}
          </div>
          <div style={{ marginTop: 25 }}>
            {!deleteConfirm ? (
              <button
                className="subtle-button"
                onClick={() => setDeleteConfirm(true)}
              >
                Delete this request and its messages
              </button>
            ) : (
              <div className="notice warning">
                <div>
                  Deletion permanently removes your issue details, messages, and
                  access link. It does not cancel a scheduled appointment or
                  request a refund.
                  <div style={{ display: "flex", gap: 20, marginTop: 15 }}>
                    <button
                      className="button button-secondary"
                      disabled={busy}
                      onClick={remove}
                    >
                      Permanently delete
                    </button>
                    <button
                      className="subtle-button"
                      onClick={() => setDeleteConfirm(false)}
                    >
                      Keep request
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
