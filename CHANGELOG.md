# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

Fixes for 17 findings from a Claude Security scan.

- **Admin login and sessions.** The backend now binds to `127.0.0.1` by
  default (`HOST`) and trusts `X-Forwarded-For` only from listed proxy
  addresses (`TRUST_PROXY`, default `loopback`), so clients can't spoof their
  IP to dodge rate limits. Failed logins are also limited per account; a
  browser that has signed in to the account before is exempt from the
  per-account lockout. Every failed login costs the same bcrypt work, so
  response timing doesn't reveal which emails have accounts.
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
- **Untrusted provider data.** Response sizes are capped, stored poller
  responses are limited to 64 KB, status text is cleaned into bounded plain
  text, and Teams cards escape markdown.

### Upgrade notes

- Run migrations (adds `016_session_and_identity_hardening.sql`). Existing
  admin sessions are invalidated once and users must sign in again.
- `TRUST_PROXY_HOPS` is no longer read. If your reverse proxy isn't on the same
  host, set `HOST=0.0.0.0` and `TRUST_PROXY=<proxy address or CIDR>`.
  docker-compose sets both for you.
- If you use OIDC with Entra ID, set `OIDC_EMAIL_CLAIM=preferred_username`.

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
