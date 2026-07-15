# Contributing to ChildCheck

Thanks for your interest in improving ChildCheck! This guide covers the
basics. If anything's unclear, please open an issue.

## Reporting issues

- **Bugs**: open a [bug report](https://github.com/Newitech/ChildCheck/issues/new?template=bug_report.md).
  Include the version (`childcheck version` or `docker logs childcheck` first
  lines), your install method + OS, the steps to reproduce, and the relevant
  log snippet.
- **Feature requests**: open a [feature request](https://github.com/Newitech/ChildCheck/issues/new?template=feature_request.md).
  Describe the use case (not just the solution) — knowing _why_ you want
  something helps us design the right thing.

Before opening a new issue, please search existing issues to avoid duplicates.

## Suggesting features

Feature requests are best when they include:

1. **The problem** you're trying to solve (the _why_).
2. **Who** is affected (admins? kiosk volunteers? parents?).
3. **What you've tried** (workarounds, current process).
4. **A rough idea** of the solution (optional — we're happy to design with
   you).

## Submitting pull requests

1. **Fork** the repo + create a branch off `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
2. **Make your changes**. Keep PRs focused — one feature/fix per PR is much
   easier to review.
3. **Run lint + tests** (see Dev setup below):
   ```bash
   bun run lint
   ```
4. **Open a PR** against `main`. Fill in the PR template (description, type,
   breaking changes, tests, lint clean).
5. **Respond to review feedback** — we'll work with you to get it merged.

### Dev setup

```bash
git clone https://github.com/<your-fork>/childcheck.git
cd childcheck
bun install
bun run db:push     # create/sync the SQLite schema
bun run dev         # start the dev server at http://localhost:3000
```

Then browse to `http://localhost:3000/setup` for the first-run wizard. The
default test admin is username `admin` / password `password123` (only present
in dev — the wizard creates the real one in production).

### Code style

- **TypeScript throughout**, strict-friendly. No `any` unless absolutely
  unavoidable (and add a comment explaining why).
- **`bun run lint` must finish clean.** ESLint config is in `eslint.config.mjs`.
- **API routes, not server actions.** All backend logic lives in
  `src/app/api/**/route.ts` route handlers. Don't add `use server` functions.
- **shadcn/ui components** preferred over custom implementations. The full
  set lives in `src/components/ui/`. Compose them; don't fork them.
- **Lucide icons** for all iconography.
- **Server / client split**: use `'use client'` only when a component needs
  browser APIs or React state. Default to server components.
- **Prisma schema** lives in `prisma/schema.prisma`. After editing, run
  `bun run db:push` to apply. We use `db push` (not `migrate dev`) — see
  `docs/deployment/updating.md` → "Schema migrations".
- **No tests required for PRs**, but if you add a complex feature, a quick
  manual verification script + screenshot in the PR description helps
  reviewers a lot.

## Security disclosures

**Do NOT open a public GitHub issue for security bugs.**

If you discover a vulnerability (e.g. an auth bypass, an SQL injection, a way
to decrypt photos without the key, an RCE), please disclose privately:

1. Email the maintainer at **security@childcheck.example.org** (replace with
   your real address — see your fork's README).
2. Include a clear description of the issue, the steps to reproduce, and the
   impact.
3. We'll acknowledge receipt within 48 hours, work with you on a fix, and
   publish a coordinated disclosure + a patched release once a fix is
   available.

Please don't publish exploits or PoCs before a patch is released.

## Code of conduct

Be kind. Be patient with newcomers. Assume good faith. Disagreements happen
— focus on the technical merits, not the person.

## License

By contributing, you agree that your contributions are licensed under the
[GNU Affero General Public License v3.0 (AGPL-3.0-or-later)](./LICENSE) that covers the project.
