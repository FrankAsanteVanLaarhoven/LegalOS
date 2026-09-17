# Security Policy & Governance

LegalOS handles sensitive case files, identity documents, and asylum evidence. Security, confidentiality, and data sovereignty are fundamental architectural constraints, not post-hoc controls.

---

## Supported Versions

Only the latest active development versions receive security updates:

| Version | Supported | Security Maintenance |
| :--- | :--- | :--- |
| `0.2.x` (current) | :white_check_mark: | Active support and continuous invariant checks |
| `< 0.2.0` | :x: | Unsupported |

---

## Reporting a Vulnerability

We welcome responsible security disclosures from researchers, practitioners, and auditors.

> **Please do NOT report security vulnerabilities through public GitHub issues.**

### How to Disclose
1. **GitHub Private Security Advisory:** Open an advisory privately via the **Security** tab of this repository.
2. **Direct Security Email:** Alternatively, email `security@legalos.org` with:
   - Description of the vulnerability and affected packages/routes;
   - Proof-of-concept (PoC) code or reproduction steps;
   - Impact assessment (e.g. tenant data exposure, bypass of verification gate, citation tampering).

### Response Timelines
* **Initial Acknowledgement:** Within **24 hours**.
* **Triage & Impact Assessment:** Within **48 hours**.
* **Remediation & Patch Release:** Priority remediation with an immutable release record.

---

## Core Security Architecture

* **Zero-Trust Boundary Enforcement:**
  - Multi-tenant data queries are strictly scoped by organisation identifier at the repository and middleware layer.
  - Every model invocation is executed through `@legalos/execution`, logging state to append-only tables before dispatching to model providers.
* **Fail-Closed Verification Gates:**
  - If a source citation cannot be verified against registered legal authorities, the answer is withheld rather than guessed or softened.
* **Cryptographic Hash-Linked Audit Trails:**
  - Audit events are linked by SHA-256 cryptographic hashes.
  - Deletions are executed as cryptographic tombstones, preserving audit chain integrity under UK GDPR right to erasure.
* **Data Sovereignty & Privacy:**
  - No client casework or case notes are used to train model providers.
  - In accordance with [ADR-001](docs/adr/ADR-001-deployment-target.md), production deployments require pinned UK/EEA residency.

---

## Security Headers & Network Controls

Next.js is configured with strict security response headers in [`apps/web/next.config.ts`](apps/web/next.config.ts):
* Strict Content Security Policy (CSP) with `frame-ancestors 'none'`
* `X-Frame-Options: DENY` (clickjacking prevention)
* `X-Content-Type-Options: nosniff`
* `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
* `Referrer-Policy: strict-origin-when-cross-origin`
* `Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=()`
