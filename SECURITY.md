# Security Policy

## Supported versions

Security fixes land on `main` and in the most recent tagged release. `v1.0.x` is
the currently supported line.

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

Use GitHub's private reporting: go to the **Security** tab → **Report a
vulnerability** (GitHub Security Advisories). That opens a private channel with
the maintainers where a fix can be coordinated before disclosure.

Please include:

- a description of the issue and its impact,
- steps to reproduce (or a proof of concept), and
- affected version/commit and configuration if relevant.

We aim to acknowledge reports within a few business days and will keep you
updated as we work on a fix. Responsible disclosure is appreciated; we're happy
to credit reporters in the release notes unless you prefer to remain anonymous.

## Deploying securely

This is self-hosted software; a safe deployment depends on your configuration.
At minimum:

- Set a strong, unique `JWT_SECRET` (the backend refuses to start if it is
  missing or shorter than 16 characters).
- Set strong `POSTGRES_PASSWORD` and `ADMIN_PASSWORD` values.
- Run behind TLS and set `COOKIE_SECURE=true` in production (the admin session
  is an `HttpOnly`, CSRF-protected cookie).
- Restrict database access to the application hosts.
- SSO (CAS / OIDC / SAML) only *authenticates* — the `users` table *authorizes*.
  Admin accounts must be provisioned in the database; SSO never auto-creates them.

See the README's [Deployment](README.md#deployment) section for the full
security checklist.
