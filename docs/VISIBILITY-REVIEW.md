# First-pass visibility review — November 27, 2026

## Indexing and phone corrections

- `/consulting` has no site-controlled `noindex`. The descendant rule `/consulting/(.*)` keeps legal and private routes excluded. Legal pages also carry HTML `noindex,follow` and their own canonicals. The private app shell keeps `noindex,nofollow` and no longer points its canonical at the public landing page.
- `/`, `/consulting`, and `/privacy.html` self-canonicalize on `https://genxav.com`. Only these three indexable URLs are in the sitemap. Robots allows crawling so exclusions can be read and points to that sitemap.
- `/index.html` → `/`, `/consulting.html` → `/consulting`, and the legal HTML aliases → their canonical paths use permanent 308 redirects. Redirects run before internal rewrites. Trailing slashes normalize without becoming alternative canonicals.
- Charlotte-area system support uses `(704) 247-7074` / `tel:+17042477074`. Nationwide consulting uses `(714) 312-6729` / `tel:+17143126729`, including all consulting headers and footers. The homepage contact section labels both services; its existing structured data uses the same contacts.

## Content and preservation

Homepage copy leads with troubleshooting and rescue for existing Crestron and Savant systems, programming, nationwide remote support, and select Charlotte-area onsite work. Consulting copy explains independent advice, upgrade planning, proposal reviews, the free request review, and the conditional $99 / 30-minute Zoom offer. A visible FAQ separates that initial consultation from custom-quoted detailed reviews and follow-up work. Matt Evans’s experience is stated as 29 years.

The platform disclaimer and legal body copy are retained. Intake, attachment, payment, booking, feature-flag, provider, database, and email implementation files are unchanged. No customer submissions or payments were made in this review.

## Verification

- `npm run build`, `npm run typecheck`, and `npm test`: passed (100 tests, including 17 new HTTP crawl/contact checks). The focused SEO suite also passed after the final header-rule adjustment.
- Local HTTP: 200 responses, self-canonicals, route-specific header/meta exclusions, 308 redirects including query preservation and no loops, robots/sitemap content, and 24 distinct internal link/anchor/asset destinations passed. Legal/privacy `<main>` contents match the default branch exactly.
- The local preview reads the repository’s redirect/header configuration. It models this project’s rules, not all Vercel platform behavior. Preview hosts may inject an additional platform `noindex`; check the route-specific rules locally rather than removing preview protection.
- Browser: homepage and consulting reviewed at 320px and 375px; no horizontal overflow after correcting the existing narrow homepage header. Desktop consulting navigation fits at 1081px. Mobile menu, labeled phone links, visible FAQ, and both rendered intake forms checked without submitting. No browser errors were recorded during the local review.
- Remaining release checks: after Matt merges/deploys, verify the real Vercel edge’s redirect/header behavior and canonical production responses. Search-engine crawling/index inclusion cannot be confirmed in a local review. Actual submissions, email delivery, booking, and payments were intentionally not exercised.

## Follow-up scope (not public pages in this PR)

1. `/home-automation-troubleshooting-charlotte`: use actual customer questions and verified rescue examples.
2. `/consulting/av-proposal-review`: define verified review scope, questions, and custom-quote boundaries.
3. Consider a dedicated programming page and an About page after the first two.
4. Link each new page from relevant services, add only its live indexable canonical to the sitemap, and ensure structured data matches the visible content.
5. Optimize the oversized logo and add a favicon in a small, separate follow-up. The narrow-header CSS fix here changes display sizing only, not the image asset.

No merge, production deployment, DNS change, or Vercel project-setting change is part of this PR.
