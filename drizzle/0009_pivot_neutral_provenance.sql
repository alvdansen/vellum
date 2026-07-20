-- IDM: ROLLBACK NOT SUPPORTED.
--
-- Pivot Phase B — provider-agnostic provenance groundwork. All additive, all
-- NULLABLE, dual-read (legacy rows read NULL and keep working):
--   1. versions.provider — the GenerationProvider adapter id that produced the
--      row (e.g. 'comfyui-cloud', 'replicate'). NULL on pre-pivot rows.
--   2. provenance.generation_request_json — neutral analog of workflow_json
--      (the request spec a non-ComfyUI provider submitted).
--   3. provenance.generation_result_json — neutral analog of prompt_json; holds
--      a serialized NeutralProvenance (params/models/output_hash) for providers
--      with no resolvable prompt blob.
-- The ComfyUI adapter keeps populating workflow_json/prompt_json for back-compat;
-- new adapters write the neutral columns. Readers dual-read.
ALTER TABLE `versions` ADD `provider` text;--> statement-breakpoint
ALTER TABLE `provenance` ADD `generation_request_json` text;--> statement-breakpoint
ALTER TABLE `provenance` ADD `generation_result_json` text;
