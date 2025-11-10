# Upkept

This repository now contains a working prototype of the **UpKept** marketplace, including the marketing site, portal dashboards,
and an upgraded backend that simulates escrow-backed payments, contractor verification, reviews, and analytics without any third-party dependencies.

## Project structure

```
upkept/
├── index.html               # Landing page with overview and CTA
├── client-portal.html       # Client dashboard fed by the API
├── contractor-portal.html   # Contractor workspace with live projects/quotes
├── admin-dashboard.html     # Admin oversight with live metrics
├── login.html               # Combined registration/sign-in page
├── style.css                # Shared design system
└── script.js                # Front-end logic for API calls & dashboards

src/
├── data-store.js            # JSON-backed data layer with escrow, verification, review, and payment helpers
├── web-app.js               # HTTP server, routing, and chatbot endpoints
└── server.js                # Entrypoint that boots the service

tests/
└── api.test.js              # Node test that exercises registration, escrow, verification, and chatbot flows
```

## Running locally

1. Start the API/website server:

```bash
npm start
```

The command boots a minimal Node server (no external packages required) that serves both the static assets and JSON API at <http://localhost:3000>.

2. Visit the experience at `http://localhost:3000/upkept/index.html` or jump straight into `/upkept/client-portal.html` and `/upkept/contractor-portal.html`.

## Publishing the static site

If you want to host the marketing experience as a static website (for example on GitHub Pages or Netlify) without the optional Node
server, point your host to the repository root. The new top-level `index.html` automatically redirects visitors to
`upkept/index.html`, so all existing pages, styles, and assets load with their original structure intact. On hosts that support it,
you can also serve the `upkept/` directory directly for a pure static deployment.

## Tests

The repository uses the built-in Node test runner to confirm the primary marketplace flows—registration, contractor verification,
quote approvals, escrow funding/release, reviews, and Kee chatbot prompts—work end-to-end.

```bash
npm test
```

## Next steps

- Swap the JSON data store for a production database (PostgreSQL or MongoDB) with migrations and backups.
- Integrate real payment processors (Stripe Connect, PayPal) in place of the simulated escrow ledger.
- Connect Kee to an AI assistant API and wire real-time messaging between clients and contractors.
- Extend the admin dashboard with dispute workflows, CMS controls, and exportable analytics.
