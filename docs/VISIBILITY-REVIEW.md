# First-pass visibility review — November 27, 2026

## Indexing and phone corrections

- `/consulting` has no site-controlled `noindex`. Explicit header rules keep the legal, admin, completion, invitation, and ticket routes excluded. Unknown consulting routes still render the private shell with HTML noindex. The public `/consulting/av-proposal-review` page remains indexable. Legal pages also carry HTML `noindex,follow` and their own canonicals. The private app shell keeps `noindex,nofollow` and no longer points its canonical at the public landing page.
- `/`, `/consulting`, and `/privacy.html` self-canonicalize on `https://genxav.com`. The sitemap also includes the two new public service pages: `/home-automation-troubleshooting-charlotte` and `/consulting/av-proposal-review`. Robots allows crawling so exclusions can be read and points to that sitemap.
- `/index.html` → `/`, `/consulting.html` → `/consulting`, and the legal HTML aliases → their canonical paths use permanent 308 redirects. Redirects run before internal rewrites. Trailing slashes normalize without becoming alternative canonicals.
- Charlotte-area system support uses `(704) 247-7074` / `tel:+17042477074`. Nationwide consulting uses `(714) 312-6729` / `tel:+17143126729`, including all consulting headers and footers. The homepage contact section labels both services; its existing structured data uses the same contacts.

## Content and preservation

The homepage retains “Expert AV Support for Complex Systems & Projects” as its headline. Supporting copy explains existing Crestron and Savant troubleshooting/rescue, programming, nationwide remote support, and select Charlotte-area onsite work. Consulting copy explains independent advice, upgrade planning, proposal reviews, the free request review, and the conditional $99 / 30-minute Zoom offer. A visible FAQ separates that initial consultation from custom-quoted detailed reviews and follow-up work. Matt Evans’s experience is stated as 29 years.

The platform disclaimer and legal body copy are retained. Intake, attachment, payment, booking, feature-flag, provider, database, and email implementation files are unchanged. No customer submissions or payments were made in this review.

## Verification

- `npm run build`, `npm run typecheck`, and `npm test`: passed (106 tests, including 23 HTTP crawl/contact checks). The focused SEO suite also passed after the final header-rule adjustment.
- Local HTTP: 200 responses, self-canonicals, route-specific header/meta exclusions, 308 redirects including query preservation and no loops, robots/sitemap content, and 28 distinct internal link/anchor/asset destinations passed. Legal/privacy `<main>` contents match the default branch exactly.
- The local preview reads the repository’s redirect/header configuration. It models this project’s rules, not all Vercel platform behavior. Preview hosts may inject an additional platform `noindex`; check the route-specific rules locally rather than removing preview protection.
- Browser: homepage and consulting reviewed at 320px and 375px; no horizontal overflow after correcting the existing narrow homepage header. Desktop consulting navigation fits at 1081px. Mobile menu, labeled phone links, visible FAQ, and both rendered intake forms checked without submitting. No browser errors were recorded during the local review.
- Remaining release checks: after Matt merges/deploys, verify the real Vercel edge’s redirect/header behavior and canonical production responses. Search-engine crawling/index inclusion cannot be confirmed in a local review. Actual submissions, email delivery, booking, and payments were intentionally not exercised.

## Topic pages added to this PR

- `/home-automation-troubleshooting-charlotte`: symptom examples, scope/access considerations, Charlotte onsite versus nationwide remote support, preparation guidance, FAQs, and a link to the existing Project Intake form. Uses the local support number.
- `/consulting/av-proposal-review`: review topics, what to share, timing questions, nationwide Zoom access, and the boundary between the $99 initial conversation and separately quoted detailed work. Uses the consulting number and existing free request form.
- Both are linked from their relevant parent service sections and cross-link where useful. The main menus are unchanged. Both have self-canonicals, matching Service structured data, permanent HTML-alias redirects, and sitemap entries. Neither creates a new intake or payment workflow.
- Browser checks: desktop views, 375px proposal layout, and both pages at 320px have no horizontal overflow. Each page’s main CTA reaches its existing, rendered intake form without submission. Service schemas match the visible service/phone details; detailed proposal reviews do not claim a flat $99 price.

## Suggestions and remaining follow-ups

1. Add an approved, anonymized rescue example and a redacted proposal-review example once Matt supplies verified material. Current symptom/question examples are illustrative, not invented customer cases or testimonials.
2. Confirm the Charlotte onsite service radius, detailed-review deliverables, and realistic turnaround before publishing those specifics.
3. Consider a dedicated programming page and an About page after reviewing these first two topic pages.
4. Optimize the oversized logo and add a favicon in a small, separate follow-up. The narrow-header CSS fix here changes display sizing only, not the image asset.

No merge, production deployment, DNS change, or Vercel project-setting change is part of this PR.
