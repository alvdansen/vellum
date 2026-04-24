# Phase 08: Documentation Attribution Backfill - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 08-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-24
**Phase:** 08-doc-attribution-backfill
**Areas discussed:** SC-1 attribution approach, SC-2 override doc placement, SC-3 Zod/SDK caveat placement, Regression guard + scope

---

## Area Selection

**Question:** Which areas do you want to discuss for Phase 8 (Documentation Attribution Backfill)?

| Option | Description | Selected |
|--------|-------------|----------|
| SC-1 attribution approach | Reformat vs. add regression guard vs. note why audit mis-read it; HIER-06 ownership (01-01 vs 01-02). | ✓ |
| SC-2 override doc placement | Reconcile body with frontmatter; standalone note; cross-link from 01-02-SUMMARY.md. | ✓ |
| SC-3 Zod/SDK caveat placement | 02-VERIFICATION.md supplement vs standalone note vs 03-VERIFICATION.md; paragraph vs full writeup. | ✓ |
| Regression guard + scope | Vitest test vs script vs no guard; Phase 1 only vs sweep Phases 1-6. | ✓ |

**User's choice:** All four areas selected.

---

## SC-1 Attribution Approach

### Format decision

| Option | Description | Selected |
|--------|-------------|----------|
| Flow-style one-line (Recommended) | Rewrite as `requirements-completed: [HIER-01, ..., TOOL-05]`. Matches 01-01/01-03 convention, audit-tool-friendly. | ✓ |
| Keep block-style, fix the audit tool | Leave `- HIER-01` block form; patch audit logic instead. | |
| Flow-style + normalize all five summaries | Rewrite 01-02 AND audit all Phase 1–5 summaries for format consistency. | |

**User's choice:** Flow-style one-line (Recommended).
**Notes:** Paired with D-ATTR-14 normalization across Phases 1–5 during implementation — scope carried over to SC-4 discussion.

### HIER-06 ownership

| Option | Description | Selected |
|--------|-------------|----------|
| 01-02 only (Recommended) | Matches 01-VERIFICATION.md row — breadcrumb delivered by shape.ts tool-layer injection. | ✓ |
| 01-01 only | Move to 01-01-SUMMARY.md as a hierarchy capability. | |
| Both 01-01 and 01-02 | Attribute to both phases — engine.breadcrumb walks + shape.ts response injection. | |

**User's choice:** 01-02 only (Recommended).
**Notes:** `breadcrumb-always.test.ts` at tool layer is the canonical evidence.

### SC-1 follow-on

| Option | Description | Selected |
|--------|-------------|----------|
| Update v1.0-MILESTONE-AUDIT.md (Recommended) | Append "Resolved by Phase 8" notes to the three Phase 01 tech-debt rows. | ✓ (delegated choice) |
| Update REQUIREMENTS.md Traceability | Flip "Pending" → plan-level attribution for Phase 1 requirements. | |
| Leave both alone | Just fix the three ROADMAP SCs and ship. | |

**User's choice:** Delegated to Claude ("you decide, you got this"). Claude chose **Update audit only** — tight to scope, matches Phase 7 pattern of in-place resolution marker. REQUIREMENTS.md Traceability sweep deferred to `/gsd-complete-milestone`.

---

## SC-2 Override Doc Placement

### Body reconciliation

| Option | Description | Selected |
|--------|-------------|----------|
| Reconcile body to match frontmatter (Recommended) | Rewrite "Human Verification Required" section to cite frontmatter override + scripts/inspector-smoke.mjs; delete unfilled YAML stub. | ✓ |
| Append override-accepted block + keep deferral | Fill existing YAML stub with accepted_by/accepted_at; leave "Human Verification Required" prose above. | |
| Delete the whole Human Verification section | Excise lines 196–253 entirely. | |

**User's choice:** Reconcile body to match frontmatter (Recommended).

### Cross-link

| Option | Description | Selected |
|--------|-------------|----------|
| Cross-link from 01-02-SUMMARY.md (Recommended) | One sentence in "Open Loose Ends" / "User Setup Required" section pointing to 01-VERIFICATION.md overrides_applied + scripts/inspector-smoke.mjs. | ✓ |
| Standalone INSPECTOR-SMOKE-OVERRIDE.md | New sibling file collecting override rationale. | |
| No cross-link | Frontmatter + INSPECTOR-SMOKE.md + body reconciliation is enough. | |

**User's choice:** Cross-link from 01-02-SUMMARY.md (Recommended).

### INSPECTOR-SMOKE.md

| Option | Description | Selected |
|--------|-------------|----------|
| Add "Override Accepted" header (Recommended) | Prepend short note: "Override accepted 2026-04-24 — scripts/inspector-smoke.mjs is the authoritative wire-level gate." | ✓ |
| Leave as-is | File is a historical 1:1 mapping doc; frontmatter override carries current state. | |
| Rewrite to remove deferral language | Strip "deferred" framing throughout. | |

**User's choice:** Add "Override Accepted" header (Recommended).

---

## SC-3 Zod/SDK Caveat Placement

### Location

| Option | Description | Selected |
|--------|-------------|----------|
| 02-VERIFICATION.md supplement (Recommended) | Append `## MCP SDK 1.29 Zod inputSchema Envelope Caveat (Phase 8, 2026-04-24)` — same pattern Phase 7 used. | ✓ |
| Standalone .planning/notes/MCP-SDK-QUIRKS.md | New directory + file for SDK-level quirks. | |
| Append to 01-VERIFICATION.md body | "Known SDK Behavior" section under Gaps Summary; no forward projection. | |

**User's choice:** 02-VERIFICATION.md supplement (Recommended).

### Depth

| Option | Description | Selected |
|--------|-------------|----------|
| Repro + symptom + workaround (Recommended) | Three paragraphs: runtime behavior, visible symptom (isError:true + content[0].text, no structuredContent.code), engine-layer TypedError contrast. No fix proposal. | ✓ |
| One-paragraph pointer | Single paragraph pointing at 01-VERIFICATION.md notes. | |
| Full writeup with code snippets | Three paragraphs + JSON-RPC response + TODO sketch of flattenZodError(). | |

**User's choice:** Repro + symptom + workaround (Recommended).

### Forward projection

| Option | Description | Selected |
|--------|-------------|----------|
| No — one canonical home is enough (Recommended) | 02-VERIFICATION.md supplement only; no mirrored pointers in 03/04/05. | ✓ |
| Mirror one-line pointer into 03, 04 VERIFICATION.md | Each downstream phase's VERIFICATION.md gets a short pointer. | |
| Add a test for the observed behavior | Regression test asserting SDK 1.29 Zod intercept shape. | |

**User's choice:** No — one canonical home is enough (Recommended).

---

## Regression Guard + Scope (SC-4)

### Guard form

| Option | Description | Selected |
|--------|-------------|----------|
| Vitest test (Recommended) | src/__tests__/phase-attribution.test.ts parses summary frontmatter + ROADMAP; asserts union ⊇ declared-requirements per phase. | ✓ |
| Standalone script under scripts/ | scripts/audit-attribution.mjs, manual run; gitignored from CI. | |
| No guard, rely on /gsd-audit-uat | Trust workflow-time checks at milestone close. | |

**User's choice:** Vitest test (Recommended).

### Sweep scope

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 1 + style normalize Phases 1-6 (Recommended) | Fix 01-02 HIER-06/TOOL-02..05 + normalize block-style lists across 01-01..05-13. | ✓ |
| Phase 1 only | ROADMAP SC-1 literal scope; no sweep. | |
| Full sweep across 1-6 + fix any silent attribution gaps | Parse + cross-check each SUMMARY vs VERIFICATION; fix any mismatches. | |

**User's choice:** Phase 1 + style normalize Phases 1-6 (Recommended).

### Test cadence

| Option | Description | Selected |
|--------|-------------|----------|
| Always (default test suite) (Recommended) | Runs on every `npx vitest run` — ~50ms; same tier as architecture-purity and tool-budget. | ✓ |
| Opt-in gated (RUN_DOC_AUDIT=1) | Default-skipped; runs on demand before milestone close. | |
| Only in a /gsd-* hook, not as a test | Integrate into pre-commit hook or /gsd-verify helper. | |

**User's choice:** Always (default test suite) (Recommended).

---

## Claude's Discretion

Areas the user delegated or where Claude has flexibility per D-ATTR decisions:

- Exact phrasing of the 01-VERIFICATION.md body reconciliation section (must reference frontmatter + scripts/inspector-smoke.mjs + INSPECTOR-SMOKE.md; no "deferred to pre-release" language)
- Exact phrasing of the INSPECTOR-SMOKE.md header paragraph (must say "Override accepted 2026-04-24"; preserve 1:1 coverage map)
- Vitest test YAML parser choice (`js-yaml` if already pulled via dep tree; else regex-based parse)
- ROADMAP parse strategy (regex split on `### Phase ` vs per-phase block scan)
- Test file co-location (flat under `src/__tests__/` recommended; subdirectory allowed)
- 02-VERIFICATION.md supplement ordering and separator style (follow Phase 7's shape)
- Audit file note formatting (per-item vs single closing line; append-only is the hard constraint)
- SC-1 follow-on (delegated; Claude chose "Update audit only")

## Deferred Ideas

- REQUIREMENTS.md Traceability table refresh (milestone-close scope)
- flattenZodError() helper — the Phase 2+ follow-up the caveat is pointing at
- Mirroring Zod/SDK caveat into 03/04/05 VERIFICATION.md (rejected)
- Regression test for Zod intercept SDK behavior (add when SDK is upgraded)
- Full attribution-gap sweep across Phases 2–6 (test catches it automatically)
- YAML style normalization across other frontmatter keys
- Pre-commit hook / /gsd-verify integration for attribution check
- Standalone .planning/notes/ directory for SDK quirks
- Renaming INSPECTOR-SMOKE.md to follow numeric-prefix convention
