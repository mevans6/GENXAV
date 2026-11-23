"use client";
import { useState } from "react";
import Link from "next/link";
import { business, consultationPrice, intakeNeeds } from "@lib/business";
import { preparePhoto } from "./photo-upload";
type Attachment = {
  key: string;
  file: File;
  name: string;
  uploadedId?: string;
};
export default function IntakeForm() {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [done, setDone] = useState("");
  const [id, setId] = useState(() => crypto.randomUUID());
  function changed() {
    setId(crypto.randomUUID());
    setFiles((current) => current.map(({ uploadedId: _id, ...f }) => f));
  }
  async function choose(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files || []);
    e.target.value = "";
    setError("");
    if (selected.length + files.length > 6) {
      setError("Choose up to six attachments.");
      return;
    }
    setPreparing(true);
    try {
      const additions: Attachment[] = [];
      for (const original of selected) {
        let file = original;
        if (original.type === "application/pdf") {
          if (!original.size || original.size > 3 * 1024 * 1024)
            throw Error("Each PDF must be smaller than 3 MB.");
        } else file = await preparePhoto(original);
        additions.push({ key: crypto.randomUUID(), file, name: original.name });
      }
      setFiles((current) => [
        ...current.map(({ uploadedId: _id, ...f }) => f),
        ...additions,
      ]);
      setId(crypto.randomUUID());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreparing(false);
    }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || preparing) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const attachments: string[] = [];
      for (const [index, file] of files.entries()) {
        if (file.uploadedId) {
          attachments.push(file.uploadedId);
          continue;
        }
        setProgress(`Uploading attachment ${index + 1} of ${files.length}…`);
        const payload = new FormData();
        payload.set("file", file.file);
        const r = await fetch("/api/consulting/intake/attachments", {
          method: "POST",
          body: payload,
        });
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        attachments.push(d.id);
        setFiles((current) =>
          current.map((item) =>
            item.key === file.key ? { ...item, uploadedId: d.id } : item,
          ),
        );
      }
      setProgress("Sending your request…");
      const r = await fetch("/api/consulting/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          name: f.get("name"),
          email: f.get("email"),
          phone: f.get("phone"),
          location: f.get("location"),
          need: f.get("need"),
          description: f.get("description"),
          website: f.get("website"),
          attachments,
          consent: f.get("consent") === "on",
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setDone(d.reference);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  if (done)
    return (
      <div className="form-panel intake-confirmation" role="status">
        <h2>Your request has been saved for review.</h2>
        <p>
          We’ll review your situation and follow up using the email you
          provided. If a remote consultation is appropriate, you’ll receive a
          private invitation for a {consultationPrice} /{" "}
          {business.consultation.minutes}-minute appointment. Other work can be
          discussed through a custom quote.
        </p>
        <p>
          Submitting this request is free. It does not include technical advice,
          reserve an appointment, or authorize any charge.
        </p>
        <small>Request reference: {done.slice(0, 8).toUpperCase()}</small>
      </div>
    );
  return (
    <div className="support-layout">
      <form className="form-panel" onSubmit={submit} onChange={changed}>
        <h2>Tell us about your situation.</h2>
        <p>
          Use your own words. You don’t need technical terminology, equipment
          brands, or model numbers. Photos and documents are welcome if you have
          them.
        </p>
        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="intake-name">Your name</label>
            <input
              id="intake-name"
              name="name"
              autoComplete="name"
              required
              maxLength={100}
              disabled={busy}
            />
          </div>
          <div className="form-field">
            <label htmlFor="intake-email">Email address</label>
            <input
              id="intake-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              disabled={busy}
            />
          </div>
        </div>
        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="intake-phone">Phone number (optional)</label>
            <input
              id="intake-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              maxLength={50}
              disabled={busy}
            />
          </div>
          <div className="form-field">
            <label htmlFor="intake-location">City and state</label>
            <input
              id="intake-location"
              name="location"
              autoComplete="address-level2"
              required
              minLength={2}
              maxLength={150}
              placeholder="For example, Charlotte, NC"
              disabled={busy}
            />
          </div>
        </div>
        <div className="form-field">
          <label htmlFor="intake-need">What do you need help with?</label>
          <select
            id="intake-need"
            name="need"
            required
            defaultValue=""
            disabled={busy}
          >
            <option value="" disabled>
              Choose the closest fit
            </option>
            {intakeNeeds.map((need) => (
              <option key={need}>{need}</option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="intake-description">Describe your situation</label>
          <textarea
            id="intake-description"
            name="description"
            required
            minLength={20}
            maxLength={6000}
            placeholder="What’s happening, what are you considering, or what decision would you like help with?"
            disabled={busy}
          />
        </div>
        <div className="form-field photo-field">
          <label htmlFor="intake-files">Files or photos (optional)</label>
          <p id="intake-file-help">
            Up to six JPEG, PNG, WebP, or PDF files. Photos up to 20 MB are
            resized; PDFs must be under 3 MB each. Files are stored privately and emailed with your request.
            Remove passwords, account numbers, and unnecessary personal details
            first.
          </p>
          <input
            id="intake-files"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            multiple
            onChange={choose}
            disabled={busy || preparing || files.length >= 6}
            aria-describedby="intake-file-help"
          />
          {preparing && <p role="status">Preparing attachments…</p>}
          {files.length > 0 && (
            <ul className="intake-files">
              {files.map((file) => (
                <li key={file.key}>
                  <span>{file.name}</span>
                  <button
                    type="button"
                    className="subtle-button"
                    disabled={busy || preparing}
                    onClick={() => {
                      setFiles(
                        files
                          .filter((item) => item.key !== file.key)
                          .map(({ uploadedId: _id, ...item }) => item),
                      );
                      setId(crypto.randomUUID());
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="intake-honeypot" aria-hidden="true">
          <label htmlFor="intake-website">Website</label>
          <input
            id="intake-website"
            name="website"
            tabIndex={-1}
            autoComplete="off"
          />
        </div>
        <label className="check-label">
          <input name="consent" type="checkbox" required disabled={busy} />
          <span>
            I agree to the <Link href="/privacy.html">privacy policy</Link> and
            understand this is a free request for review, not a free technical
            consultation. No payment or appointment is created by submitting it.
          </span>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button" disabled={busy || preparing}>
          {busy
            ? progress
            : preparing
              ? "Preparing attachments…"
              : "Submit request for review"}
        </button>
      </form>
      <aside className="support-summary">
        <h2>Start with the right next step.</h2>
        <p>
          Your situation is reviewed before we recommend a paid consultation.
        </p>
        <ul>
          <li>Free to submit</li>
          <li>No equipment expertise required</li>
          <li>Your details and files emailed to our consulting team</li>
          <li>Choose a time and pay only after review</li>
        </ul>
        <p>
          A suitable initial consultation is {consultationPrice} for{" "}
          {business.consultation.minutes} minutes. Additional consulting is
          quoted separately and requires your authorization.
        </p>
        <small>
          The consultation purchases professional advice and time. Repairs and
          remote resolution are not guaranteed.
        </small>
      </aside>
    </div>
  );
}
