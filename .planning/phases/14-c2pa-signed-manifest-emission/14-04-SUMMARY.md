---
phase: 14
plan: 04
subsystem: c2pa-signed-manifest-emission
tags: [c2pa, provenance, http-headers, dashboard, badge, head-method, t-14-10, t-14-11]
requires:
  - 14-01 (c2pa-node@0.5.26 pinned, C2paConfig threading)
  - 14-02 (engine-layer c2pa module — signer + format-router)
  - 14-03 (Engine.signOutput + manifest_signed event + downloader hook + getC2paStatusForVersion accessor)
provides:
  - GET /api/versions/:id/output X-C2PA-Signing-Status response header (signed | unsigned:<reason> | unknown)
  - HEAD /api/versions/:id/output returning the same headers without body
  - packages/dashboard/src/lib/api.ts::getC2paStatus (HEAD-based status helper)
  - packages/dashboard/src/components/C2paBadge.tsx (3-state badge primitive)
  - VersionDrawer C2PA badge in the Output section
affects:
  - src/http/dashboard-routes.ts (EngineForDashboard structural Pick + GET handler refactor + HEAD handler)
  - src/test-utils/fake-engine.ts (default getC2paStatusForVersion stub returning null)
  - src/http/__tests__/output-route-c2pa.test.ts (11 new tests)
  - packages/dashboard/src/lib/api.ts (C2paStatus type + getC2paStatus helper)
  - packages/dashboard/src/components/C2paBadge.tsx (new component)
  - packages/dashboard/src/views/VersionDrawer.tsx (state slot + auto-fetch + render)
  - packages/dashboard/src/__tests__/C2paBadge.test.tsx (11 new tests)
  - packages/dashboard/src/__tests__/getC2paStatus.test.ts (11 new tests)
  - packages/dashboard/src/__tests__/VersionDrawer.test.tsx (8 new tests + getC2paStatus mock default)
  - packages/dashboard/dist/* (rebuilt bundle)
tech-stack:
  added:
    - none (HTTP layer reads existing engine accessor; dashboard adds Preact component + fetch helper)
  patterns:
    - Read-only HTTP header surfacing (signing-at-write-time per Plan 14-03 → no signing latency on hot HTTP path)
    - Hono `app.on('HEAD', ...)` for body-less verb support
    - Defence-in-depth: getC2paStatus never throws — collapses network/parse failures to { status: 'unknown' }
    - T-14-11 XSS mitigation: known-codes translation map + character-class sanitization filter (replace(/[^\w ]/g, '')) + Preact text-node interpolation (NO dangerouslySetInnerHTML)
key-files:
  created:
    - src/http/__tests__/output-route-c2pa.test.ts (281 lines, 11 tests)
    - packages/dashboard/src/components/C2paBadge.tsx (108 lines)
    - packages/dashboard/src/__tests__/C2paBadge.test.tsx (122 lines, 11 tests)
    - packages/dashboard/src/__tests__/getC2paStatus.test.ts (148 lines, 11 tests)
  modified:
    - src/http/dashboard-routes.ts (+~100 lines — structural Pick extension + helper extraction + HEAD handler)
    - src/test-utils/fake-engine.ts (+22 lines — default getC2paStatusForVersion stub)
    - packages/dashboard/src/lib/api.ts (+58 lines — C2paStatus type + getC2paStatus helper)
    - packages/dashboard/src/views/VersionDrawer.tsx (+~35 lines — state + useEffect + badge render)
    - packages/dashboard/src/__tests__/VersionDrawer.test.tsx (+162 lines — getC2paStatus mock + 8 Phase 14 tests)
    - packages/dashboard/dist/* (rebuilt)
decisions:
  - "Signing-at-write-time confirmed (Plan 14-03 → Plan 14-04). The HTTP route in this plan does NOT re-sign; it READS the latest manifest_signed event for header values. Benefits preserved: dual-transport parity for free since the file IS the source of truth (both stdio and --http see the same bytes); zero signing latency on the hot HTTP path; simpler crash safety (the file-on-disk is the canonical state)."
  - "v1.1 Concern #2 scope reduction LOCKED at HTTP + dashboard layer: NO sidecar route at /api/versions/:id/output.c2pa, NO sidecar download link in VersionDrawer, NO SIDECAR_EXTENSIONS table duplicated dashboard-side. EXR/PSD outputs surface as `unsigned:unsupported_format` in the X-C2PA-Signing-Status header. v1.2 will reintroduce the sidecar route + dashboard link when c2pa-node exposes signEmbeddable / sign_no_embed equivalent OR vfx-familiar binds directly to c2pa-rs."
  - "T-14-10 mitigation enforced by Test 8 (output-route-c2pa.test.ts): body bytes + Content-Type + Cache-Control are byte-identical to the pre-Phase-14 baseline. X-C2PA-Signing-Status is purely additive — pre-Phase-14 callers ignore it; HTTP/1.1 spec compliance is preserved (extension headers via X- prefix per RFC 6648 deprecation note are still widely accepted)."
  - "T-14-11 XSS mitigation: TWO defence layers. Layer 1 — known-codes translation map (Record<string, string> mapping the 6 enum values from Plan 14-03 to human-readable strings). Layer 2 — character-class sanitization filter `replace(/[^\\w ]/g, '')` for unmapped/unknown reason codes (strips angle brackets / quotes / slashes / equals / etc.). Layer 3 — Preact JSX text interpolation (default text-node escaping). Even if a malicious code reaches the badge, all three layers must be bypassed to inject script content."
  - "HEAD method via Hono `app.on('HEAD', '/api/versions/:id/output', ...)` instead of a separate route definition. The HEAD handler reuses the same resolveOutputForVersion + resolveSigningStatus helpers as GET so the path-traversal guards, MIME-mapping, and signing-status read are byte-identical between the two verbs. HEAD returns `c.body(null, 200, headers)` so no bytes flow over the wire."
  - "FakeEngine.getC2paStatusForVersion default returns null (i.e., the route surfaces 'unknown' as the X-C2PA-Signing-Status header value). This means pre-existing dashboard-routes.test.ts test fixtures pass through unchanged — no test had to grow a c2pa-status seed. Only the new output-route-c2pa.test.ts tests override the stub per-test for the signed/unsigned cases."
  - "Defence-in-depth on getC2paStatus helper: never throws. Network errors / fetch rejections / missing X-C2PA-Signing-Status header / malformed `unsigned:` (no reason after colon) all surface as { status: 'unknown' }. The C2paBadge always renders SOMETHING ('C2PA: pending' for unknown). User experience: never a broken badge or thrown promise."
metrics:
  duration_minutes: 11
  completed: 2026-04-30
  tasks_total: 2
  tasks_completed: 2
  tests_added: 41
  tests_added_root_suite: 11
  tests_added_dashboard_suite: 30
  tests_passing_root_before: 974
  tests_passing_root_after: 985
  tests_passing_dashboard_before: 58
  tests_passing_dashboard_after: 88
  pre_existing_root_failures: 5
  new_files: 4
  modified_files: 6
---

# Phase 14 Plan 04: HTTP X-C2PA-Signing-Status Header + Dashboard C2PA Badge Summary

**Surface the Plan 14-03 signing layer at the HTTP + dashboard boundary. The output streaming route gains an X-C2PA-Signing-Status response header (GET + HEAD); the VersionDrawer renders a small inline C2PA signing-state badge driven by a HEAD-based getC2paStatus helper. v1.1 ships native-embed status surfacing only — NO sidecar route, NO sidecar dashboard link (Concern #2 scope reduction; v1.2 reintroduces both when c2pa-node exposes a real sidecar API).**

## What Landed

### X-C2PA-Signing-Status response header (Task 1)

`GET /api/versions/:id/output` and the new `HEAD /api/versions/:id/output` both set a single new response header sourced from the latest `manifest_signed` event written by Plan 14-03's downloader hook:

| Header value | When fires |
|---|---|
| `signed` | manifest_signed event has `signed: true` |
| `unsigned:<status_reason>` | manifest_signed event has `signed: false` (one of 6 codes from Plan 14-03: `signing_disabled`, `unsupported_format`, `cert_load_failed`, `sign_call_failed`, `native_binding_unavailable`, `asset_too_large_for_buffer_api`) |
| `unknown` | NO manifest_signed event recorded (legacy version, pre-Phase-14, download still in progress) |

**Implementation shape** at `src/http/dashboard-routes.ts`:
- Two helper functions extracted: `resolveOutputForVersion(versionId)` (returns `{ filename, contentType, filePath }`, throws TypedError on miss) and `resolveSigningStatus(versionId, filename)` (returns the header string).
- GET handler now returns `c.body(webStream, 200, { Content-Type, Cache-Control, X-C2PA-Signing-Status })`.
- HEAD handler returns `c.body(null, 200, { Content-Type, Cache-Control, X-C2PA-Signing-Status })` — same headers, zero body bytes.
- `EngineForDashboard` structural Pick widened to include `getC2paStatusForVersion`.

**T-14-10 mitigation** (Test 8): body bytes + Content-Type + Cache-Control are byte-identical to the pre-Phase-14 baseline. The header is purely additive.

**Architecture purity**: `dashboard-routes.ts` has ZERO `c2pa-node` imports. The HTTP layer NEVER signs — Plan 14-03's downloader hook does that at write-time, and this route only READS the recorded outcome via `engine.getC2paStatusForVersion`.

### Dashboard C2PA badge (Task 2)

**`getC2paStatus` helper** at `packages/dashboard/src/lib/api.ts`:
```ts
export type C2paStatus =
  | { status: 'signed' }
  | { status: 'unsigned'; reason: string }
  | { status: 'unknown' };

export async function getC2paStatus(versionId: string): Promise<C2paStatus>;
```
Issues a HEAD request to `/api/versions/:id/output` and parses the X-C2PA-Signing-Status header. Defence-in-depth: never throws — network errors, missing headers, and malformed values all collapse to `{ status: 'unknown' }`.

**`C2paBadge` component** at `packages/dashboard/src/components/C2paBadge.tsx`:
- 3 visual states: green pill 'C2PA: signed', red pill 'C2PA: unsigned (<reason>)', muted pill 'C2PA: pending'.
- 6 known reasons translated via `REASON_TEXT` map: `signing_disabled` → 'signing disabled', `unsupported_format` → 'unsupported format', `cert_load_failed` → 'cert load failed', `sign_call_failed` → 'signing failed', `native_binding_unavailable` → 'native binding unavailable', `asset_too_large_for_buffer_api` → 'asset too large'.
- Unknown reason codes pass through `replace(/[^\w ]/g, '')` (T-14-11 sanitization).
- `data-testid="c2pa-badge"` for stable test selection; `role="status"` + `aria-label` for assistive tech.

**VersionDrawer integration** at `packages/dashboard/src/views/VersionDrawer.tsx`:
- New `c2paStatus` state slot (default `{ status: 'unknown' }` so the badge renders 'C2PA: pending' immediately on mount).
- New `useEffect` auto-fetches via `getC2paStatus(version.id)` keyed by `[version.id]`.
- Badge renders below the output thumbnail link inside the Output section (only shown when `version.status === 'complete'`).
- **NO sidecar download link** (Concern #2 v1.1 scope reduction).

### Header value matrix (Task 1)

```
GET/HEAD /api/versions/:id/output

  +-----------------+-------------------------------------------------+
  | Engine signed   | X-C2PA-Signing-Status                           |
  +-----------------+-------------------------------------------------+
  | event signed=t  | signed                                          |
  +-----------------+-------------------------------------------------+
  | event signed=f  | unsigned:signing_disabled                       |
  | (one of 6)      | unsigned:unsupported_format                     |
  |                 | unsigned:cert_load_failed                       |
  |                 | unsigned:sign_call_failed                       |
  |                 | unsigned:native_binding_unavailable             |
  |                 | unsigned:asset_too_large_for_buffer_api         |
  +-----------------+-------------------------------------------------+
  | no event yet    | unknown                                         |
  +-----------------+-------------------------------------------------+
```

## v1.1 Scope Reduction (Concern #2 — Carried Forward from Plan 14-03 Revision)

v1.1 has NO sidecar route and NO sidecar dashboard link. Three reasons:

1. **c2pa-node v0.5.26 has no public sidecar API.** No `signEmbeddable` / `sign_no_embed` / `signSidecar` is exposed in the JS surface. `embed: false` requires a `remoteManifestUrl` (server-hosted), and `signedManifest` is cryptographically bound to the asset being signed (a placeholder PNG, not the EXR being labeled). Producing pseudo-sidecars would be cryptographically invalid.
2. **EXR/PSD surface as `unsigned:unsupported_format`** in the X-C2PA-Signing-Status header. The original file is untouched on disk (Plan 14-03 design); the dashboard badge tells the user "this format isn't natively embeddable yet — wait for v1.2".
3. **Dashboard format-table drift risk** is moot in v1.1. The original Plan 14-04 included a sidecar download link guarded by an `isSidecarMode` helper that duplicated `SIDECAR_EXTENSIONS` dashboard-side. With sidecar removal, no extension-table duplication exists. v1.2's reintroduction will need a parity test (engine `SIDECAR_FORMATS` ↔ dashboard `SIDECAR_EXTENSIONS`).

## v1.2 Deferred Items

When c2pa-node exposes `signEmbeddable` / `sign_no_embed` equivalent OR when vfx-familiar binds directly to c2pa-rs:

- Reintroduce `GET /api/versions/:id/output.c2pa` route returning the cryptographically-bound sidecar bytes (HTTP 404 on miss, HTTP 200 + application/c2pa Content-Type on hit).
- Reintroduce dashboard sidecar download link below C2paBadge when status is `unsigned:unsupported_format` AND a real sidecar exists.
- Add the `isSidecarMode` helper guarded by an extension-table parity test (engine SIDECAR_FORMATS == dashboard SIDECAR_EXTENSIONS).
- Add a `version.export_manifest` MCP tool action (PROV-V-07 / Phase 16 already plans this — v1.2 sidecar may also be exposed through it).

These are tracked in `.planning/REQUIREMENTS.md` v1.2 deferred section (will be updated when the milestone closes — Plan 14-05 cohort closure).

## Architectural Decision: Signing-at-Write-Time vs Signing-at-Read-Time

The original D-CTX-8 (Phase 14 CONTEXT.md) considered signing at the HTTP layer at request time. Plan 14-03's revision shifted to engine-downloader-hook (signing at write-time). Benefits of write-time signing **preserved by Plan 14-04**:

- **Dual-transport parity for free.** The file IS the source of truth — both `stdio` and `--http` transports see the same bytes; ROADMAP success criterion #5 falls out trivially. (Read-time signing would have required two separate code paths to keep in sync.)
- **No signing latency on the hot HTTP path.** GET/HEAD on `/api/versions/:id/output` is now a pure read: stat the file, read one provenance event, stream the bytes. No c2pa-node native binding is loaded by the HTTP layer.
- **Simpler crash safety.** Plan 14-03's `signFileInPlace` writes to a `<destPath>.c2pa-signed.<nanoid8>.partial` and atomic-renames. The HTTP layer never has to recover from a half-signed file.
- **The X-C2PA-Signing-Status header is purely informational.** Clients that don't understand C2PA see the same body bytes as before; T-14-10 holds at the byte level.

## T-14-11 XSS Mitigation Detail

THREE defence layers protect against script injection via reason codes:

1. **Known-codes translation map** (`REASON_TEXT` in `C2paBadge.tsx`): the 6 enum values Plan 14-03 emits map to hardcoded human-readable strings. Server-trusted enum (the engine writes only these 6 codes), but the map provides a readable display layer.
2. **Character-class sanitization filter** (`sanitizeUnknownReason` in `C2paBadge.tsx`): unknown / unmapped codes pass through `replace(/[^\w ]/g, '')`. Even if a malicious code containing `<script>alert(1)</script>` reaches the badge, it becomes `scriptalert1script` (strips angle brackets / quotes / slashes / equals).
3. **Preact JSX text interpolation** (default behavior): JSX `{...}` produces text nodes, NOT `dangerouslySetInnerHTML`. The browser never evaluates the string as HTML.

Tests at `C2paBadge.test.tsx` (Tests 9-10) and `VersionDrawer.test.tsx` (Test "T-14-11: badge text is rendered as a text node") assert all three layers hold.

## Test Coverage

**41 new tests** (across 4 files):

**Root suite (+11):** `src/http/__tests__/output-route-c2pa.test.ts`:
- 6 GET cases for the 6 status_reason codes
- 1 GET case for signed=true → 'signed'
- 1 GET case for null event → 'unknown'
- 1 T-14-10 byte-identical baseline assertion
- 3 HEAD cases (signed / unsigned:unsupported_format / unknown)

**Dashboard suite (+30):**
- `packages/dashboard/src/__tests__/C2paBadge.test.tsx` (+11): signed / unknown / 6 unsigned reasons + T-14-11 sanitization (script payload + text-node-only) + role/aria.
- `packages/dashboard/src/__tests__/getC2paStatus.test.ts` (+11): HEAD method, header parse for all 3 cases, malformed/missing/network-error fallbacks, URL encoding.
- `packages/dashboard/src/__tests__/VersionDrawer.test.tsx` (+8): badge in Output section for 3 states, NO sidecar link, completion-status guard, network-error fallback, single-fetch-per-mount, T-14-11 in drawer context.

**Test counts:**
- Root: 974 → 985 passing (+11). Pre-existing 5 v1.1-audit failures unchanged.
- Dashboard: 58 → 88 passing (+30). All passing.
- Both `npx tsc --noEmit` clean.
- `cd packages/dashboard && npx vite build` exits 0.

## Self-Check: PASSED

| Predicate | Result |
|-----------|--------|
| `grep "X-C2PA-Signing-Status" src/http/dashboard-routes.ts` returns >= 2 matches | 7 hits |
| `grep -E "/output\\.c2pa" src/http/dashboard-routes.ts` returns ZERO | 0 |
| `grep "getC2paStatusForVersion" src/http/dashboard-routes.ts` returns >= 1 | 2 |
| `grep -E "from\\s*['\"]c2pa-node" src/http/dashboard-routes.ts` returns ZERO | 0 |
| `grep -E "app\\.head\\|app\\.on\\(['\"]HEAD" src/http/dashboard-routes.ts` matches | `app.on('HEAD', ...)` present |
| `grep "getC2paStatus" packages/dashboard/src/lib/api.ts` returns >= 1 | 2 |
| `grep "C2paBadge\\|c2pa-badge" packages/dashboard/src/views/VersionDrawer.tsx` returns >= 1 | 2 |
| `grep -E "Sidecar.*\\.c2pa\\|getOutputSidecarUrl" packages/dashboard/src/views/VersionDrawer.tsx` returns ZERO | 0 |
| `grep -rE "isSidecarMode\\|SIDECAR_EXTENSIONS" packages/dashboard/src/` returns ZERO | 0 |
| `packages/dashboard/src/components/C2paBadge.tsx` exists | YES |
| `npx vitest run src/http/__tests__/output-route-c2pa.test.ts` | 11/11 passing |
| `cd packages/dashboard && npx vitest run src/__tests__/C2paBadge.test.tsx` | 11/11 passing |
| `cd packages/dashboard && npx vitest run src/__tests__/getC2paStatus.test.ts` | 11/11 passing |
| `cd packages/dashboard && npx vitest run src/__tests__/VersionDrawer.test.tsx` | 14/14 passing (6 Phase 12 + 8 Phase 14) |
| `npx vitest run` | 985 passing, 5 pre-existing failures unchanged, 3 skipped |
| `cd packages/dashboard && npx vitest run` | 88/88 passing |
| `npx tsc --noEmit` | exits 0 |
| `cd packages/dashboard && npx vite build` | exits 0 |

**Commits** (5 atomic commits):
- `6b5c97b` test(14-04): add failing tests for X-C2PA-Signing-Status output route
- `b437a80` feat(14-04): X-C2PA-Signing-Status header on /api/versions/:id/output
- `60216a1` test(14-04): add failing tests for C2paBadge + getC2paStatus + drawer integration
- `9b37100` feat(14-04): C2paBadge component + getC2paStatus helper + VersionDrawer integration
- `19b98c8` build(14-04): rebuild dashboard bundle with C2paBadge integration

Per-task TDD: Task 1 followed RED (`6b5c97b`) → GREEN (`b437a80`); Task 2 followed RED (`60216a1`) → GREEN (`9b37100`) → BUILD (`19b98c8` for the dashboard dist regeneration).

## Deviations from Plan

None on the architectural / structural side — the plan landed verbatim. One minor build-side step:

**1. [Build] Rebuilt dashboard `dist/` after Task 2 source changes**
- **Found during:** Pre-commit verification.
- **Issue:** The dashboard's `packages/dashboard/dist/*` is checked into git (per `.gitignore` line 5: `!packages/dashboard/dist/**` un-ignore). Task 2's VersionDrawer.tsx + C2paBadge.tsx + lib/api.ts changes affect the bundle output, so the committed assets need refreshing.
- **Fix:** Ran `cd packages/dashboard && npx vite build` and committed the rebuilt assets in a separate `build(14-04): ...` commit (atomic per the per-task pattern, consistent with prior `build(05-12)` and `build(06)` commits).
- **Files modified:** `packages/dashboard/dist/index.html`, `packages/dashboard/dist/assets/index-CKLgl4R-.js` (replaces `index-9jVH_ewj.js`), `packages/dashboard/dist/assets/index-CRVHKeV6.css` (replaces `index-BvSMiPtf.css`).
- **Commit:** `19b98c8`

No architectural deviations — the plan structure, type shapes, helper signatures, header value matrix, and concern mitigations all landed verbatim. v1.1 scope reduction (Concern #2) was honored structurally throughout (zero sidecar code paths added to either layer). T-14-10 / T-14-11 mitigations land per the threat model.

## Notes

- **Dual-transport parity (ROADMAP success criterion #5):** Achieved automatically. The HTTP route reads the file at `outputs/<versionId>/<filename>` — exactly the same bytes any stdio-side reader would see. No "two code paths" to keep in sync.
- **PROV-V-01 NOT yet marked complete** in REQUIREMENTS.md. The cohort closes in Plan 14-05 (end-to-end verification + dual-transport parity test + key-leak negative tests + REQUIREMENTS.md cohort closure with v1.2 deferred items added to the Out-of-Scope section).
- **Phase 14 progress: 4/5 plans complete.** Plan 14-05 closes the loop with end-to-end demo + verification fixture (c2patool) + REQUIREMENTS closure.
- **Tool budget unchanged:** No new MCP tools. The dashboard surface gained a HEAD-based read path; no MCP tool surface change. Tool count stays at 6/12.
- **HTTP/1.1 spec note:** Custom response headers via `X-` prefix (RFC 6648 deprecates the convention but accepts existing usage). The header is purely informational; pre-Phase-14 callers ignore it. The dashboard's HEAD-based read is the only consumer in v1.1; v1.2 may add c2patool-style readers if needed.
