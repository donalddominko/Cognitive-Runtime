<!-- SPDX-License-Identifier: AGPL-3.0-only | Cognitive Runtime © 2026 Donald Dominko -->

# Release Checklist

**Project:** Cognitive Runtime  
**Author:** Donald Dominko — [LinkedIn](https://www.linkedin.com/in/donald-dominko/)  
**Site:** https://cognitiveruntime.net  
**Status:** Public / Pre-release

---

## Pre-Release Verification

### Repository Hygiene
- [ ] `git status` is clean — no uncommitted changes
- [ ] No `.env` or secrets committed (`git log --all --full-diff -p -- .env`)
- [ ] `node_modules/` and `dist/` are in `.gitignore`
- [ ] No duplicate `LICENSE.md` files

### Licensing & Attribution
- [ ] `LICENSE` present at repo root (AGPL-3.0-only)
- [ ] License headers present in all TS/TSX source files
- [ ] License headers present in all shell scripts
- [ ] License header present in CSS file
- [ ] Attribution comment in Markdown docs (ARCHITECTURE, META_PLANNER, MEMORY_MODEL)
- [ ] `README.md` includes Author section with LinkedIn link
- [ ] `README.md` links to https://cognitiveruntime.net
- [ ] `README.md` license section references AGPL-3.0
- [ ] `README.md` reflects public AGPL-3.0 licensing (no "private" or "non-commercial" language)

### Ownership & Governance
- [ ] `.github/CODEOWNERS` exists and is valid
- [ ] `CONTRIBUTING.md` includes attribution and contribution guidelines
- [ ] `SECURITY.md` includes vulnerability reporting instructions
- [ ] `CODE_OF_CONDUCT.md` exists

### Documentation
- [ ] `docs/ARCHITECTURE.md` complete with attribution
- [ ] `docs/META_PLANNER.md` complete with attribution
- [ ] `docs/MEMORY_MODEL.md` complete with attribution
- [ ] `docs/DEVELOPMENT.md` accurate (dev setup, env vars)
- [ ] `docs/SMOKE_TESTS.md` reflects current test suite

### Build & Runtime
- [ ] `pnpm build` completes without errors
- [ ] `pnpm lint` passes with zero errors
- [ ] All smoke tests pass against running stack
- [ ] Docker Compose stack starts cleanly: `docker compose up -d`
- [ ] Health endpoint responds: `curl http://localhost:3001/health`
- [ ] No hardcoded credentials or production secrets in source

### Domain & Identity
- [ ] https://cognitiveruntime.net resolves correctly
- [ ] LinkedIn profile link correct: https://www.linkedin.com/in/donald-dominko/
- [ ] GitHub repo description set (see below)
- [ ] GitHub topics set (see below)

### Final Sign-Off
- [ ] All checklist items above are checked
- [ ] Maintainer review complete
- [ ] Repository visibility toggled to Public when ready

---

## Repo Metadata (GitHub Settings)

**Description:** Cognitive Runtime — a multi-agent AI orchestration platform with DAG execution, episodic/semantic/procedural memory, and meta-planning.

**Website:** https://cognitiveruntime.net

**Topics:** `ai`, `typescript`, `monorepo`, `multi-agent`, `llm`, `dag`, `memory`, `meta-planning`, `fastify`, `qdrant`, `bullmq`, `cognitive-architecture`

---

*Licensed under the GNU AGPL-3.0. See [LICENSE](LICENSE) for terms.*
