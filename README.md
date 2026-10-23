<div align="center">

<img src="docs/logo.svg" alt="" width="88" height="88" />

<h1>HE Status Page</h1>

<p><strong>A self-hosted IT status page for higher education.</strong><br/>
Automatically polls the providers you already depend on, publishes incidents and scheduled maintenance, and rebrands to your institution with a handful of environment variables — no fork required.</p>

<p>
<img alt="status: v1.0" src="https://img.shields.io/badge/status-v1.0-1e40af">
<img alt="license: MIT" src="https://img.shields.io/badge/license-MIT-1e40af">
<img alt="stack: Next.js 16 | Express 4 | Postgres 16" src="https://img.shields.io/badge/stack-Next.js%2016%20%7C%20Express%204%20%7C%20Postgres%2016-334155">
<img alt="SSO: CAS | OIDC | SAML" src="https://img.shields.io/badge/SSO-CAS%20%7C%20OIDC%20%7C%20SAML-16a34a">
</p>

<p>
<a href="#quick-start-development">Quick Start</a> ·
<a href="#features">Features</a> ·
<a href="#configuration">Configuration</a> ·
<a href="#deployment">Deployment</a> ·
<a href="#provider-adapters">Adapters</a>
</p>

</div>

Status is collected automatically by polling the upstream providers you already depend on (Microsoft 365, Google Workspace, Zoom, and friends), supplemented with admin-published incidents and maintenance windows. Everything visible to visitors — the site name, organization, logo, and accent color — is set through configuration, so rebranding it for your institution is a matter of editing a handful of environment variables rather than forking the code. The frontend is built with accessibility in mind (semantic markup, keyboard-navigable admin, WCAG-minded color and contrast choices).

## Demo

![HE Status Page demo](docs/demo.gif)

### Screenshots

Public status page — overall status banner with active incidents and a status legend:

![Public status page showing active incidents](docs/status-page.png)

Microsoft Teams notification on a service status change:

![Microsoft Teams status-change notification](docs/teams-notification.png)

## Features

- **Automatic status polling** of upstream providers on a configurable interval (Microsoft 365, Google Workspace, Zoom/Statuspage-style pages, Apple, AWS, LibreNMS, Ellucian Banner health endpoints, and generic HTTP health checks).
- **Incidents & maintenance windows** — admins can open, update, and resolve incidents and schedule (including recurring) planned-maintenance windows.
- **Email subscriptions** with double opt-in verification over SMTP.
- **Microsoft Teams notifications** via incoming webhooks.
- **Admin dashboard** with an HttpOnly-cookie session (CSRF-protected), optional CAS, OIDC, or SAML single sign-on, and hashed API keys for programmatic access.
- **Service dependencies & categories** for grouping and rolling up status.
- **One-place rebranding** — site name, org name, logo, and primary color are all configuration.
- **Accessibility-minded** UI and **data-retention** controls for historical status.
- **Two deployment paths** — Docker Compose or bare-metal systemd units.

## Architecture

The project is an npm-workspaces monorepo written in TypeScript. Four packages share a single PostgreSQL database:

```
                         ┌───────────────────┐
   visitors ───────────▶ │  frontend          │  Next.js 16 (App Router), React 19
                         │  (public + admin)  │
                         └─────────┬──────────┘
                                   │  HTTP /api/*
                                   ▼
                         ┌───────────────────┐
                         │  backend           │  Express 4 REST API
                         │                    │  JWT auth, optional CAS, API keys
                         └─────────┬──────────┘
                                   │
                                   ▼
                         ┌───────────────────┐        ┌───────────────────┐
                         │  PostgreSQL 16     │ ◀───── │  poller            │
                         │  (services,        │        │  node-cron service │
                         │   incidents, …)    │        │  provider adapters │
                         └───────────────────┘        └───────────────────┘

   shared (@he-status/shared): constants, email templates, Teams webhook helpers
   — imported by backend and poller.
```

| Package    | Stack                                              | Responsibility                                             |
| ---------- | -------------------------------------------------- | ---------------------------------------------------------- |
| `backend`  | Express 4, PostgreSQL (`pg`), JWT, bcrypt          | REST API, admin auth (JWT / CAS / API keys), email, Teams  |
| `frontend` | Next.js 16 (App Router), React 19                  | Public status page and admin dashboard                     |
| `poller`   | node-cron, `pg`                                    | Polls provider adapters on a schedule, writes status       |
| `shared`   | TypeScript library (`@he-status/shared`)           | Constants, email templates, Teams webhook helpers          |

## Quick start (development)

Prerequisites: **Node.js >= 20** and a **PostgreSQL 16** database (Docker or local).

```bash
# 1. Clone and configure
git clone <your-fork-or-repo-url> he-status-page
cd he-status-page
cp .env.example .env          # then edit .env (at minimum set POSTGRES_PASSWORD / DATABASE_URL)

# 2. Install all workspaces
npm install

# 3. Build the shared package (required before the backend/poller can typecheck or run)
npm run build -w @he-status/shared

# 4. Start PostgreSQL
#    Option A — Docker (starts only the database container):
docker compose up -d hestatus-db
#    Option B — use a local PostgreSQL 16 and point DATABASE_URL at it in .env

# 5. Run migrations and seed starter data
npm run db:setup              # = db:migrate + db:seed
#    (or run them individually: npm run db:migrate  /  npm run db:seed)

# 6. Run the backend + poller (dev, with reload). `predev` rebuilds shared automatically.
npm run dev

# 7. In a second terminal, run the frontend.
#    Next dev defaults to port 3000, which the backend also uses — run it on another
#    port and point the browser API calls at the backend:
NEXT_PUBLIC_API_URL=http://localhost:3000 npm run dev:frontend -- -p 3001
```

Then open the frontend (e.g. http://localhost:3001). The default admin login comes from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` (seeded on first `db:seed`).

Useful root scripts (see `package.json`):

| Script                | Does                                                             |
| --------------------- | --------------------------------------------------------------- |
| `npm run dev`         | Runs backend + poller together (`predev` builds `shared` first) |
| `npm run dev:backend` | Backend only (`tsx watch`)                                      |
| `npm run dev:poller`  | Poller only (`tsx watch`)                                       |
| `npm run dev:frontend`| Frontend only (`next dev`)                                      |
| `npm run db:migrate`  | Apply SQL migrations (`backend/src/db/migrate.js`)              |
| `npm run db:seed`     | Seed starter services / admin (`backend/src/db/seed.ts`)        |
| `npm run db:setup`    | Migrate then seed                                               |
| `npm test`            | Run the test suite once (Vitest)                                |

## Configuration

All configuration lives in a single `.env` file at the repo root (copy from `.env.example`). Every variable is listed below.

> **Rebrand in one place.** To make the status page yours, set `SITE_NAME`, `ORG_NAME`, `NEXT_PUBLIC_LOGO_PATH`, `PRIMARY_COLOR`, and `NEXT_PUBLIC_BASE_PATH` (plus their `NEXT_PUBLIC_*` twins). Nothing else needs to change.

> **Build-time vs runtime.** Variables prefixed `NEXT_PUBLIC_` are read by the frontend and are **baked in at build time**. In Docker they are passed as build args (see `docker-compose.yml`); changing them requires rebuilding the frontend image. Non-prefixed variables are read at runtime by the backend/poller.

### Database

| Variable            | Description                                                       | Default in `.env.example`                                    |
| ------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| `DATABASE_URL`      | PostgreSQL connection string used by backend and poller           | `postgresql://hestatus:password@localhost:5432/hestatus`     |
| `POSTGRES_USER`     | Postgres user (used by the Docker db container)                   | `hestatus`                                                   |
| `POSTGRES_PASSWORD` | Postgres password (**required** by `docker-compose`; change it)   | `password`                                                   |
| `POSTGRES_DB`       | Postgres database name (used by the Docker db container)          | `hestatus`                                                   |

### Server

| Variable                    | Description                                                                                             | Default   |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | --------- |
| `NODE_ENV`                  | `development` or `production`                                                                           | `development` |
| `PORT`                      | Port the backend API listens on (the value the backend actually reads)                                 | `3000`    |
| `HOST`                      | Interface the backend listens on. `127.0.0.1` accepts only a same-host reverse proxy; set `0.0.0.0` if the proxy is elsewhere (docker-compose does) | `127.0.0.1` |
| `TRUST_PROXY`               | Comma-separated addresses/CIDRs (or `loopback`, `linklocal`, `uniquelocal`) of proxies allowed to set `X-Forwarded-For`. Hop counts are rejected because they trust any peer | `loopback` |
| `RATE_LIMIT_PUBLIC_ENABLED` | Set `false` to disable the public API rate limiter (does not affect login/subscribe limiters)          | `true`    |

### Auth

| Variable         | Description                                       | Default                              |
| ---------------- | ------------------------------------------------- | ------------------------------------ |
| `JWT_SECRET`     | Secret used to sign admin JWTs (**required, must be ≥16 characters** — the backend fails fast at startup if missing or too short; change the default) | `your-secret-key-change-in-production` |
| `JWT_EXPIRES_IN` | JWT lifetime (also the session cookie's Max-Age)  | `7d`                                 |
| `COOKIE_SECURE`  | Send the session/CSRF cookies only over HTTPS. **Must be `true` in production.** Set `false` only for local http dev. Defaults to `true` when `NODE_ENV=production`, else `false`. | _(empty)_ |
| `COOKIE_DOMAIN`  | Optional cookie domain. Leave unset for a host-only cookie; set a parent domain only to share the session across subdomains. | _(empty)_ |

The admin session JWT is stored in an **HttpOnly** cookie (`hsp_session`) — never in
`localStorage`, so it is not readable by JavaScript/XSS. Mutating requests are
protected with a double-submit CSRF token: a readable `hsp_csrf` cookie is set
alongside the session and the frontend echoes it back automatically in the
`X-CSRF-Token` header. Programmatic clients using a `Bearer` token or `X-API-Key`
are unaffected (they are not CSRF-able and skip the CSRF check).

### Poller

| Variable                  | Description                          | Default |
| ------------------------- | ------------------------------------ | ------- |
| `POLLER_INTERVAL_MINUTES` | How often the poller checks services | `5`     |
| `POLLER_ENABLED`          | Set `false` to disable polling       | `true`  |
| `POLLER_ALLOW_PRIVATE_ENDPOINTS` | Allow endpoints resolving to private/loopback/link-local addresses (cloud metadata always blocked) | `false` |

Admin-configured status endpoints are checked against this address policy when a
service is saved and again on every connection the poller makes, including each
redirect hop, so DNS rebinding or a redirect to an internal host can't get around
it. Teams webhook URLs follow a stricter rule regardless of this setting: they must
be `https://` URLs on public addresses, and redirects are not followed.

### Branding (rebrand in one place)

| Variable                    | Description                                                    | Default             |
| --------------------------- | ------------------------------------------------------------- | ------------------- |
| `SITE_NAME`                 | Site name (backend/email)                                     | `IT Status`         |
| `NEXT_PUBLIC_SITE_NAME`     | Site name shown in the UI (build-time)                        | `IT Status`         |
| `ORG_NAME`                  | Organization name (backend/email)                             | `Example University`|
| `NEXT_PUBLIC_ORG_NAME`      | Organization name shown in the UI (build-time)                | `Example University`|
| `NEXT_PUBLIC_LOGO_PATH`     | Path to the logo served from the frontend (build-time)        | `/logo.svg`         |
| `PRIMARY_COLOR`             | Primary/accent color (backend/email)                          | `#1e40af`           |
| `NEXT_PUBLIC_PRIMARY_COLOR` | Primary/accent color used in the UI (build-time)              | `#1e40af`           |

### URLs & routing

| Variable                | Description                                                                                                       | Default                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `PUBLIC_URL`            | Public URL of the site (used in email templates and CAS service URL construction)                                | `https://status.example.edu` |
| `NEXT_PUBLIC_BASE_PATH` | Path prefix the frontend is served under (empty = domain root; build-time)                                       | _(empty)_                  |
| `NEXT_PUBLIC_API_URL`   | URL or path prefix the browser uses to reach the backend API (empty = same origin; build-time)                   | _(empty)_                  |
| `FRONTEND_URL`          | Frontend origin, used for CORS and CSP `frame-ancestors`                                                          | `http://localhost:3001`    |

### Email (SMTP)

| Variable          | Description                          | Default             |
| ----------------- | ------------------------------------ | ------------------- |
| `SMTP_HOST`       | SMTP server host                     | `smtp.example.edu`  |
| `SMTP_PORT`       | SMTP server port                     | `25`                |
| `SMTP_USER`       | SMTP username (optional)             | _(empty)_           |
| `SMTP_PASS`       | SMTP password (optional)             | _(empty)_           |
| `EMAIL_FROM`      | From address for notifications       | `status@example.edu`|
| `EMAIL_FROM_NAME` | From display name                    | `IT Status`         |

### Provider credentials

| Variable            | Description                                                | Default   |
| ------------------- | ---------------------------------------------------------- | --------- |
| `MS_TENANT_ID`      | Microsoft 365 tenant ID (for the `microsoft_graph` adapter)| _(empty)_ |
| `MS_CLIENT_ID`      | Microsoft 365 app client ID                                | _(empty)_ |
| `MS_CLIENT_SECRET`  | Microsoft 365 app client secret                            | _(empty)_ |
| `LIBRENMS_URL`      | Base URL of your LibreNMS instance                         | `https://your-librenms-instance.example.com` |
| `LIBRENMS_API_TOKEN`| LibreNMS API token                                         | _(empty)_ |

### Subscription spam prevention (Cloudflare Turnstile)

The subscribe form is protected by [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/),
a free, privacy-friendly CAPTCHA alternative that is generally more accessible than
reCAPTCHA (no image puzzles). Create a widget at
[dash.cloudflare.com → Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile).
Leave the keys empty to disable the CAPTCHA entirely (useful for dev).

| Variable                         | Description                                             | Default   |
| -------------------------------- | ------------------------------------------------------- | --------- |
| `TURNSTILE_SECRET_KEY`           | Turnstile secret key (backend, server-side verify)      | _(empty)_ |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Turnstile site key exposed to the browser (build-time)  | _(empty)_ |

### Single sign-on (CAS / OIDC / SAML) (optional)

All SSO methods only *authenticate*; the `users` table *authorizes*. An admin who
signs in via CAS, OIDC, or SAML must already exist in the database with a matching
(lowercased) email, otherwise the login is rejected with a "not authorized" error.
SSO never auto-creates accounts. After a successful SSO authentication the backend
issues a short-lived, single-use code and redirects with only `?code=...`; the
frontend exchanges that code at `/api/admin/auth/exchange`, which sets the session
JWT as an HttpOnly cookie and returns only the user (the JWT never appears in a
URL or a response body, and never reaches JavaScript).

CAS is disabled unless `CAS_BASE_URL` is set.

| Variable          | Description                                | Default                                          |
| ----------------- | ------------------------------------------ | ------------------------------------------------ |
| `CAS_BASE_URL`    | CAS server base URL (enables CAS when set) | `https://login.example.edu/cas`                  |
| `CAS_LOGOUT_URL`  | CAS logout URL                             | `https://login.example.edu/cas/logout`           |
| `CAS_EMAIL_DOMAIN`| Domain appended to CAS usernames for email | `example.edu`                                    |
| `CAS_SERVICE_URL` | CAS callback (service) URL                 | `https://status.example.edu/api/admin/cas/callback` |

OIDC is disabled unless `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET`
are all set. It works with Entra ID, Okta, Google Workspace, Keycloak, and
Shibboleth-OIDC. The authorization-code flow uses PKCE (S256) and validates the
`id_token` (signature, issuer, audience, expiry, nonce).

| Variable             | Description                                                  | Default                                              |
| -------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| `OIDC_ISSUER`        | IdP issuer URL (enables OIDC when set with client id/secret) | `https://login.microsoftonline.com/<tenant>/v2.0`    |
| `OIDC_CLIENT_ID`     | OAuth client ID registered with the IdP                      | _(empty)_                                            |
| `OIDC_CLIENT_SECRET` | OAuth client secret                                          | _(empty)_                                            |
| `OIDC_REDIRECT_URI`  | Callback URL registered with the IdP                         | `${PUBLIC_URL}/api/admin/oidc/callback`              |
| `OIDC_SCOPES`        | Space-separated scopes requested                             | `openid email profile`                               |
| `OIDC_EMAIL_CLAIM`   | Claim used as the account e-mail. Use `preferred_username` for Entra ID | `email`                                   |
| `OIDC_REQUIRE_EMAIL_VERIFIED` | Accept the `email` claim only with `email_verified: true`. Set `false` only if users cannot edit their e-mail at the IdP | `true` |

An `email` claim is accepted only when the IdP marks it verified; otherwise anyone
who can set their own profile e-mail at the IdP could claim an admin's address.
Entra ID never sends `email_verified`, so set `OIDC_EMAIL_CLAIM=preferred_username`
(the tenant-managed UPN) there. On an account's first OIDC login the backend binds
it to the IdP's issuer and subject (`iss` + `sub`); later logins must present the
same subject, so a different IdP user with the same e-mail is rejected. If an
admin's IdP account is recreated, clear the binding:
`UPDATE users SET oidc_issuer = NULL, oidc_subject = NULL WHERE email = '...';`

SAML 2.0 is disabled unless `SAML_ENTRY_POINT`, `SAML_ISSUER`, and an IdP
certificate (`SAML_IDP_CERT` or `SAML_IDP_CERT_FILE`) are all set. It works with
Shibboleth, ADFS, Entra ID (SAML), Okta, and Keycloak. Assertion validation is
handled by [`@node-saml/node-saml`](https://github.com/node-saml/node-saml)
(XML-dsig); the backend requires **signed assertions** and validates the audience
(`=== SAML_ISSUER`), the assertion's `NotBefore`/`NotOnOrAfter` conditions, and
`InResponseTo`. `InResponseTo`/replay protection is backed by a PostgreSQL table
(`saml_flows`, migration `015`) so it survives restarts and works across multiple
backend instances. The IdP posts the `SAMLResponse` to the callback as a cross-site
form POST; that endpoint is deliberately unauthenticated (and therefore not
CSRF-guarded) because the assertion's XML signature — not a session/CSRF token — is
the protection. SP metadata is served at `${PUBLIC_URL}/api/admin/saml/metadata`
(once configured) to ease IdP registration.

| Variable               | Description                                                        | Default                                              |
| ---------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| `SAML_ENTRY_POINT`     | IdP SSO redirect URL (enables SAML when set with issuer + cert)    | `https://idp.example.edu/idp/profile/SAML2/Redirect/SSO` |
| `SAML_ISSUER`          | Our SP entity ID (also the expected assertion audience)           | `https://status.example.edu/saml`                    |
| `SAML_IDP_CERT`        | IdP signing certificate, PEM (single line, literal `\n` escapes)  | _(empty)_                                            |
| `SAML_IDP_CERT_FILE`   | Path to the IdP signing certificate PEM (read at call time)       | _(empty)_                                            |
| `SAML_CALLBACK_URL`    | ACS callback URL registered with the IdP                          | `${PUBLIC_URL}/api/admin/saml/callback`              |
| `SAML_EMAIL_ATTRIBUTE` | Attribute to read email from (else common claims, then NameID)    | _(empty)_                                            |
| `SAML_LOGOUT_URL`      | Optional single-logout URL                                        | _(empty)_                                            |
| `SAML_SP_PRIVATE_KEY`  | Optional SP private key (PEM) to sign AuthnRequests               | _(empty)_                                            |
| `SAML_SP_PRIVATE_KEY_FILE` | Path to the SP private key PEM                                | _(empty)_                                            |

### Initial admin

| Variable         | Description                                       | Default             |
| ---------------- | ------------------------------------------------- | ------------------- |
| `ADMIN_EMAIL`    | Email of the admin account created on seed        | `admin@example.edu` |
| `ADMIN_PASSWORD` | Password of the admin account (**change this**)   | `changeme`          |

## Deployment

### Docker Compose

`docker-compose.yml` defines five services: `hestatus-db` (Postgres 16), `hestatus-migrate` (a one-shot job that applies migrations before the app starts), `hestatus-backend`, `hestatus-frontend`, and `hestatus-poller`.

```bash
cp .env.example .env
# Edit .env — at minimum set POSTGRES_PASSWORD, JWT_SECRET, ADMIN_PASSWORD.
docker compose up -d --build
# Migrations run automatically (hestatus-migrate) before backend/poller start.

# Seed the starter services and admin account (one-time):
docker compose run --rm hestatus-migrate node backend/dist/db/seed.js
```

Notes:

- The backend and poller receive `DATABASE_URL` automatically, built from `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` and pointed at the `hestatus-db` service. `POSTGRES_PASSWORD` is required — Compose fails fast if it is unset.
- `NEXT_PUBLIC_*` values are passed as **build args** to the frontend image, so they are baked in at image build time. Change any of them → rebuild the frontend (`docker compose up -d --build hestatus-frontend`).
- The backend and frontend containers only `expose` port 3000 on the internal network; put a reverse proxy in front for TLS and public access.

### Bare metal (systemd)

Build order matters — build `shared` first, then the other packages:

```bash
npm ci
npm run build -w @he-status/shared
npm run build --workspace=backend
npm run build --workspace=poller
npm run build --workspace=frontend     # produces frontend/.next/standalone (output: standalone)
npm run db:migrate && npm run db:seed
```

Deploy the tree to `/opt/hestatus/hestatus` (the path the units assume) as a `hestatus` user, place your `.env` there, then install the three units from `deploy/systemd/`:

| Unit                        | Runs                                             |
| --------------------------- | ------------------------------------------------ |
| `hestatus-backend.service`  | `node backend/dist/index.js`                     |
| `hestatus-frontend.service` | `node frontend/.next/standalone/frontend/server.js` (listens on `127.0.0.1:3001`) |
| `hestatus-poller.service`   | `node poller/dist/index.js`                      |

```bash
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hestatus-backend hestatus-frontend hestatus-poller
```

Reverse-proxy expectations:

- Terminate TLS at a reverse proxy (e.g. nginx) and forward to the backend (`127.0.0.1:3000`) and frontend (`127.0.0.1:3001`). The backend listens on loopback only unless you set `HOST`.
- If you serve the app under a path prefix (e.g. `https://status.example.edu/status`), set `NEXT_PUBLIC_BASE_PATH=/status`, route `<prefix>/api` to the backend, and set `NEXT_PUBLIC_API_URL` to that prefix (e.g. `/status`) so the browser reaches the API at the right path. Serving at the domain root? Leave both empty.
- If the proxy is not on the same host, set `HOST=0.0.0.0`, firewall the backend port to the proxy, and set `TRUST_PROXY` to the proxy's address(es) so client IPs (rate limiting, logging) resolve correctly. Behind a load balancer → nginx chain, list both (e.g. `TRUST_PROXY=loopback,10.0.0.0/24`).

### Security checklist

- [ ] Set a strong, unique `JWT_SECRET` (never ship the default).
- [ ] Set a strong `POSTGRES_PASSWORD`.
- [ ] Change `ADMIN_PASSWORD` (and the seeded admin's password) from `changeme`.
- [ ] Run the app behind TLS (terminate HTTPS at your reverse proxy).
- [ ] Leave `COOKIE_SECURE` at its production default (`true`) so session cookies are HTTPS-only — set `false` only for local http dev.
- [ ] Restrict database access to the app hosts only.
- [ ] Configure `FRONTEND_URL`, `HOST`, and `TRUST_PROXY` to match your deployment.

## Provider adapters

The poller selects an adapter per service based on the service's `status_api_type`. Adapters live in `poller/src/adapters/`. Each service also stores a `status_api_endpoint` whose meaning depends on the adapter.

| `status_api_type` | Providers / use                                              | Endpoint                                              | Required env                                       |
| ----------------- | ------------------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------- |
| `statuspage`      | Any Statuspage.io-style page (Zoom, Canvas/Instructure, Qualtrics, …) | The provider's v2 status JSON URL (e.g. `https://status.zoom.us/api/v2/status.json`) | none                                               |
| `microsoft_graph` | Microsoft 365 service health                                 | Graph health-overviews URL (adapter calls Graph directly) | `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` |
| `google_status`   | Google Workspace status                                      | Optional (used only as an HTTP-probe fallback); adapter reads Google's public incidents feed | none                                               |
| `aws_status`      | AWS Service Health                                           | Optional HTTP-probe fallback; adapter reads AWS's public health status | none                                               |
| `apple_status`    | Apple System Status                                          | Optional HTTP-probe fallback; adapter reads Apple's system-status feed | none                                               |
| `librenms`        | On-prem devices/services/groups via LibreNMS                 | `device:<host_or_id>`, `service:<host>[:<type>]`, or `group:<name>` | `LIBRENMS_URL`, `LIBRENMS_API_TOKEN`               |
| `ellucian`        | Ellucian Banner (Managed Cloud) & generic HTTP health checks | Full health URL — a Spring Boot `/actuator/health` endpoint (parses `UP`/`DOWN`) or any URL (2xx/3xx = healthy) | none                                               |
| `manual`          | Status set by an admin, no polling                           | none                                                  | none                                               |

## Testing

Tests are written with [Vitest](https://vitest.dev/) and cover the shared email templates and several poller adapters/resilience helpers.

```bash
npm test          # run once
npm run test:watch
```

## License

Released under the [MIT License](LICENSE).

## Credits

Created by Zach Rossmiller at the University of Montana.
