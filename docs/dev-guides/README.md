# CMS developer guides

Technical manuals for developers who maintain the CMS or build client sites on
it. They sit alongside the Greek end-user guides in `docs/user-guides/`, which
explain the admin to clients. These guides explain the code.

Each guide follows the same outline: scope, file map, data model, how it works,
HTTP API, admin UI, configuration, recipes for extending it, tests, and gotchas.
Paths are repo-relative. When a guide and the code disagree, trust the code and
fix the guide.

| # | Guide | Covers |
|---|---|---|
| 01 | [Architecture, setup & conventions](01-architecture.md) | Layout of `src/cms`, public surface, config, route factory, modules, local setup, tests, CMS base vs client sites |
| 02 | [Database, migrations & seeds](02-database.md) | DB adapter, MySQL schema inventory, migrations, seeds, the `documents` model |
| 03 | [Content model](03-content-model.md) | Collections, field types, documents, read layer, MDX, shortcodes, import, preview, edit locks |
| 04 | [Admin UI](04-admin-ui.md) | Admin routes and shell, navigation, generic list/form, UI kit, feature managers, admin bar |
| 05 | [Authentication, users, roles & security](05-auth-users-security.md) | Login, sessions, MFA, roles and permissions, API tokens, secrets, audit log, endpoint security checklist |
| 06 | [Media, SEO, structured data & brand](06-media-seo-structured-data.md) | Upload pipeline, SEO fields, sitemaps and redirects, JSON-LD, the `pm` module, brand settings |
| 07 | [Forms, email & marketing](07-forms-email-marketing.md) | Forms, email sending, newsletter, popups, cookie consent, scripts manager, external reviews |
| 08 | [Commerce](08-commerce.md) | Products, cart, checkout, orders, payments, shipping, couriers, coupons, gift cards, customers |
| 09 | [Booking](09-booking.md) | `transport` and `stay` bookings, availability, reservations, booking payments |
| 10 | [Settings, scheduled jobs, updates & operations](10-settings-cron-operations.md) | Settings registry, cron, CMS updater, env var reference, deployment, languages |

## Keeping them current

- A change to a CMS area should update that area's guide in the same commit.
- Admin UI changes also update the user guides (`docs/user-guides/src/*.md`,
  then rebuild the PDFs), and every CMS change updates
  `docs/CMS-FEATURES-FOR-PROPOSALS.md`.
- Older docs in `docs/` (`BACKEND.md`, `BACKEND_V2_PLAN.md`, `BOOKING.md`,
  `ECOMMERCE*.md`) are historical planning notes. Where they conflict with
  these guides, these guides are more recent.
