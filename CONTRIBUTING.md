<!-- Cognitive Runtime © 2026 by Donald Dominko | CC BY-NC-SA 4.0 -->

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

## License

By contributing, you agree that your contributions will be licensed under the same license as this project (CC BY-NC-SA 4.0 — see [LICENSE.md](./LICENSE.md)).
