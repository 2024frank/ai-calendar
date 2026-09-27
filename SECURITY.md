# Security policy

AI Calendar holds reviewer accounts, unpublished events and credentials for publishing to community calendars, so security reports are taken seriously.

## Reporting a vulnerability

**Please do not open a public issue.** Report privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability**.

Include:

- what the issue is and where (file, endpoint, or screen),
- how to reproduce it,
- what an attacker could do with it.

You can expect an acknowledgement within a week. Once a fix ships, we will credit you in the advisory unless you would rather stay anonymous.

## Supported versions

Only the latest `main` is supported. Deployments should track it.

## Scope

In scope:

- tenant isolation (one community reading or changing another's data),
- authentication, sessions, password and sign-in links,
- the agent callback and per-run tokens,
- worker and cron endpoints,
- server-side fetching of user- or model-supplied URLs (SSRF),
- anything that leaks secrets or unreviewed events.

Out of scope: findings that need a compromised admin account or host, missing hardening headers without a demonstrated impact, and denial of service through volume alone.

## For operators

- Generate every secret independently with `openssl rand -hex 32`.
- Use TLS to the database (`DATABASE_SSL=true`) and an HTTPS `APP_URL`.
- Give each scheduler its own `WORKER_SECRET` entry so one can be revoked alone.
- See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#security-notes).
