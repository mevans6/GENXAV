# Gen X AV

The existing static marketing site has two pathways: core services/project support on the homepage, and homeowner/estate/project-team consulting at `/consulting`. The original Gen X AV logo, typography, colors, Charlotte positioning, and main contacts are retained.

- Main services: `matt@genxav.com`, `(704) 247-7074`
- Consulting: `consulting@genxav.com`, `(714) 312-6729`

## Development

Node 22+ required. Run `npm ci`, copy `.env.example` to ignored `.env.local`, configure providers, then `npm run build` and `npm run dev`. Preview: `http://127.0.0.1:3000`. Run `npm run typecheck` and `npm test`. `npm run consulting:check` reports missing configuration without revealing secrets.

`npm run build` copies the static site to `dist/`, compiles the consulting React island, and compiles Node API handlers. No Next.js runtime, Tailwind, AI SDK, or second website is introduced. Keep `api/intake.js` as the tracked build wrapper; generated API bundles and `dist/` remain ignored. Vercel must run the build before tracing functions.

## Structure

- `index.html`, `styles.css`, `script.js`: retained core services/local marketing site and lead form
- `consulting.html`, `consulting.css`: Gen X AV consulting landing page
- `client/`: intake, private review/admin, invitation and reservation/payment status UI; legacy paid-ticket UI retained
- `server/lib/`, `server/routes/`: adapted consulting workflow and security controls
- `server/cookies.ts`, `server/adapter.ts`: request-scoped Node adapter replacing Next cookie APIs; raw webhook bodies preserved
- `server/integrator.ts`: categorized, durable integrator lead submission
- `supabase/reference-migrations/`: existing consulting schema reference and executable SQL-test fixtures; do not reapply to the already-configured database
- `supabase/genx-calendly-paid-booking-link.sql`: additive columns for single-use native paid Calendly links
- `supabase/migrations/20261122230644_schedule_first_consultations.sql`: applied private reservation billing schema and RPCs
- `supabase/schedule-first-cron.sql`: active five-minute scheduler using Supabase Vault; setup reference for recovery
- `supabase/genx-integrator-lead-category.sql`: additive inquiry categorization and notification tracking, already applied to the dedicated consulting database
- `docs/CONSULTING-INTEGRATION.md`: configuration, verification evidence, and remaining launch work

The chatbot is disabled and no chat endpoint or AI client is included. Older local copies in `Previous-Versions/` remain excluded from Git and deployments.

Consultations reserve time first, then email a separate $99 Stripe checkout, remind at 6/11 hours, and cancel unpaid reservations after a 12-hour deadline. Calendly Free is supported. Runtime keys, signed webhooks, and a five-minute scheduler must be configured and tested before enabling the feature flags. See the integration document for activation and failure handling.

The consulting site and signed webhooks are deployed. Sandbox payment, delivered reminders, unpaid cancellation, and scheduled worker heartbeat passed acceptance; 83 tests pass. Both synthetic calendar appointments were removed. Public paid bookings remain disabled until live Stripe credentials and the live webhook secret are configured and verified. See `docs/CONSULTING-INTEGRATION.md`.
