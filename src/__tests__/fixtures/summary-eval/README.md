# Phase 19 Summary Eval Fixtures

12 hand-curated fixtures for the AI conversational summary feature evaluation.

## Composition

See AI-SPEC.md §5 Reference Dataset for the full rubric. Each fixture covers
one canonical lineage shape (root, iterate, redacted, multi-LoRA, ControlNet)
plus three edge cases (KSampler-absent, prompt-injection, long-prompt).

| Fixture                          | Lineage Shape         | Models / LoRAs                                 | Edge Property                                        |
| -------------------------------- | --------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| 01-root-flux                     | Root                  | flux1-dev only                                 | Single-model baseline                                |
| 02-root-sdxl                     | Root                  | sd_xl_base_1.0.safetensors only                | Filename-style verbatim with `.safetensors`          |
| 03-iterate-flux-onelora          | Iterate from 02       | flux1-dev + cinematic_fantasy                  | Canonical voice fingerprint (ROADMAP exemplar)       |
| 04-iterate-sdxl-onelora          | Iterate from 03       | sd_xl_base_1.0.safetensors + detail_boost      | Single LoRA on filename-style model name             |
| 05-iterate-flux-2lora            | Iterate from 04       | flux1-dev + 2 LoRAs                            | Multi-LoRA stack (2)                                 |
| 06-iterate-sdxl-3lora            | Iterate from 05       | sd_xl_base_1.0.safetensors + 3 LoRAs           | Multi-LoRA stack (3) — exercises honest collapse     |
| 07-controlnet-driven             | Iterate from 03       | flux1-dev + controlnet_canny                   | Phase 15 ingredient-graph ControlNet                 |
| 08-controlnet-redacted           | Iterate from 07       | Surviving fields                               | Phase 16 redact event present                        |
| 09-iterate-redacted              | Iterate from 03       | Surviving fields                               | Redaction with iterate-lineage                       |
| 10-ksampler-absent               | Root                  | flux1-dev                                      | Pitfall 7 fall-through (no KSampler)                 |
| 11-prompt-injection-attempt      | Iterate from 03       | flux1-dev + cinematic_fantasy                  | Jailbreak in user_prompt_positive                    |
| 12-long-prompt-edge              | Iterate from 05       | flux1-dev + 2 LoRAs                            | ~1500-token prompt — sentence-budget pressure        |

## File Format

Each `.json` file contains:

- `fixture_id`, `lineage_shape`, `version_label`, `parent_version_label`
- `completed`: `ProvenanceCompletedPayload` shape (`prompt_json`, `outputs_json`, `seed`)
- `models`: `ModelRef[]` — each entry has `model_name` verbatim
- `manifest_signed`: null OR `{ redacted, manifest_sha256 }` for redacted fixtures
- `redacted`, `ingredient_summary_counts`
- `user_prompt_positive`, `user_prompt_negative`
- `golden_summary`: hand-authored reference summary in canonical Supervisor voice
- `expected_dimensions`: per-dimension assertion ground truth

## Re-Bless Cadence

Per AI-SPEC §5 — full corpus reviewed on every `SUMMARY_TEMPLATE_VERSION`
semver bump (system prompt edit, few-shot edit, sanitization allow-list change,
output-format change per D-LLM-6). Per-fixture re-bless when an upstream
provenance schema change (Phase 13 / 15 / 16) changes the canonical shape of
`models_json` / ingredient graph / redact event payload.

## Authoring Roles

- VFX Supervisor / Sequence Lead authors voice-fingerprint reference summaries.
- Studio Pipeline TD owns redacted fixtures (08, 09) for NDA / leak-scan calibration.
- VFX Generalist / Compositor reviews fact-fidelity dimensions.
- Open-source contributors propose edge cases via PR with VFX-practitioner sign-off.

## CI Integration

The 12 fixtures are exercised by `npm run test:eval`. Code-based dimensions
run unconditionally; LLM-judge dimensions require `ANTHROPIC_API_KEY` and skip
with a `[summary-eval] skipped (no API key)` log line when absent.

CI hard-fail thresholds (per AI-SPEC §5 CI/CD Integration):

- **Critical** (model-name fidelity, voice banned-lexicon, anti-feature, leak-scan): 100% pass
- **High** (lineage, LoRA, sentence-count, redaction-marker): >= 95% pass
- **Medium** (seed precision): >= 90% pass

Estimated CI cost per run: ~$0.05 (12 fixtures × ~$0.002 cache-warmed Haiku 4.5
+ 8 LLM-judge calls × ~$0.003 Sonnet judge). Acceptable per-PR cost.

## Dimension Coverage

| Dimension                                   | Code-Based | LLM-Judge | Skip-when-no-key |
| ------------------------------------------- | ---------- | --------- | ---------------- |
| Verbatim model-name fidelity (D-VAL-1)      | yes        |           | runs always      |
| Sentence count + length (D-LLM-3)           | yes        |           | runs always      |
| Anti-feature regression (v1.2 OUT-OF-SCOPE) | yes        |           | runs always      |
| NDA redaction marker (D-VAL-3)              | yes        |           | runs always      |
| API-key leak scan (Pitfall 4 / D-PRIV-3)    | yes        |           | runs always      |
| Banned-lexicon AI-slop (Section 1b)         | yes        | yes       | code runs always |
| Iterate-lineage relationship (D-LLM-2)      |            | yes       | skipped no-key   |
| Supervisor voice register (Section 1b)      |            | yes       | skipped no-key   |
| LoRA stack accuracy / honest collapse       | yes        | yes       | code runs always |

## Skip Semantics

The eval suite logs `[summary-eval] skipped (no API key)` for any LLM-judge
dimension that bypasses an API call when `ANTHROPIC_API_KEY` is absent.
Skipped dimensions return a passing-but-marked result so that contributors
without keys can still see code-based dimensions execute. Threshold gating
treats a skip as a pass — Critical-tier dimensions are exclusively code-based
to ensure that no skip path masks a regression in the load-bearing safety
invariants.

## Cross-Reference

- AI-SPEC §5 Reference Dataset table — fixture composition rubric
- AI-SPEC §5 Dimensions table — pass/fail rubric per dimension
- AI-SPEC §5 CI/CD Integration — threshold gates and budget
- 19-CONTEXT.md "Eval set for voice quality" — sizing rationale (8-12 fixtures)
- ROADMAP.md Phase 19 voice fingerprint exemplar — anchored in fixture 03
