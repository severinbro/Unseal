# Contributing to Unseal

Thank you for your interest in contributing to **Unseal** (`Entsiegelungskartierung`). We welcome bug reports, usability feedback, documentation improvements, localization updates, and code contributions from researchers, municipal planners, civic initiatives, and developers.

By participating in this project, you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).

---

## 1. Seeking Support & Asking Questions

* **Usage, deployment, or research questions:** Open a question in [GitHub Issues](https://github.com/severinbro/Unseal/issues) using the `question` label (or GitHub Discussions if enabled on the repository).
* **Setup & administration reference:** Check [`docs/installation.md`](./docs/installation.md) for local setup, builds, CLI commands, and environment variables, and [`docs/vps-setup.md`](./docs/vps-setup.md) for production VPS deployment.

---

## 2. Reporting Bugs & Feature Requests

* **Search existing issues first:** Check [GitHub Issues](https://github.com/severinbro/Unseal/issues) to avoid duplicates.
* **Bug reports:** Use the [Bug Report template](./.github/ISSUE_TEMPLATE/bug_report.md) and include:
  * Platform (`Web`, `Android`, `iOS`, or `API / PostGIS`)
  * Browser or OS version and Node.js / Docker versions (if self-hosting)
  * Steps to reproduce, expected behavior, and observed behavior
  * Never include personal data, private `.env` values, raw EXIF-bearing photos, or production credentials in public issues.
* **Security or privacy vulnerabilities:** If you discover a security or GDPR-relevant vulnerability, please **do not** open a public issue with exploit details. Instead, contact the repository maintainer privately via the operator contact address or GitHub Private Vulnerability Reporting so a fix can be prepared before disclosure.

---

## 3. Development Workflow & Pull Requests

### Prerequisites

* **Node.js `>= 24.0.0`** and `npm`
* **Docker Engine** with **Docker Compose v2** (provides PostgreSQL 16 + PostGIS 3.4 for automated tests)

### Local Setup & Verification

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/<your-username>/Unseal.git
   cd Unseal
   npm ci
   cp .env.example .env
   ```
2. Create a focused feature or fix branch:
   ```bash
   git checkout -b feat/short-description
   ```
3. Make your changes while respecting workspace boundaries:
   * `packages/shared` (`MPL-2.0`): Canonical `camelCase` Zod wire schemas, error codes, and client-side geometry pre-checks.
   * `apps/api` (`AGPL-3.0-or-later`): Fastify HTTP service, PostGIS spatial validation, EXIF stripping, BKG VG250 score normalization, GDPR retention, and CLI tools.
   * `apps/mobile` (`MPL-2.0`): Cross-platform Expo app (`.native` and `.web` adapters, pure TypeScript state reducers, German `de` and English `en` translations).
4. Build, typecheck, and run the full unit + PostGIS integration test suite before opening a Pull Request:
   ```bash
   npm run build
   npm run typecheck
   npm test
   ```
5. Add or update automated tests in `packages/shared/test`, `apps/api/test`, `apps/mobile/test`, or `test/e2e-flow.test.ts` for any behavioral, spatial-validation, or privacy change.

### Pull Request Checklist

* `npm run build && npm run typecheck && npm test` passes cleanly.
* User-facing UI text includes both German (`de`) and English (`en`) strings in `apps/mobile/src/i18n`.
* Privacy-by-design invariants are preserved (zero IP logging, 100% EXIF stripping before disk persistence, no contributor PII in `ODbL-1.0` GeoJSON exports or aggregate telemetry).
* Documentation (`README.md`, `docs/installation.md`, or `.env.example`) is updated if configuration or CLI flags changed.

---

## 4. Licensing of Contributions

Unseal uses a split open-source license architecture (see [`LICENSING.md`](./LICENSING.md) for full details and [`THIRD_PARTY_NOTICES.txt`](./THIRD_PARTY_NOTICES.txt) for third-party dependency notices):

* Contributions to `apps/api` and root server/deployment files are licensed under **`AGPL-3.0-or-later`** ([`LICENSE`](./LICENSE)).
* Contributions to `packages/shared` and `apps/mobile` are licensed under **`MPL-2.0`** ([`packages/shared/LICENSE`](./packages/shared/LICENSE), [`apps/mobile/LICENSE`](./apps/mobile/LICENSE)).

By submitting a Pull Request, you confirm that you have the right to submit your contribution under the applicable workspace license(s) above.
