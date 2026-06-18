<!-- SPDX-License-Identifier: AGPL-3.0-only | Cognitive Runtime © 2026 Donald Dominko -->

# Contributing

## Status

This repository is in packaging/hardening mode following Phase 7 feature completion. It is currently intended as an internal reference implementation. Contribution expectations are intentionally minimal until the final license is confirmed.

---

## What Contributions Are Welcome

- Bug reports via GitHub Issues (once the repository is public)
- Documentation corrections and clarifications
- Smoke test improvements
- Typo fixes

## What Is Not Accepted Right Now

- New runtime features (the feature set is frozen through Phase 7)
- Architecture changes
- Dependency upgrades that are not security-related

---

## Development Setup

See [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) for prerequisites, local setup, and build commands.

---

## Code Standards

- **TypeScript strict mode** is enabled across all packages; all type errors must be resolved.
- **No unused variables** — the TypeScript compiler enforces `noUnusedLocals` and `noUnusedParameters`.
- **ESLint** (`pnpm lint`) must pass without errors.
- **Prettier** formatting (`pnpm format`) is expected.
- **Comments** must follow the standards in the source files: file headers, exported symbol JSDoc, non-obvious inline comments. Do not add comments that restate what the code already says.
- **No behavior changes** in comment-only or documentation PRs.
- **Smoke tests must continue to pass** after any change.

---

## Commit Style

Use short, imperative commit messages:

```
fix: correct EMA decay boundary condition
docs: add EVENT_MODEL architecture doc
chore: tighten .gitignore for backup files
```

---

## Pull Requests

- Keep PRs small and focused.
- Reference the relevant phase (e.g., "Phase 4 reward") if the change touches phase-specific code.
- Smoke tests must pass before requesting review.

---

## Signing the CLA

Contributing requires signing the Contributor License Agreement (CLA). Under the CLA
you **keep copyright** in your contribution but grant the project owner a perpetual,
irrevocable, sublicensable right to use and **relicense** it (including under
commercial terms). See [CLA.md](./CLA.md) for the full text.

Signing is automated: when you open your first pull request, the CLA Assistant bot
comments on it. To sign, reply on the PR with:

> I have read the CLA Document and I hereby sign the CLA

Your PR cannot be merged until the CLA check passes.

## License

By contributing, you agree that your contributions are licensed to the project and
its users under the **GNU AGPL-3.0** (see [LICENSE](./LICENSE)), and that the project
owner may additionally relicense them as described in [CLA.md](./CLA.md).
