"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export function CheckoutComplete() {
  const [ticketUrl, setTicketUrl] = useState("");
  const [message, setMessage] = useState("Verifying your payment…");
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const sessionId = new URLSearchParams(location.search).get("session_id");
    if (!sessionId) {
      setMessage("Open your emailed private link to access your request.");
      return;
    }
    async function check() {
      try {
        const response = await fetch("/api/consulting/checkout/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (
          data.state === "paid" &&
          /^\/consulting\/ticket\/[0-9a-f-]{36}$/.test(data.ticketUrl)
        ) {
          setTicketUrl(data.ticketUrl);
          setMessage(
            "Your payment is verified. Your private support page is ready.",
          );
        } else if (++attempts < 30) timer = setTimeout(check, 2000);
        else
          setMessage(
            "Payment confirmation is taking longer than usual. Your private link will also be sent by email when confirmation is complete.",
          );
      } catch (error) {
        if (!controller.signal.aborted) setMessage((error as Error).message);
      }
    }
    void check();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  return (
    <div>
      <div className="notice" role="status">
        <ShieldCheck />
        <span>{message}</span>
      </div>
      {ticketUrl && (
        <Link className="button" href={ticketUrl}>
          Open my private support page
        </Link>
      )}
      <p className="checkout-help">
        Your paid consultation includes a one-time scheduling link. Keep your
        private link secure. Additional work requires a separate quote and
        authorization.
      </p>
    </div>
  );
}
