# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

Fixes for 43 findings from four Claude Security scans.

- **Admin login and sessions.** The backend now binds to `127.0.0.1` by
  default (`HOST`) and trusts `X-Forwarded-For` only from listed proxy
  addresses (`TRUST_PROXY`, default `loopback`), so clients can't spoof their
  IP to dodge rate limits. Rate limits group each IPv6 client's /64 into one
  bucket. Password login (`POST /api/admin/login`) is now **off by default**
  (`PASSWORD_LOGIN_ENABLED`); the admin UI signs in with SSO only. When
  enabled, each account gets 10 password checks per 15 minutes however many
  addresses are guessing, and past that a request needs a solved Turnstile
  CAPTCHA. Every failed login costs the same bcrypt work, so response timing
  doesn't reveal which emails have accounts.
- **Session revocation.** Logout revokes the session server-side. Password
  resets and the new "Sign out everywhere" action end all of a user's sessions.
  Users with audit history can now be deleted.
- **OIDC.** The `email` claim is accepted only with `email_verified: true`, and
  each account is bound to the IdP's `iss` + `sub` on first login. For Entra ID,
  set `OIDC_EMAIL_CLAIM=preferred_username`.
- **Hidden services stay hidden.** They no longer appear in public service
  detail, uptime, history, or incidents, and they never trigger subscriber
  email. Public service detail no longer exposes monitoring config.
- **Subscriptions.** The subscribe endpoint returns the same response whatever
  state the address is in, and the verification page escapes the stored
  address.
- **SSRF.** Status endpoints and Teams webhooks are checked against the address
  policy on every connection, including each redirect hop, which also defeats
  DNS rebinding. Webhooks must use public HTTPS and never follow redirects, and
  delivery errors keep only the HTTP status. LibreNMS identifiers are validated
  and percent-encoded.
- **Leaks.** Errors are logged without request headers, so the LibreNMS token
  no longer appears in logs. Public status and incident text no longer include
  raw fetch errors such as endpoints, hosts, or IPs.
- **Subscriptions** also respond before doing any work that depends on the
  address's state, so response timing doesn't reveal it either.
- **Poller resilience.** Every fetch has a 30 s wall-clock deadline and every
  service check a 3 min deadline, so a slowly trickled response can't stall
  polling. A check that hits its deadline is cancelled (its requests aborted,
  nothing written), only one check per service runs at a time, a LibreNMS
  group check is one request however large the group, and the health check
  reports a stuck cycle.
- **Hidden services** are no longer named in other services' "affected by"
  dependency notes.
- **Untrusted provider data.** Response sizes are capped, stored poller
  responses are limited to 64 KB, status text is cleaned into bounded plain
  text, and Teams cards escape markdown.

- **Secure defaults.** The seed script needs `ADMIN_EMAIL` and never stores a
  placeholder or short `ADMIN_PASSWORD` (the account becomes SSO-only), and
  login always refuses placeholders such as `changeme`. Session cookies are
  `Secure` unless `COOKIE_SECURE=false`. Docker Compose and the systemd units
  run the backend and poller with `NODE_ENV=production`.
- **Sign-in endpoints.** Other websites can no longer spend a visitor's sign-in
  rate limit: SSO endpoints accept cross-site traffic only as real navigations,
  and login, code exchange and subscribe accept first-party JSON only. SSO and
  code exchange have their own budgets; rate-limit keys ignore ports.
- **Subscriptions.** Plain `.edu` addresses only, delivered to exactly that
  mailbox. One confirmation mail per address per hour and
  `VERIFICATION_MAIL_PER_HOUR` site-wide. Each confirmation link activates
  exactly the services listed in its email. SMTP requires STARTTLS unless
  `SMTP_REQUIRE_TLS=false`.
- **SSRF guard.** Guarded clients use their own connection pool and never a
  proxy. NAT64 addresses are judged by their embedded IPv4, and other
  IPv4-embedding IPv6 ranges are refused. Refusals no longer reveal DNS answers.
- **Public data.** The public services list no longer names the admin who set
  an override. Text published by v1.0.0 (raw fetch errors) is scrubbed by
  migration `018`.
- **Audit log.** Every admin change commits together with its audit row.
- **Poller.** The Apple feed's JSONP wrapper is parsed in linear time; a
  crafted feed could previously block the poller for hours.
- **Admin page.** Sign-in errors show fixed messages, never text from the URL.

### Upgrade notes

- Run migrations (adds `016` through `018`). Existing admin sessions are
  invalidated once and users must sign in again. Migration `017` keeps one
  subscription per address and stops mailing stored addresses that aren't
  plain `.edu` addresses; `018` scrubs old error text from public tables.
- **Rotate exposed credentials.** v1.0.0 published status endpoint URLs and
  network error details on the public status page and incidents, and could
  write the LibreNMS API token to the poller's logs. If any status endpoint URL
  contained credentials (e.g. `https://user:pass@…` or a token in the query),
  rotate them, and rotate `LIBRENMS_API_TOKEN`.
- **Reset default admin passwords.** If you seeded with the old default
  (`changeme`), that password no longer works for login; reset it from the
  Users screen if the account needs password login.
- Remove `NODE_ENV=development` from a production `.env`: under systemd it
  overrides the units' `NODE_ENV=production`.
- `ADMIN_EMAIL` must be set before `npm run db:seed`.
- SMTP now requires STARTTLS on ports other than 465. For a relay without TLS,
  set `SMTP_REQUIRE_TLS=false`.
- `TRUST_PROXY_HOPS` is no longer read. If your reverse proxy isn't on the same
  host, set `HOST=0.0.0.0` and `TRUST_PROXY=<proxy address or CIDR>`.
  docker-compose sets `HOST` for you, and the backend container won't start
  until `TRUST_PROXY` is set to your proxy container's IP (see README).
- If you use OIDC with Entra ID, set `OIDC_EMAIL_CLAIM=preferred_username`.
- Password login is off unless `PASSWORD_LOGIN_ENABLED=true`. Scripts that
  signed in with email and password should switch to API keys.

## [1.0.0] - 2026-07-15

Initial public release.

### Added

- **Automatic provider polling** on a configurable interval, with adapters for
  Microsoft 365, Google Workspace, Statuspage-style pages (Zoom, Canvas,
  Qualtrics, …), Apple, AWS, LibreNMS, Ellucian Banner health endpoints, and
  generic HTTP checks.
- **Incidents & maintenance windows** — create, update, and resolve incidents;
  schedule one-off and recurring planned-maintenance windows.
- **Email subscriptions** with double opt-in verification over SMTP.
- **Microsoft Teams notifications** via incoming webhooks.
- **Admin dashboard** with an `HttpOnly`, CSRF-protected cookie session and
  hashed API keys for programmatic access.
- **Single sign-on** via CAS, OIDC (discovery + PKCE), or SAML (signed
  assertions), all sharing a one-time-code callback so no token is ever placed
  in a URL. SSO authenticates; the users table authorizes.
- **Config-driven branding** — site name, organization, logo, accent color, and
  base path are all environment variables; no fork needed to rebrand.
- **Service dependencies & categories** for grouping and status roll-up.
- **Bot protection** on the subscribe form via Cloudflare Turnstile.
- **Accessibility** reviewed against WCAG 2.1 AA, plus configurable data
  retention for historical status.
- **Two deployment paths** — Docker Compose (with a one-shot migration service)
  and bare-metal systemd units.

### Stack

Next.js 16, React 19, Express 4, and PostgreSQL 16 in a TypeScript
npm-workspaces monorepo.

[Unreleased]: https://github.com/umzcio/he-status-page/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/umzcio/he-status-page/releases/tag/v1.0.0
