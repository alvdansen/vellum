---
phase: 07-comfyui-endpoint-reconciliation
plan: 08
subsystem: memory-hygiene
tags: [phase-07, memory-hygiene, cleanup, D-EP-15]

# Dependency graph
requires:
  - phase: 07-06
    provides: "Pitfall #5 satisfied (live-smoke green twice back-to-back) — unlocks D-EP-15 removal-over-marking path"
  - phase: 07-07
    provides: "07-VERIFICATION.md canonical resolution doc referenced from the updated reference memory"
provides:
  - "Clean project-memory baseline for future Claude sessions — no stale drift claim, no stale `api.comfy.org` base assertion, index entries synchronized with actual memory files"
affects: [future-claude-sessions, MEMORY.md-index]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "D-EP-15 removal-over-marking: when a point-in-time observation is refuted by two consecutive green runs (Pitfall #5 criterion), remove the memory rather than leave a `RESOLVED` marker — cleans the memory loader without sacrificing history (cross-reference in reference memory + canonical doc + MEMORY.md locked-Phase-7 note preserve the trail)"
    - "Memory-index synchronization pattern: when a memory file is removed, MEMORY.md index entry MUST be removed in the same commit; when a memory body changes materially, the index hook line is rewritten to match. MEMORY.md is an index, not free-floating state"

key-files:
  created:
    - ".planning/phases/07-comfyui-endpoint-reconciliation/07-08-SUMMARY.md"
  modified:
    - "~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/project_comfy_api_endpoint_drift.md — REMOVED per D-EP-15 removal path"
    - "~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/reference_env_comfyui_key.md — body updated to locked COMFYUI_API_BASE=https://cloud.comfy.org + Phase 7 cross-reference; frontmatter (name/description/type/originSessionId) preserved byte-for-byte"
    - "~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/MEMORY.md — index synchronized to the post-Phase-7 memory set (3 entries: don't-punt-on-tests, no-security-scolding, reference-env-key)"

key-decisions:
  - "Drift memory REMOVED (not marked RESOLVED) per D-EP-15 preferred path — Pitfall #5 criterion (live-smoke green for second consecutive run) met via Plan 06. A RESOLVED marker would keep stale-by-default content in Claude's memory loader; removal cleans the deck while the three preserved forward-pointers (07-VERIFICATION.md canonical doc + reference memory's closing sentence + MEMORY.md 'locked Phase 7' note) keep the historical trail intact"
  - "feedback_no_security_scolding.md added to MEMORY.md index at line 2 — not anticipated by Plan 07-08's line-numbered contract because it was created mid-phase (during Plan 06 credential-rotation step). Placement groups both feedback entries together. Additive to the plan, not a deviation from the locked contract (all plan-specified grep assertions still pass)"
  - "Reference memory's closing sentence extended to include the `set -a / source .env / set +a` note — Plan 06 lost ~15 min to the discovery that vitest does not auto-load .env; documenting in the reference memory prevents future sessions from rediscovering it. Plan 07-08 contract didn't explicitly prescribe this wording but did say 'append ... closing sentence referencing 07-VERIFICATION.md §2 and §3' — the vitest-dotenv note is an in-scope elaboration of the `§2 Credential Layout` cross-reference"

patterns-established:
  - "Mid-phase memory additions (like the new feedback memory) should land in the phase's memory-hygiene plan, not as orphan commits. Keeps MEMORY.md index synchronized in one atomic operation"

requirements-completed:
  - "SC-3 (memory hygiene leg): project memories reflect resolved state — drift memory removed, reference memory updated to locked base, MEMORY.md index synchronized"

# Metrics
duration: ~4min (three memory-file operations + verify gates + SUMMARY write)
completed: 2026-04-24
---

# Phase 7 Plan 08: Memory Hygiene Summary

**Removed the stale `project_comfy_api_endpoint_drift.md` memory (D-EP-15 preferred removal path — Pitfall #5 met via Plan 06), updated `reference_env_comfyui_key.md` body to reflect the locked `COMFYUI_API_BASE=https://cloud.comfy.org` + vitest-dotenv gotcha + Phase 7 cross-reference, and synchronized the `MEMORY.md` index to the post-Phase-7 3-entry memory set.**

## Performance

- **Duration:** ~4 min (three memory ops + verify + SUMMARY)
- **Completed:** 2026-04-24
- **Tasks:** 3 (Task 1 auto — drift removal; Task 2 auto — reference update; Task 3 auto — MEMORY.md sync)
- **Files modified:** 3 outside the repo (all in `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/`); 0 inside the repo (pure outside-tree hygiene + this SUMMARY inside)
- **No code changes; no secrets leaked** (final memory set scanned — no `COMFYUI_API_KEY` values, no rotated-key details)

## Accomplishments

- **Task 1:** Removed `project_comfy_api_endpoint_drift.md` entirely. Pitfall #5 (live-smoke green twice in Plan 06) unlocked the D-EP-15 preferred removal path. The historical trail survives via three independent forward-pointers: (a) `07-VERIFICATION.md` canonical doc, (b) `reference_env_comfyui_key.md`'s closing sentence, (c) `MEMORY.md` line 3's "locked Phase 7 (2026-04-24)" note.
- **Task 2:** Updated `reference_env_comfyui_key.md` body in place:
  - Line 8 (key-source line): `api.comfy.org key` → `ComfyUI Cloud key issued at https://platform.comfy.org` (docs-canonical issuance URL)
  - Line 9 (base line): `https://api.comfy.org` → `https://cloud.comfy.org` (Plan 01 winner, locked in Plan 02/03)
  - Line 11 (gitignore reference): `.gitignore:1` → `.gitignore:12` (current line number)
  - Closing sentence appended pointing at `07-VERIFICATION.md §2 Credential Layout` and `§3 Rotation Procedure`, plus the `set -a / source .env / set +a` note for future test-running sessions
  - Frontmatter preserved byte-for-byte: `name`, `description`, `type`, `originSessionId: 7412e4d7-f32d-4137-b135-b25cd469eb23`
- **Task 3:** Rewrote `MEMORY.md` as a clean 3-entry index:
  - Line 1: `feedback_dont_punt_on_tests.md` — unchanged (still accurate post-Phase-7 — reinforced by the Phase 7 live-smoke wire-level drive)
  - Line 2: `feedback_no_security_scolding.md` — NEW entry added (additive to Plan 07-08's locked contract; see Decisions Made)
  - Line 3: `reference_env_comfyui_key.md` — rewritten summary with locked `COMFYUI_API_BASE=https://cloud.comfy.org`, `locked Phase 7 (2026-04-24)` suffix
  - Removed: former line 3 (drift entry) — deleted entirely to match Task 1's removal path

## Task Commits

1. **Task 1:** memory file removal via `rm` — no git commit for the memory file (outside the repo).
2. **Task 2:** Edit of reference memory body — no git commit for the memory file (outside the repo).
3. **Task 3:** Write of MEMORY.md index — no git commit for the memory file (outside the repo).
4. **Plan metadata:** this SUMMARY commit (docs) — inside the repo.

## Files Created/Modified

- `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/project_comfy_api_endpoint_drift.md` — **REMOVED** (D-EP-15 preferred path, Pitfall #5 met)
- `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/reference_env_comfyui_key.md` — **MODIFIED** (body-only: key-source, base, gitignore-line-ref, closing sentence; frontmatter unchanged including `originSessionId: 7412e4d7-f32d-4137-b135-b25cd469eb23`)
- `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/MEMORY.md` — **REWRITTEN** (3-entry index from post-Phase-7 state)
- `.planning/phases/07-comfyui-endpoint-reconciliation/07-08-SUMMARY.md` — **NEW** (this file, inside the repo)

## Decisions Made

- **Removed drift memory rather than marking RESOLVED.** Pitfall #5 (live-smoke green for the second consecutive run) was delivered by Plan 06 — both runs 2026-04-24T21:27:13Z and 21:28:25Z exited 0 with 2 tests passed. D-EP-15's preferred path applies: removal cleans the memory loader while the three forward-pointers (canonical doc, reference memory closing sentence, MEMORY.md locked-Phase-7 note) preserve institutional memory.
- **Added `feedback_no_security_scolding.md` to MEMORY.md (plan-additive).** That memory file was created during Plan 06 (user feedback after a pasted-key cautionary lecture). Since MEMORY.md is the single index, leaving the new memory unregistered would break the index invariant. Placement at line 2 groups it with the other feedback entry. Plan 07-08's locked Task 3 contract did not anticipate it (written before Plan 06 ran); adding it satisfies both the plan's required grep assertions AND the memory-system invariant.
- **Included the `set -a / source .env / set +a` vitest gotcha in the reference memory's closing sentence.** Plan 06 triage surfaced that vitest does not auto-load `.env`, costing ~15 min of diagnostic time. Documenting this in the reference memory (not just in `07-VERIFICATION.md §2`) means a future session reading only the memory file avoids the same confusion.
- **Preserved frontmatter byte-for-byte on reference memory.** `originSessionId: 7412e4d7-f32d-4137-b135-b25cd469eb23` + `name` + `description` + `type` all unchanged; grep -q 'originSessionId: 7412e4d7' assertion confirms. Task 2 verify gate passed on first run.

## Deviations from Plan

### Plan-additive deviation (documented above)

**1. MEMORY.md gained a new feedback_no_security_scolding.md entry**

- **Original plan line-numbering contract:** line 1 = feedback_dont_punt_on_tests (unchanged), line 2 = reference_env_comfyui_key (rewrite), line 3 = drift (delete).
- **Final state:** line 1 = feedback_dont_punt_on_tests, line 2 = **feedback_no_security_scolding (NEW)**, line 3 = reference_env_comfyui_key (rewrite).
- **Reason:** the new feedback memory was created during Plan 06's credential-rotation step (user rebuked a security-scolding exchange). The memory-system invariant is that MEMORY.md indexes every memory file; leaving the new file unregistered breaks the invariant. Registration in this plan's memory-hygiene commit keeps everything atomic.
- **Impact on plan verify gate:** none — all four grep assertions still pass (`feedback_dont_punt_on_tests` present, `reference_env_comfyui_key` present, `Phase 7` present, drift-memory string absent).

### Auto-fixed Issues

None — the memory operations landed verbatim against Task 1/2/3's specifications.

---

**Total deviations:** 1 plan-additive (new memory index entry), 0 auto-fixed
**Impact on plan:** Zero regression. Phase 7 SC-3 met in full.

## Issues Encountered

None — all three tasks passed verify gates on first run.

## User Setup Required

- **Recommended post-Phase-7 key rotation** (per the user's own security policy expressed during Plan 06): rotate `COMFYUI_API_KEY` at https://platform.comfy.org to establish a clean v1.0 operational baseline. Procedure documented in `07-VERIFICATION.md §3`. This is outside the Phase 7 acceptance gate — Phase 7 is complete with the current key (`****749d`).

## Next Phase Readiness

- **Phase 7 is COMPLETE.** SC-1 (Plan 01-05: locked base, healthcheck, typed error, unit tests, drift sentinel) + SC-2 (Plan 06: live-smoke green twice) + SC-3 (Plan 07: canonical doc + Plan 08: memory hygiene) all met.
- **Ready for `/gsd-verify-phase 07`** (or equivalent phase-verification step in the orchestrator workflow).

## Self-Check

- [x] `project_comfy_api_endpoint_drift.md` removed (verified via `test ! -f`)
- [x] `reference_env_comfyui_key.md` body updated: `platform.comfy.org` present, `07-VERIFICATION.md` reference present, `COMFYUI_API_BASE=https://api.comfy.org` absent, `originSessionId: 7412e4d7` preserved
- [x] `MEMORY.md` synchronized: 3 entries, `feedback_dont_punt_on_tests` present, `reference_env_comfyui_key` present, `Phase 7` locked-note present, drift-memory string absent
- [x] `feedback_no_security_scolding.md` (the session-created feedback memory) registered in MEMORY.md line 2
- [x] No `COMFYUI_API_KEY` values or rotated-key details in any memory body (visual scan)
- [x] No memory body contents pasted into this SUMMARY (per Plan 07-08 Task 1 "NEVER print the memory file contents in task output or summary")
- [x] All edits scoped inside `~/.claude/projects/-Users-macapple-comfyui-vfx-mcp/memory/` — no changes outside that dir or inside the repo tree (except this SUMMARY)

## Self-Check: PASSED

---
*Phase: 07-comfyui-endpoint-reconciliation*
*Plan: 08*
*Completed: 2026-04-24*
