# Upkept

This repository contains the initial skeleton for the **Upkept** website. It’s a simple, static website intended as a starting point for the platform.  

## Project structure

```
upkept/
├── index.html            # Landing page with overview and CTA
├── how-it-works.html     # Explains the process: post project → vetting → quotes → escrow → completion
├── post-project.html     # Intake form (placeholder) for homeowners to post a project
├── apply.html            # Application page for contractors
├── pricing.html          # Outline of future pricing model
└── style.css             # Basic styling shared across pages
```

## Running locally

Since the site is fully static, you don’t need any dependencies. You can simply open the HTML files in your browser or serve them via a simple HTTP server. For example:

```bash
# from the repository root
python3 -m http.server --directory upkept 8000
# Then visit http://localhost:8000 in your browser.
```

## Next steps

This skeleton is only a starting point. Future iterations might:

- Replace the static site with a full-featured framework like Next.js or React once npm access is available.
- Hook up the **Post a Project** form to a backend service and database.
- Add authentication, payments via Stripe, and a dashboard for homeowners and contractors.
- Expand the style guide and include a component library or CSS framework such as Tailwind.

Feel free to fork this repository and adapt it to your needs!