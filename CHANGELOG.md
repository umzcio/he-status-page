# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
