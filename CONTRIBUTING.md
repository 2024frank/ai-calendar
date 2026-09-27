# Contributing to AI Calendar

Thanks for helping. AI Calendar keeps a town's scattered event calendars in one place, and contributions of every size are welcome: a bug report, a fix, a new source adapter, better docs, or a deployment for your own community.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug** with the bug template: what you did, what you expected, what happened, and the run ID or event ID if there is one.
- **Suggest a feature** with the feature template. Say who it helps and why.
- **Fix something**: issues labelled `good first issue` are a gentle start.
- **Run it for your town** and tell us what was hard. Portability problems are bugs.
- **Improve the docs** in [`docs/`](docs).

Report security problems privately. See [SECURITY.md](SECURITY.md).

## Development setup

Follow [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md). In short:

```bash
npm ci
cp .env.example .env.local   # point at a disposable dev database
npm run db:migrate
npm run seed -- --help
npm run dev
```

Never point a development checkout at a database holding real data.

## Making a change

1. Fork the repo and create a branch from `main`.
2. Make your change, with a test when behaviour changes. Tests live in [`tests/`](tests) and run on Node's built-in test runner.
3. Run the full gate:

   ```bash
   npm run check          # lint, typecheck, unit tests, production build
   ```

   If you touched queries, transactions or migrations, also run `npm run test:mysql` against a throwaway MySQL.
4. If you changed the schema, edit [`src/db/schema.ts`](src/db/schema.ts), then run `npm run db:generate` and commit the new migration. Migrations must be additive and safe on a populated database.
5. Open a pull request and fill in the template.

CI runs the same `npm run check`, a production dependency audit, and the real-MySQL isolation suite.

## Code style

- **TypeScript, strict.** No `any` where a real type is available.
- **Match the surrounding code.** Keep its naming, structure and comment density.
- **Comments explain why.** The code shows what it does; a comment explains a decision, a constraint, or the incident that caused it.
- **Tenant safety first.** Every private query is scoped by the session's community. Never take a community ID from the request body to widen access.
- **Server-only code** imports `"server-only"`. Secrets never reach the client or a model prompt.
- **Plain words in the interface.** UI text and error messages say what happened and what the reader can do about it, without jargon.
- UI work follows [docs/UI-SYSTEM.md](docs/UI-SYSTEM.md).

## Commit messages

Write the subject as a plain sentence about the outcome, in the imperative, e.g. `Fetch locable posters from their public S3 original when the CDN blocks us`. Use the body to explain why.

## Adding a source-specific adapter

Most sites need only a recipe written in the app. When a site has a real API (the Apollo Theatre's Veezi feed, for example), an adapter goes in [`src/lib/sources/`](src/lib/sources). Keep its credentials in environment variables, document them in [docs/CONFIGURATION.md](docs/CONFIGURATION.md), and make the source work without them.

## About `scripts/`

`package.json` scripts are the supported tools. Many other files in [`scripts/`](scripts) are one-off maintenance scripts from the Oberlin pilot and assume that deployment's data. Read one before running it, and never run one against a database you care about without a backup.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
