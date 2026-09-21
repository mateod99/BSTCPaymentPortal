# BSTC Club Portal — setup and operating guide

## Claude-reference revision

This version adapts the supplied soccer-registration project’s public homepage, program detail pages, family dashboard, online-only payments, waiver-only signup, configurable fees/tax, encrypted admin Stripe settings, fee waivers and waitlist notifications. BSTC branding and the existing hosted database are preserved. It is an adaptation to the existing Cloudflare application, not a replacement with the reference’s PostgreSQL/Prisma deployment.

Public pages now use a separate club header/footer and full-page authentication. `/preview/admin` and `/preview/portal` retain explicitly labeled sample views for review; protected live routes remain under `/admin` and `/portal`.

A waiver-only signup saves the signed text without consuming capacity or creating a payment. Completion rechecks the current registration window and capacity; a full program moves the record to the waitlist. Cancellation notifies the first waiting family when it releases a roster spot. This notification does not hold that spot.

## Architecture
React 19 / TypeScript with the Vinext framework, reusable accessible Shadcn controls, a Cloudflare Worker API, and Cloudflare D1 (relational SQLite). The hosted environment uses D1 rather than PostgreSQL. Every persistence operation uses bound SQL parameters. Money is stored as integer US cents. Browser storage is not used for family or financial records.

The public preview is explicitly marked as sample data. Demo records are not inserted into the live database. Live tables start empty; administrators can load sample **draft seasons** in Settings → integrations. The organization must confirm its real location, schedule, fees, capacity, waiver, and age limits before opening a season.

## Database
The migration files in `drizzle/` create accounts, sessions, verification/reset tokens, player profiles, parent-player relationships, divisions, seasons, registrations, immutable signed waivers, transactions, refunds, discount codes, internal notes, notifications, audit logs, and settings. Questions are stored with their season and answers with their registration; guardian contact information is stored in the account and player profile. This is a deliberate denormalization, not a standalone questions/answers/waiver-templates model.

The logical D1 binding in `.openai/hosting.json` is `DB`. Sites provisions its database and applies the packaged migrations. Do not insert seed data into schema migrations. For a standalone Cloudflare account, create a D1 database, bind it as DB, and apply SQL migrations in order using Wrangler. D1 batches make registration creation, capacity selection, waiver capture, and financial updates atomic. Do not modify applied migrations.

## Administrator and parent authentication
Set `ADMIN_EMAIL` to the exact authorized administrator email through the Site's secure environment settings. The administrator can use **Sign in with ChatGPT**; only the configured email is eligible for this bootstrap. Successful ChatGPT login by itself does not confer administrator privileges. Existing roles are always respected.

Parents use email/password accounts. Connect Resend first: registration intentionally refuses to create accounts without email verification delivery configured. Passwords use salted PBKDF2-SHA256 (100,000 iterations, Web Crypto). Cookies are Secure, HttpOnly, SameSite=Lax; session tokens and reset tokens are hashed at rest. Verification expires after 24 hours, resets after one hour, and sessions after seven days. Users must verify email before registration. Adults create accounts and manage children; children do not get accounts.

Roles:
- Parent: own family, registrations, waivers and receipts only.
- Staff: all registrations, family details, internal notes, reminders and exports; cannot configure seasons, issue refunds, record payments or change roles.
- Administrator: staff access plus seasons, finance and permissions.

To add a staff/admin account, have the adult register and verify email, then change their role under Users & permissions. An administrator cannot change their own role.

## Transactional email
Set `RESEND_API_KEY` and `EMAIL_FROM` on a verified sending domain. Email covers verification, reset, registration confirmation, payment receipts, reminders and deletion-request acknowledgement. A notifications table records Sent, Failed or Queued. No background delivery/retry worker is included; queued or failed messages require administrator follow-up. Email failures should be reviewed before opening registrations.

## Stripe
Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` through secure environment settings, or enter Stripe credentials under Admin → Settings → Organization & Stripe settings. For admin-saved credentials, first configure an `AUTH_SECRET` of at least 32 random characters. Secrets are encrypted with AES-256-GCM, never returned in plaintext, and only a masked hint is displayed. Environment values are the fallback. Rotating AUTH_SECRET requires re-entering encrypted credentials. Blank form fields preserve existing credentials. Start with Stripe test mode. In Stripe configure the HTTPS endpoint:

`https://YOUR_SITE/api/stripe/webhook`

Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired`.

The server creates hosted Checkout sessions for the current balance. Signature validation uses the raw request body, HMAC-SHA256 and a five-minute timestamp tolerance. Webhook event handling is idempotent by Checkout session reference. A browser redirect never marks a registration paid. No raw card details enter the application. Administrators can configure a processing-fee percentage, fixed processing fee and tax percentage. The checkout review displays each amount separately. The charge breakdown is frozen with each new registration; future setting changes do not change that registration. A zero-price registration adds no processing fee. This is not an automatic tax-jurisdiction engine. Discount codes support percentage reductions. No installment schedule is included; partial online payment events are supported.

New payments are online-only: the cash/check interface and offline-payment API are disabled. Historic payment records are retained. Refunds and fee waivers require an administrator and confirmation. A Stripe refund uses the original payment intent. A refund must fit within one original transaction; split larger multi-transaction refunds. Pending/failed refunds require provider review. Refunds made directly in Stripe are not automatically synchronized; reconcile and record them through the organization’s finance workflow. Overpayments from concurrent external payment flows require administrative reconciliation. Cancelling a registration does not automatically issue a refund.

## Google Sheets
Create Google OAuth **Web application** credentials, enable the Google Sheets and Drive APIs, and configure this exact redirect URI:

`https://YOUR_SITE/api/google/callback`

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Reports → Connect Google Sheets requests only `drive.file`, uses a single-use expiring state token tied to the administrator, and creates a new spreadsheet. No refresh token is retained. This is an authorized one-time export of all registrations, not a scheduled background sync. It omits contact and medical details. CSV and XLSX exports support filtered records and chosen columns. Formula-like CSV values are neutralized; XLSX text is written as inline strings, never formulas.

## Local development and verification
Requires Node 22.13+ and the project dependencies. Use the existing installation workflow, then:

- `npm run db:generate` after schema changes; inspect generated migrations.
- `npm run build` for the Worker and client build.
- `node --test tests/club.test.mjs` for the BSTC integration suite.

The tests transpile the actual service and authentication code into a temporary directory, substitute only the D1 adapter with an in-memory relational SQLite database, apply the real migrations, and run requests against the real service handler. They cover login verification, permissions, family isolation, required waiver/question checks, duplicate prevention, atomic capacity/waitlisting, immutable waiver snapshots, partial and idempotent online payments, rejection of offline payment requests, refunds, internal note isolation, CSV/XLSX exports, archival safety, forged/valid/replayed Stripe webhooks cross-origin write rejection, waiver-only capacity behavior, encrypted Stripe configuration, fee arithmetic and fee-waiver authorization. Provider network calls and live email deliverability still require testing with your credentials. No browser end-to-end test suite is included.

## Privacy, retention and launch review
Access is restricted server-side for every private API and protected route. Never put secrets in source, logs or client components. The `.env.example` contains names only; configure hosted values through secure Site settings. Bound queries, React escaping, no-store responses, same-origin writes, rate limiting, hashed tokens and role checks protect the core flows. A production security review remains required.

The draft privacy/terms/participation waiver are not legal advice. Have a qualified attorney review youth data handling, electronic signatures, liability, refund policies, authorized guardian consent and your jurisdiction before public launch. Replace draft policy text with the approved policies and the real organization contact details. The club must define legal retention periods for medical data, registrations, payments and waivers. Account deletion requests appear in the audit log for manual review; there is no automatic erasure service. Use a reviewed maintenance procedure to anonymize/delete only records outside legally required retention periods. Clean expired sessions, tokens and rate-limit rows with a scheduled maintenance job. Signed waiver records cannot be updated; corrections require a new registration and signature.

The deployed Site is private for owner review. Public availability, live payments, email and Google export are not enabled by the private preview alone. Before onboarding families: configure providers and admin email, approve policies, run Stripe test payment/refund and email verification/reset end to end, verify your real season dates, and explicitly publish to the intended parent audience.


## Card-data boundary (required)
Stripe is not enabled until club credentials and a verified webhook are configured. Use Stripe-hosted Checkout exclusively: the browser navigates to checkout.stripe.com and submits card numbers and CVV directly to Stripe. BSTC creates sessions using a registration ID and server-calculated balance; it does not provide card-entry fields or card-processing endpoints. Never add raw card data to requests to BSTC, database records, logs, analytics, fixtures, support notes, or Git history. Do not enable request-body logging on payment routes. Signed Stripe webhooks confirm payment; a browser redirect is not proof of payment. Store only payment amounts, status, and provider references. Never collect card data for the offline HTML preview.
