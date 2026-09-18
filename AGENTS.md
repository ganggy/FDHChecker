# Working on FDH Checker

FDH Checker is a Thai hospital claims application: React/TypeScript/Vite in
`src/`, Express/TypeScript in `server/`, and deployment assets in `deploy/`.

## Context

- Read only the files needed for the requested task. Use `docs/README.md` to
  choose relevant documentation; do not load every project report before edits.
- Check current code, tests, and configuration before relying on historical
  completion reports. A filename containing FINAL or COMPLETE is not evidence
  of the current implementation or successful validation.
- Preserve existing unrelated working-tree changes. Keep edits within the
  requested scope, and communicate in concise Thai unless asked otherwise.

## Boundaries and completion

- Carry authorized local edits through relevant verification and fix failures
  caused by the change. Ask only when missing information changes the result
  materially; state reasonable routine assumptions and continue.
- Preserve authentication, permissions, SQL validation, and the AI read-only
  query boundary. Do not invent claim rates, clinical rules, or database columns;
  use the relevant source and existing schema/catalog.
- Never expose credentials or patient records in logs, examples, or fixtures.
  Use synthetic data for new tests.
- Local code changes do not authorize production database writes, claim
  submission, LINE messages, deployment, or credential changes. Check the
  request and script behavior before actions with external effects.
- A task is complete when the requested behavior is implemented, appropriate
  checks pass (or blockers are reported), and the result explains changes,
  validation, and material limitations. Inspect UI changes when feasible.

## Verification

Choose checks by impact; do not run every suite for documentation or copy edits.

- Documentation: verify links, commands, and diff; no application build needed.
- AI logic: affected tests or `npm run test:ai`, plus `npm run check:server`.
- Vault retrieval: `npm run test:vault`.
- Hospital database adapters: `npm run test:hospital-db` and server type check.
- Other backend rules: affected `node --import tsx --test <file>` tests and
  server type check.
- Frontend: relevant lint/type/build checks and inspect the affected view.
- Broad changes or release preparation: `npm run check`.

Inspect test dependencies before assuming they are offline. Scripts named
`test` or `check` outside the package test suites may connect to real services.
After relevant checks pass, repeat or broaden them only for new edits, failures,
or unresolved concerns. Do not claim checks that were not run.
