# Parked: storefront for selling the starter

This branch (`park/storefront-app`) holds the original "how to sell this" prototype, merged
with main as of 2026-09-24. It is **not meant to merge into the starter**: the storefront
would ship to every business app built from the starter.

## Where the pieces went

| Piece | Destination |
|---|---|
| `LICENSE`, `COMMERCIAL-LICENSE.md`, `TERMS-OF-SALE.md` | Starter PR #139 |
| Admin integrations status | Starter PR #140 (only Resend can report connected) |
| Landing fallback when backend is unreachable | Starter PR #141 (demo/contact links optional, translated) |
| Waitlist role / company / use case | Starter PR #142 (optional fields, backward compatible) |
| Pricing, services, demo pages; footer + sitemap links | **Storefront app** |
| Lemon Squeezy webhooks, `commerceCustomers/Orders`, `licenses`, commerce settings | **Storefront app** |
| Rewritten privacy / terms (mentions purchases, invoices) | **Storefront app** |
| Waitlist "budget timeline" question | **Storefront app** |
| Session-create email-verification hook in `auth.ts` | Dropped: main enforces verification at the app layer |

## Storefront app plan

Build it as the first real business app on the starter, which also rehearses `UPGRADING.md`:

1. Cut the starter's first release (`v1.0.0`) from main (never tag a PR branch).
2. Create the storefront repo from that tag and port the storefront pieces above.
3. Before shipping: translate the English-only pages, add tests for the webhook handler
   (signature check, idempotency, refunds), and make prices/tiers agree with `COMMERCIAL-LICENSE.md`.
4. Take later starter releases through the normal upgrade process.
