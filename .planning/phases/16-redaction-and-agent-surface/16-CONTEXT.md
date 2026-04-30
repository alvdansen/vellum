# Phase 16: Redaction & Agent Surface - Context

**Gathered:** 2026-04-30
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss); enriched by orchestrator codebase investigation

<domain>
## Phase Boundary

Close the v1.1 surface at the agent boundary. Add a redaction primitive that strips sensitive prompt/metadata values from a version's manifest while emitting a `c2pa.redacted` assertion preserving the *fact* of redaction (originals remain append-only in the `provenance` table). Add the two new `version` MCP tool actions: `export_manifest` (returns the C2PA-signed manifest) and `verify_manifest` (verifies signature + reports gaps). Tool budget stays at 6 of 12 — no new top-level tool.

**Trigger context:** Phases 14 + 15 emit a fully-formed signed manifest with ingredient graph at download time. But agents cannot ASK for the manifest — there's no tool action that returns it as a structured envelope. And there's no agent-callable verifier. PROV-V-06 + PROV-V-07 close this gap.

**Success criteria (from ROADMAP):**
1. The redaction primitive accepts a version_id + a redaction policy (which fields/assertions to strip) and produces a *new derived* manifest carrying a `c2pa.redacted` assertion that names the redacted fields without exposing their original values; the original signed manifest in `provenance` is byte-for-byte unchanged (append-only contract preserved).
2. `version.export_manifest` returns the C2PA-signed manifest (or its closest derived form) for any version_id in a structured envelope with breadcrumb, conforming to the v1.0 dual-form response contract.
3. `version.verify_manifest` accepts a manifest payload (or a version_id), verifies the signature against the configured trust root, and returns a structured report listing matched assertions, gaps, and any signature failures — with actionable, agent-readable error detail when verification fails.
4. The architecture-purity test passes: redaction logic and manifest export/verify live in the engine layer; the `version` tool is a thin Zod-validated entry point with no engine logic inline. Tool count stays at 6 (no new top-level tool registration). [Note: project actually registers 7 tools currently — workspace/project/sequence/shot/version/generation/asset. The "6" in the ROADMAP is referring to the version tool's action count after Phase 16 adds the two new actions. Read the criterion as: "tool COUNT stays at 7 (current); version tool ACTION count grows from 4 to 6."]
5. The discriminated-union schema for the `version` tool extends cleanly: `export_manifest` and `verify_manifest` round-trip through stdio AND Streamable HTTP transports identically (parity test green).
6. The cross-cutting `phase-attribution.test.ts` and `validation-flags.test.ts` guards remain green; the architecture-purity test gains explicit assertions blocking C2PA SDK imports outside `src/engine/c2pa/`.
</domain>

<decisions>
## Implementation Decisions

### Locked
- **D-CTX-1: New engine module — `src/engine/c2pa/redaction.ts`.** Pure function `redactManifest(manifestBytes, policy): { redactedBytes, redactedFields }`. The redaction primitive strips fields from the manifest's JSON in-place, emits a `c2pa.redacted` assertion (vendor-namespaced under the C2PA spec — see ingredient assertion shape in Phase 15) listing the redacted field paths WITHOUT their original values. Derived manifest is RE-SIGNED with the same cert (Phase 14's signer), producing a NEW signed asset.
- **D-CTX-2: New engine module — `src/engine/c2pa/verifier.ts`.** Async function `verifyManifest({ versionId } | { manifestBytes }): Promise<VerificationReport>`. Uses c2pa-node's `createC2pa().read({asset})` API. The report shape:
  ```ts
  interface VerificationReport {
    valid: boolean;
    signature_status: 'valid' | 'invalid' | 'untrusted_root' | 'unsupported_algorithm' | 'no_manifest';
    matched_assertions: string[];      // labels of valid assertions found
    gaps: string[];                     // expected-but-missing assertions (e.g., 'c2pa.created')
    failures: Array<{ assertion: string; reason: string }>;
    cert_subject: string | null;        // CN extracted from cert
    signed_at: string | null;           // ISO timestamp from manifest_signed event
  }
  ```
- **D-CTX-3: New engine module — `src/engine/c2pa/exporter.ts`.** Async function `exportManifest(versionId): Promise<{ format, signed_at, manifest_bytes_base64 | null, manifest_status: 'present' | 'absent' | 'unsupported_format' }>`. Reads the latest manifest_signed event for the version. If signed, reads bytes from `outputsDir/<versionId>/<filename>` and returns base64. If unsigned, returns null + status reason.
- **D-CTX-4: Tool extension — `src/tools/version-tool.ts` adds 2 new actions:**
  - `export_manifest`: input `{action: 'export_manifest', version_id: string}`. Output: structured envelope with `format`, `signed_at`, `manifest_bytes_base64`, `manifest_status`, `breadcrumb`. Mirror the existing `get` action's envelope shape per D-PROV-08.
  - `verify_manifest`: input `{action: 'verify_manifest', version_id: string}` OR `{action: 'verify_manifest', manifest_bytes_base64: string, format: string}` (discriminated). Output: VerificationReport + breadcrumb when applicable.
- **D-CTX-5: Append-only provenance preserved.** Redaction emits a NEW `manifest_signed` event with a payload field `redacted: true` and `redacted_fields: string[]`. The original event row stays byte-identical. Future verify_manifest calls can find both events via the existing getLatestManifestSignedEvent ordering (latest = redacted; earlier = original).
- **D-CTX-6: Tool budget.** Top-level tool count stays at 7 (workspace, project, sequence, shot, version, generation, asset). The `version` tool's action count grows from 4 (get, list, diff, provenance) to 6 (+ export_manifest, verify_manifest). The discriminated-union schema gets two new arms.
- **D-CTX-7: Architecture-purity extension.** Test guards explicit assertions blocking C2PA SDK imports outside `src/engine/c2pa/`. The version tool MUST NOT import c2pa-node — it goes through the engine facade.
- **D-CTX-8: Redaction policy shape.** v1.1 ships a SIMPLE policy: list of dotted field paths to strip from the manifest's JSON. e.g., `['assertions[label="vfx_familiar.input"].data.prompt_positive', 'assertions[label="vfx_familiar.input"].data.prompt_negative']`. Future policies (regex-based, conditional) — out of scope.

### Claude's Discretion
- Verification trust root: c2pa-node's default (system trust + the configured signing cert). v1.1 ships single-cert config (per Phase 14 D-CTX-2); the verifier uses the same cert chain. Multi-CA — out of scope per REQUIREMENTS.
- Exporter format conversion: do NOT convert manifest bytes between formats. Return the bytes verbatim (PNG signed bytes ARE the file with embedded JUMBF).
- `c2pa.redacted` assertion label: this is a vendor-namespaced custom assertion (`vfx_familiar.redacted` to match the project's existing convention). The C2PA spec supports redaction natively but the vendor-namespaced approach is simpler for v1.1 and matches Phase 15's `vfx_familiar.input` + `vfx_familiar.unavailable_ingredient` pattern.
- Re-signing on redaction: the derived manifest is re-signed with the SAME cert as the original (Phase 14 signer). Cost is one signature operation per redaction.
- redactionPolicy validation: validate that the policy paths exist in the manifest before stripping. If a path is missing, surface as a soft warning in the redacted_fields list (mark with `not_found:` prefix).

### Deferred
- HSM/Yubikey signing for redaction events — out of scope per REQUIREMENTS.
- Streaming-friendly redaction for large videos — out of scope; redaction operates on the full file bytes.
- Multi-step redaction (redact-then-redact-again) — out of scope; v1.1 redacts a fresh-from-original manifest each time.
- C2PA spec's native `c2pa.redacted_assertions` mechanism — defer; vendor-namespaced label is sufficient for v1.1.
- Bulk redaction across multiple versions — out of scope; agent-tier callers iterate.
</decisions>

<code_context>
## Existing Code Insights

- `src/tools/version-tool.ts` — existing 4-action discriminated union (`GetInput`, `ListInput`, `DiffInput`, `ProvenanceInput`). Phase 16 adds 2 new schemas + 2 new case branches in the action switch.
- `src/tools/envelope.ts` — `toolOk` / `toolError` envelope shapes. Mirror existing patterns (D-PROV-08).
- `src/engine/pipeline.ts` — Engine facade. Adds 3 new methods: `redactManifestForVersion`, `verifyManifestForVersion`, `exportManifestForVersion`. Each delegates to the new c2pa modules.
- `src/store/provenance-repo.ts` — `getLatestManifestSignedEvent` reader exists (Phase 14). Phase 16's exporter calls it. Redaction's `redacted: true` event is appended via the existing `appendManifestSignedEvent` (sibling row pattern preserved).
- `src/engine/c2pa/signer.ts` — Phase 14's signer wraps c2pa-node. Verifier reads via c2pa-node's `createC2pa().read({asset})` API; redaction re-signs via the existing `signEmbedBufferWithIngredients` / `signEmbedFileWithIngredients`.
- `src/__tests__/c2pa-verification.test.ts` — Phase 14 reference for c2pa-node read pattern.
- `src/__tests__/c2pa-uat-mcp-tool.test.ts` — Phase 14 reference for wire-level UAT via @modelcontextprotocol/sdk Client + StdioClientTransport.
- Test baseline (post Phase 15 + audit fixes): 1189 root passing / 5 pre-existing failing / 3 skipped + 88 dashboard.
- Architecture-purity guard: `src/__tests__/architecture-purity.test.ts` — extension target. Adds positive smoke for src/engine/c2pa/redaction.ts, exporter.ts, verifier.ts.
- Append-only provenance: redaction writes a NEW manifest_signed event; never UPDATEs.
- Tool budget: 7 top-level tools currently. Phase 16 adds 0 new top-level tools (action-only extension).
- Wire-level UAT pattern from Phase 14/15 — drive new tool actions via @modelcontextprotocol/sdk Client.
</code_context>

<specifics>
## Specific Ideas

- **Redaction policy DSL (v1.1):** simple JSON-pointer-style paths. Examples:
  - `assertions[*].data.prompt_positive` (strip from any assertion's data.prompt_positive)
  - `assertions[label='vfx_familiar.input'].data.prompt_negative` (label-targeted)
  - `claim_generator` (strip the generator string)
  Each path resolved at redact time; missing paths produce a `not_found:<path>` entry in redacted_fields.

- **VerificationReport breakdown of `signature_status`:**
  - `valid` — manifest reads cleanly; signature verifies against trust root; all C2PA assertions pass validation
  - `invalid` — one or more assertions failed (e.g., dataHash.mismatch from tampered bytes)
  - `untrusted_root` — signature is well-formed but cert chain doesn't verify against trust root
  - `unsupported_algorithm` — c2pa-node refuses the algorithm
  - `no_manifest` — file has no embedded manifest

- **export_manifest envelope shape:**
  ```ts
  {
    isError: false,
    structuredContent: {
      version_id: string,
      format: string,
      signed_at: string | null,
      manifest_bytes_base64: string | null,
      manifest_status: 'present' | 'absent' | 'unsupported_format',
      cert_subject: string | null,
      ingredients_summary: { parent_count, component_count, unavailable_count, input_assertion },
      breadcrumb: Breadcrumb,
    }
  }
  ```

- **verify_manifest envelope shape:**
  ```ts
  {
    isError: false,
    structuredContent: {
      valid: boolean,
      signature_status: 'valid' | 'invalid' | 'untrusted_root' | 'unsupported_algorithm' | 'no_manifest',
      matched_assertions: string[],
      gaps: string[],
      failures: Array<{ assertion: string; reason: string }>,
      cert_subject: string | null,
      signed_at: string | null,
      breadcrumb: Breadcrumb | null,  // null for pure-bytes verify
    }
  }
  ```

- **Redaction flow:**
  1. Caller invokes `version.redact_manifest` (PROBABLY out-of-scope for v1.1 if we don't surface the redaction primitive at the tool boundary; redaction may live engine-only and be wired into a future tool action). PROV-V-06 says "a tool caller (or dashboard user)" — so v1.1 exposes it. Add a 7th action `redact_manifest` (input: `version_id` + `redaction_policy`), bringing version's action count to 7.
  2. Engine.redactManifestForVersion reads latest manifest_signed event, extracts the manifest JSON, applies the policy, re-signs the asset bytes via Phase 14's signer with the redacted manifest definition (which now carries a vendor `vfx_familiar.redacted` assertion).
  3. Writes a new manifest_signed event with `redacted: true` + `redacted_fields: string[]` payload.
  4. Returns the redacted manifest bytes (same envelope as export_manifest).

- **Tool budget revisited:** v1.1 PROV-V-06 + PROV-V-07 add 3 new actions to the version tool: `export_manifest`, `verify_manifest`, `redact_manifest`. Total version actions: 7. Top-level tool count unchanged: 7 of 12.

- **Cohort closure:** Plan 16-05 marks PROV-V-06 + PROV-V-07 complete. Plan 16-05 also marks the v1.1 milestone complete in REQUIREMENTS.md (status indicator). Phase 16 SUMMARY summarizes the entire milestone.

- **Plan structure (planner discretion):**
  - Plan 16-01: Engine modules — exporter.ts + verifier.ts
  - Plan 16-02: Engine module — redaction.ts (+ Phase 14 signer integration)
  - Plan 16-03: Tool surface — version.export_manifest + version.verify_manifest action handlers + Zod schemas
  - Plan 16-04: Tool surface — version.redact_manifest action handler + Zod schema
  - Plan 16-05: E2E + dual-transport parity + wire-level UAT + cohort closure (PROV-V-06 + PROV-V-07 + milestone v1.1 indicator)
</specifics>

<deferred>
## Deferred Ideas

- HSM/Yubikey signing — Out-of-Scope.
- Streaming-friendly redaction for large videos — Out-of-Scope.
- Multi-step redaction — Out-of-Scope; v1.1 redacts from original each time.
- C2PA spec's native redaction primitive — defer; vendor-namespaced is simpler.
- Bulk redaction across versions — Out-of-Scope.
- Multi-CA / federated trust roots for verification — Out-of-Scope per REQUIREMENTS.
- Time-stamp authority (TSA) verification beyond what c2pa-node default checks — defer to v1.2.
</deferred>
