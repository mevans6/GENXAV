# Gen X AV consulting integration

## Current implementation

The original Gen X AV branding, core services, Charlotte positioning, and main contacts are retained. `/consulting` serves homeowners, estate managers, and residential project teams. The offer is $99 for a 30-minute Zoom consultation; additional work is custom-quoted. The chatbot remains disabled. Intake, private attachments, review/admin, quotes, invitations, and legacy paid-ticket components were adapted from Home AV Rescue without rebuilding either project or adding another framework.

The dedicated Supabase project is `home-av-rescue` (`gddxneqxyonwcfnoutrv`), not RiffForge. Consulting intake emails go to `consulting@genxav.com`, with submitted details and uploaded files as actual attachments. The user confirmed receipt of an actual intake with attachments. Main project leads remain separate and notify `matt@genxav.com`. Failed email stays queued without undoing a saved lead.

## Schedule first, then pay

1. Customer submits the free intake. No booking or charge is created.
2. Admin reviews suitability, approves the request, and sends the private invitation from `/consulting/admin`.
3. Customer agrees to the terms and opens a single-use Calendly link, using the intake email address. An HMAC-signed tracking value binds the booking to the approved request. An arbitrary request UUID or forwarded public link cannot trigger billing.
4. Customer reserves a 30-minute Zoom slot at least 24 hours ahead. Calendly sends its calendar invitation and Zoom details. These reserve time conditionally and do **not** establish payment.
5. The server verifies the signed Calendly webhook, then fetches the authoritative invitee/event. It checks event type, approval, email, Zoom location, duration, and notice period before registering the reservation.
6. The website creates one **Stripe-hosted Checkout Session per reservation**, rather than a reusable shared Payment Link. It emails the $99 link and exact deadline in the customer's Calendly timezone. Payment is due 12 hours after the verified booking/payment request is prepared. A delayed webhook does not backdate that window.
7. Unpaid scheduled reservations receive reminders at 6 and 11 hours. Repeated processing does not create a new session or notice. A missed processing cycle does not send both reminders in a burst.
8. The signed Stripe webhook verifies the stored session, $99 USD amount, and reservation/request metadata. The website confirms payment and stops reminders/cancellation. The browser return page is never proof of payment.
9. After the deadline, the worker expires Checkout, retrieves it again, and rechecks payment before canceling through Calendly. Payment completing at the deadline wins. If expiration cannot be verified, cancellation is deferred. A cancellation email follows a successful/reconciled Calendly cancellation.

Rescheduling uses the same reservation and payment; the original payment deadline remains. Stale cancellation webhooks cannot cancel the replacement appointment. A canceled reservation cannot be reused for a new booking; contact the operator for a fresh reviewed invitation.

## Failure behavior and operator follow-up

- A delayed payment can remain processing beyond the deadline. Do not cancel or charge again while Stripe reports processing. Prolonged processing and failed asynchronous attempts go to operator review.
- If the initial payment request was never delivered, the appointment goes to review rather than automatic cancellation.
- Repeated provider/delivery failures queue operator review. A customer-canceled appointment with a paid/processing payment requires follow-up for service or a refund.
- Late payment after cancellation goes to review, never an automatic paid-appointment confirmation. Refunds are not automatic.
- Full refunds are matched to the original intent/session even if the refund webhook arrives before the paid webhook. Refund and appointment cancellation remain separate actions.
- The admin dashboard shows reservation status, payment state, deadline, checkout reference, and review reason. Check Stripe and Calendly to resolve exceptions. No admin field can fabricate verified payment.
- Email uses durable notices and Resend idempotency keys. Delivery failures and ambiguous provider responses can require operator reconciliation.
- Issuing new booking links pauses if the five-minute scheduler heartbeat is older than 15 minutes. Previously issued links can still be used during an outage; monitor job health and the review queue.

## Calendly Free

Reused event: `https://calendly.com/mevans71-proton/30min`, API reference ending `374574bf-4998-4420-bbc9-6a7bd261d503`. It is renamed **Gen X AV — 30-Minute Consultation**, kept free/unlisted, set to Zoom only, and has a 15-minute after-meeting buffer. Minimum notice is 24 hours. The user's Monday–Friday 8am–8pm America/New_York schedule is retained. Google Calendar and Zoom were already connected. No subscription upgrade was purchased.

Use the same free event for `CALENDLY_EVENT_TYPE` (legacy prepaid tickets) and `CALENDLY_RESERVATION_EVENT_TYPE` (new schedule-first clients). Legacy customers carry no new signed correlation, and requests with a legacy case are excluded from the new billing path. Keep native Calendly payment collection **off** to prevent a second paywall. The separate inactive draft created earlier is unused.

Set the server's `CALENDLY_API_TOKEN` with event-type read, scheduling-link creation, scheduled-event/invitee read, and cancellation access. Register a user-scoped webhook for `invitee.created` and `invitee.canceled`, using the server's `CALENDLY_WEBHOOK_SIGNING_KEY`, at:

`https://genxav.com/api/consulting/webhooks/calendly`

The runtime token is configured in production. The active user-scoped webhook subscription ends `2042c4e9-dc52-4160-b9e3-673858b501d5`; real signed booking and cancellation deliveries passed. Calendly Free supports this setup without native payment collection. Codex’s Calendly connection is separate from the website token.

## Stripe

Use a separate sandbox to verify the flow before live activation. The Stripe SDK is pinned to 23.2.0, API `2026-11-18.endive`. No real customer charge was made during development.

Store a server-only restricted Stripe key in `STRIPE_SECRET_KEY`, with permissions for Checkout Session creation/retrieval/expiration and PaymentIntent retrieval. Configure payment methods in Stripe; the application does not hardcode a card-only allowlist. No sales-tax automation was enabled.

Register the endpoint below in the same Stripe sandbox/live account as the runtime key. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `charge.refunded`; put its signing secret in `STRIPE_WEBHOOK_SECRET`:

`https://genxav.com/api/consulting/webhooks/stripe`

Legacy paid-ticket fulfillment is retained. Failed asynchronous payments are reconciled by the periodic worker. A refund requires separate operator follow-up for the appointment.

The configured runtime key belongs to the Home AV Rescue sandbox. The existing sandbox destination’s signing secret was verified by an actual $99 test-card Checkout payment and signed webhook. The Stripe plugin still needs reauthentication, but runtime provider access works independently. Live activation requires the intended live account’s key and its separate webhook signing secret; check live checkout branding as well.

## Database and five-minute scheduler

The additive `supabase/migrations/20261122230644_schedule_first_consultations.sql` migration is applied to the dedicated hosted project. It adds reservation, event-history, notice, and scheduler-health records plus service-only registration/payment/lease functions. No existing customer rows, tickets, attachments, or policies were deleted. Do not reapply the reference migrations or blindly push this partial local migration history to the existing database.

All new tables have RLS and deny browser-role access. RPC execution is revoked from PUBLIC/anon/authenticated, granted only to service_role, and uses security-invoker. Linked financial records prevent automatic intake deletion; this app's purge excludes those intakes. Establish financial-record retention before adding cleanup.

The existing once-daily Vercel maintenance call is only a fallback for notice retries. Hour-based reminders need the prepared `supabase/schedule-first-cron.sql` job, which calls maintenance every five minutes through Supabase Cron/pg_net. First store these secrets in Supabase Vault:

- `genxav_maintenance_url`: `https://genxav.com/api/consulting/maintenance`
- `genxav_cron_secret`: the same server-only `CRON_SECRET` as the website

The job sends `x-genxav-scheduler: five-minute`; only this authenticated call updates the heartbeat. GET/POST maintenance both require constant-time bearer verification. The job is installed and active as `genxav-consultation-maintenance` (job 2), with schedule `*/5 * * * *`. Its scheduled HTTP response was 200 and its heartbeat was verified. The additive networking migration enables pg_net. The pre-existing retention job was preserved. Normal timing has up to one five-minute cycle of delay; outages can delay it further.

## Environment and activation

`.env.local` is ignored by Git. The user's working Supabase/Resend values are retained. Missing local access, cron, and Calendly-signature secrets were generated without printing them. Preserve existing deployment signing secrets to retain private links. Server secrets must never enter public/client environment variables.

All required local and production server values are configured. The site is deployed to `https://genxav.com/consulting` with working public intake and signed webhook handlers. The five-minute worker is active. Local feature flags remain false. Production has `POLICIES_APPROVED=true`, `RESERVATION_AUTOMATION_ENABLED=true`, and `CONSULTATIONS_ENABLED=false` because its Stripe key is a sandbox key.

A temporary `CONSULTATION_SANDBOX_REQUEST_IDS` allowlist admitted only two synthetic owner-email requests while public booking stayed closed. It requires a test Stripe key and all normal prerequisites, and never enables the public configuration endpoint. The production allowlist was emptied after acceptance and redeployed. Do not add real customer requests to this field.

Run `npm run consulting:check` for safe configuration status. `.env.example` documents all variables. Preserve the deployed signing secrets when switching Stripe keys so existing private links remain valid. Do not place server secrets in public/client variables.

Activation order:

1. Add runtime credentials and register both webhooks, first against a public sandbox/preview endpoint. Keep production feature flags off.
2. Deploy the built website and configure its environment. Keep new booking issuance closed until the payment handler and worker are reachable.
3. Configure the five-minute job and verify its authenticated heartbeat.
4. Exercise a complete sandbox intake → approval → booking → email → payment → confirmation, plus unpaid reminders/cancellation and a reschedule. Use synthetic recipients/appointments; do not cancel real meetings to test.
5. Review terms, switch to the intended live Stripe key/webhook secret, verify production integrations and scheduler, then set `POLICIES_APPROVED=true`, `RESERVATION_AUTOMATION_ENABLED=true`, `CONSULTATIONS_ENABLED=true`.

Deployment and sandbox acceptance are complete. The worker is enabled; issuing paid consultation booking invitations publicly remains disabled until live Stripe configuration is verified. The deployed snapshot includes the consulting source; the source and setup documentation are maintained in the Gen X AV GitHub repository.

## Verification — November 22, 2026

- Type checking and production build pass; 83 tests pass. PostgreSQL/PGlite provider fixtures cover signatures, approval/email/legacy isolation, duplicates, reminders, deadline payment races, processing payments, cancellation retries, reschedule carryover/stale events, refund ordering, private database access, scheduler health, and sandbox admission restrictions.
- Production homepage and `/consulting` return 200; public configuration reports booking disabled and chatbot disabled. Unauthenticated maintenance returns 401. Supabase Cron made a real authenticated HTTP call with status 200 and a fresh scheduler heartbeat.
- Two synthetic owner-email intake submissions persisted through the deployed API, were approved, and received private invitations. The deployed booking endpoint created single-use links. Real Calendly bookings preserved the signed request correlation and were registered by the signed webhook with Zoom details.
- A browser submitted Stripe’s standard 4242 test card for $99 USD. Stripe reports `livemode=false`, session complete, payment paid; the signed handler recorded payment and sent customer/operator confirmations. The browser return displayed “Consultation confirmed.” No real money was charged.
- On the other synthetic reservation, advancing only its test deadline exercised both reminder stages and the unpaid deadline. The normal production worker expired its Checkout, canceled the Calendly meeting, and sent the cancellation email. Resend reports invitations, payment requests, reminders, confirmations, and cancellation as delivered.
- Both synthetic Calendly appointments were canceled after verification. Synthetic intake/reservation/payment audit records remain clearly labeled as tests. Canceling the paid test correctly generated operator review rather than fabricating a refund. The sandbox charge remains a test payment; no real refund is owed.
- Real provider rescheduling and live-money acceptance have not been exercised; reschedule behavior is covered by database/provider fixtures. Recheck the live endpoint’s webhook delivery when installing live Stripe credentials before opening paid bookings.
- Hosted checks confirm RLS/no anonymous SELECT on all new tables. Advisors report expected server-only RLS/no-policy informational notices and the pre-existing leaked-password-protection warning. Authentication settings were unchanged.

Production deployment after closing the sandbox exception: `dpl_3ifcd2FB6N7h4ixRYG6M8CNbhdSC`. Public canonical URL: `https://genxav.com`. Credentials and Vault values were not printed or committed.
