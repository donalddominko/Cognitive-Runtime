<!-- SPDX-License-Identifier: AGPL-3.0-only | Cognitive Runtime © 2026 Donald Dominko -->

# Security Policy

## Supported Versions

This project is currently a research/reference implementation and is not formally versioned for production security support. There is one active development line (the `main` branch).

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not open a public GitHub issue**.

Instead, report it privately by emailing the repository maintainer directly. Include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Any suggested remediation if you have one

You will receive an acknowledgment within 5 business days.

## Scope

Security concerns in scope:
- SQL injection or unsafe database queries
- Secret/credential leakage (e.g., env vars in logs or responses)
- Unsafe deserialization or JSONB injection
- Authentication/authorization bypasses (once auth is implemented)
- Dependency vulnerabilities with known exploits

Out of scope for this project at present:
- Denial of service against the local LLM inference server
- Docker image hardening (Alpine base images used but not hardened)
- Rate limiting (not implemented)

## Security Notes for Operators

- The `.env` file contains database credentials. Do not commit it to version control.
- The default Postgres credentials (`cognitive`/`cognitive`) are intended for local development only. Change them before any deployment accessible from the network.
- The llama.cpp server (`cognitive-llama`) has no authentication. Do not expose port 8080 publicly.
- Redis has no authentication configured by default. Do not expose port 6379 publicly.
- All services run inside a private Docker bridge network (`cognitive-network`). Only ports explicitly listed in `docker-compose.yml` are exposed to the host.
