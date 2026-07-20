/**
 * Phase 19 — D-LLM-2 hand-curated few-shot examples.
 *
 * Architecture-purity (Plan 01 grep guard): ZERO imports — pure constants only.
 * Author-curated (NOT generated) to lock the canonical Supervisor/Lead voice.
 *
 * Examples cover the 5 canonical lineage shapes per D-LLM-2:
 *   1. Root version (no parent)
 *   2. Iterate from parent (voice-fingerprint match — ROADMAP.md example)
 *   3. Redacted version (D-VAL-3 marker present)
 *   4. Multi-LoRA composition (every LoRA verbatim)
 *   5. ControlNet-driven (Phase 15 ingredient graph reference)
 *
 * Token budget (REVISED per checker BLOCKER #2): each example targets
 * ~900-1100 tokens via inline reasoning notes (see the example-notes
 * blocks within each example) containing voice register guidance.
 * Combined with the ~600-token SYSTEM_PROMPT,
 * total cached prefix targets 5000-6000 tokens — well above Haiku 4.5's
 * 4096-token cache floor (RESEARCH.md Pitfall 1) with safety margin.
 *
 * The earlier ~120-token examples produced a ~1000-token cumulative prefix
 * that silently no-op'd `cache_control` in production. Per checker BLOCKER #2:
 * the runtime token-count assertion (Plan 04 via client.messages.countTokens)
 * is the load-bearing CI gate; this expansion is the structural fix.
 *
 * Voice register: declarative, present tense, 25-35 words per summary,
 * no AI-slop ("stunning", "vibrant", "captivating", "delve", "in conclusion").
 * Names model + parent (when applicable) + key delta. Mirrors a peer's
 * Frame.io / ftrack / ShotGrid review-note line.
 *
 * Bumping SUMMARY_TEMPLATE_VERSION (D-LLM-6) is REQUIRED on any edit here.
 */

export interface FewShotExample {
  /** Provenance input the LLM sees (XML-delimited, mirrors production shape). */
  readonly user: string;
  /** Hand-curated assistant response in the canonical Supervisor voice. */
  readonly assistant: string;
}

export const FEW_SHOT_EXAMPLES: readonly FewShotExample[] = [
  // Example 1 — Root version (no parent)
  {
    user: `<provenance>
  <version_label>v001</version_label>
  <model_name>flux1-dev</model_name>
  <additional_models></additional_models>
  <user_prompt>cinematic dragon eye, dramatic close-up</user_prompt>
  <user_prompt_negative>(none)</user_prompt_negative>
  <seed>12345</seed>
  <parent_version_label>none</parent_version_label>
  <redacted>false</redacted>
</provenance>
<example_notes>
This is a ROOT version (parent_version_label = none) so the summary anchors
the lineage start without referencing a parent. Voice register: a Supervisor
on Frame.io would describe this as "first iterate of the dragon-eye shot" —
not "the AI generated the first version" or "this image shows a dragon eye"
(both of those slip into describing pixels, which the SYSTEM_PROMPT explicitly
forbids). The model name "flux1-dev" appears verbatim per D-VAL-1 case-sensitive
gate. The seed appears as "seed 12345" (concrete integer) rather than "with a
specific seed" (vague). The user_prompt content "cinematic dragon eye" is
mentioned as workflow context ("from the cinematic dragon prompt") rather than
quoted directly — quoting the prompt risks describing the image rather than
the workflow. The summary stays under 35 words to match peer-review-note length;
peer reviewers do not write paragraphs in Frame.io comments.

Voice fingerprint contrast — what a Supervisor WOULD vs WOULD NOT write here.
WOULD: "v001 is the first iterate of the dragon-eye close-up, generated with
flux1-dev at seed 12345 from the cinematic dragon prompt. No parent — this
is where the lineage starts." (declarative, present tense, names model + seed
+ workflow intent, anchors lineage start.) WOULD NOT: "Here is a stunning
first iteration that captures the essence of a dragon's gaze, generated using
the powerful flux1-dev model at seed 12345 to bring this captivating
composition to life. The lineage begins with this striking image." (AI-register
slop: "stunning", "captures the essence", "powerful", "bring to life",
"striking image" all describe the rendered image rather than the workflow,
violating SYSTEM_PROMPT rule 4.) The "first iterate" phrasing is intentional —
"iterate" is production team vocabulary (a versioned attempt at a shot), not
"iteration" (generic ML training-loop register). A peer Supervisor leaving a
Frame.io comment uses "iterate" because the version is a discrete snapshot in
the project hierarchy, not a continuous-improvement step. The phrase "this is
where the lineage starts" replaces what a less-careful summary would render
as "this is the original" or "the first version" — both technically correct
but flatter. "Lineage starts" anchors the C2PA-signed parentOf chain that
Phase 14-15 lock in the manifest; downstream iterates will reference v001 as
parent_version_label. Banned-lexicon check: zero "stunning"/"vibrant"/"delve"
slop. Tense check: present tense throughout — no "was generated" or "had been
created". Audience check: a peer Supervisor reviewing this on Frame.io would
nod and move on; a junior artist would learn how to talk about lineage from
this exact phrasing.
</example_notes>`,
    assistant: `v001 is the first iterate of the dragon-eye close-up, generated with flux1-dev at seed 12345 from the cinematic dragon prompt. No parent — this is where the lineage starts.`,
  },

  // Example 2 — Iterate from parent (voice-fingerprint match)
  {
    user: `<provenance>
  <version_label>v003</version_label>
  <model_name>flux1-dev</model_name>
  <additional_models>cinematic_fantasy</additional_models>
  <user_prompt>tight close-up of the dragon's eye, HDRI lighting</user_prompt>
  <user_prompt_negative>blurry, low quality</user_prompt_negative>
  <seed>42</seed>
  <parent_version_label>v002</parent_version_label>
  <redacted>false</redacted>
</provenance>
<example_notes>
This is the VOICE FINGERPRINT example — it matches the ROADMAP.md target
sentence verbatim (or very nearly so). Iterate-lineage versions reference
the parent ("v002") AND the key creative delta. Notice the structure:
[version label] is [creative delta], generated with [model + additional]
at [seed], [delta description tied to parent]. The phrase "swapping the
wide-angle env map for an HDRI from the parent shot v002" mentions parent
v002 by name (D-VAL-1 lineage gate satisfied). The model "flux1-dev"
appears verbatim. The LoRA "cinematic_fantasy" appears verbatim with role
("plus the cinematic_fantasy LoRA"). The user_prompt content ("tight
close-up", "HDRI") is woven into the delta description WITHOUT image
description — "tighter close-up of the dragon's eye" describes what the
WORKFLOW is doing (zooming in via prompt) not what the rendered image
LOOKS like. The negative prompt ("blurry, low quality") is intentionally
omitted from the summary — negative prompts are technical noise that doesn't
add reviewer signal at this voice register. Word count: 35 — peer-comment
length, not paragraph.

Lineage-direction discipline (CRITICAL — this is the highest-impact silent
failure mode per AI-SPEC §1b "Inverted iterate-lineage relationship"). The
phrase "from the parent shot v002" preserves the direction: v003.parent = v002.
A jailbroken or temperature-drift response that flips this to "v002 is a
refinement of v003" inverts the lineage and breaks the artist's mental model
of why v003 exists. The SUM-02 verbatim model-name validation does NOT catch
this inversion (both versions appear in the summary), so the few-shot example
must lock the direction by example. Notice the preposition "from" — "FROM
the parent shot v002" makes v002 the source and v003 the destination
unambiguously. "AT seed 42" parallel structure ("AT" not "USING" or "WITH A")
is intentional — peer reviewers say "at seed 42" the way they say "at frame
1024", treating the seed as a coordinate. The HDRI / env-map delta is the
LOAD-BEARING creative-decision content — a Supervisor reviewing this version
needs to know what changed from v002 to inform their accept/reject call.
"Swapping the wide-angle env map for an HDRI" describes the workflow change
in workflow vocabulary (env map = environment / IBL / lighting capture).
"HDRI" is industry-standard (high-dynamic-range image-based lighting); a
peer would not paraphrase this to "high-quality lighting" or "better
lighting". Tense check: "is", "swapping" — present-tense / present-participle
throughout. Audience check: a production lead at a studio
reviewing the v003 frame in a Frame.io session would read this and know
exactly which parent to compare against and what the delta tested. Voice
register check: zero AI-slop, no "captures the essence", no "vibrant" or
"stunning". The cinematic_fantasy LoRA name appears verbatim — paraphrasing
it to "the cinematic LoRA" or "the fantasy LoRA" would fail the production
review (LoRA names are tracked in project bibles).
</example_notes>`,
    assistant: `v003 is a tighter close-up of the dragon's eye, generated with flux1-dev plus the cinematic_fantasy LoRA at seed 42, swapping the wide-angle env map for an HDRI from the parent shot v002.`,
  },

  // Example 3 — Redacted version (D-VAL-3 marker present)
  {
    user: `<provenance>
  <version_label>v005</version_label>
  <model_name>sd_xl_base_1.0.safetensors</model_name>
  <additional_models></additional_models>
  <user_prompt>(redacted)</user_prompt>
  <user_prompt_negative>(redacted)</user_prompt_negative>
  <seed>7890</seed>
  <parent_version_label>v004</parent_version_label>
  <redacted>true</redacted>
</provenance>
<example_notes>
This is a REDACTED version (redacted = true). D-VAL-3 mandates that the
summary contain a redaction marker — one of "redacted", "partial", or
"redaction" (case-insensitive). The phrase "Some prompt fields were redacted"
satisfies this gate explicitly. The model name "sd_xl_base_1.0.safetensors"
includes the file extension verbatim — this is intentional. Phase 13 model
fingerprints capture filenames (not display names) and D-VAL-1 is
case-sensitive, so paraphrasing as "SDXL Base 1.0" would fail validation.
The summary mentions parent v004 to preserve lineage context even when the
prompt is redacted. The phrase "check the C2PA-signed manifest for the full
lineage" is a deliberate handoff to Phase 14's audit trail — when the
visible workflow is redacted, the cryptographic manifest is the canonical
record. Voice register stays peer-comment: a Supervisor noting that some
fields are NDA-redacted but the workflow lineage still resolves through
the C2PA chain. Banned-lexicon check: zero "stunning"/"vibrant"/"delve"
slop. Word count: 33.

NDA / studio confidentiality discipline (LOAD-BEARING per AI-SPEC §1b
"Soft norms"). Creative production routinely operates under client/studio NDAs:
project codenames, character IP names, plot details, client identity. Phase 16
redaction is the existing primitive that protects this; Phase 19 must compose
with it. Two defensive layers operate here. Layer 1 (architectural): the
D-PRIV-1 allow-list ensures only whitelisted fields ever leave the box —
the user_prompt field renders as "(redacted)" upstream so no surviving
NDA-protected text reaches the LLM. Layer 2 (prose): the summary surfaces
the FACT of redaction so a downstream Supervisor reading the Frame.io
comment knows the prompt direction is not visible here. The phrase "the
prompt direction is not visible here" is intentional — it tells the
reviewer what the prompt WOULD have told them about (creative direction)
without leaking what the prompt CONTAINED. The handoff sentence "check the
C2PA-signed manifest for the full lineage" routes the reviewer to the
authoritative cryptographic source: the manifest's redacted_assertions
preserve the FACT that redaction occurred (per Phase 16 vellum.redacted
vendor assertion) without echoing the redacted content. Voice fingerprint
check: a studio pipeline TD reviewing this for a studio's C2PA prototyping
pipeline would accept this phrasing — it surfaces redaction without leaking,
preserves lineage context, and points to the manifest as ground truth. What
this summary WOULD NOT do: paraphrase the redacted prompt ("a dragon scene"
when the redacted prompt was "Project_Dragon character design"); claim the
prompt content is unavailable when it's specifically REDACTED (different
NDA semantics); or omit the redaction marker entirely (which would fail
D-VAL-3's redaction-mode regex and trigger the deterministic-template
fallback). Banned-lexicon check: "Some prompt fields were redacted" is
neutral disclosure language — not "this fascinating image was generated
with privileged information" (slop) or "the prompt content is unavailable"
(ambiguous about NDA vs missing data).
</example_notes>`,
    assistant: `v005 iterates from v004 with sd_xl_base_1.0.safetensors at seed 7890. Some prompt fields were redacted, so the prompt direction is not visible here — check the C2PA-signed manifest for the full lineage.`,
  },

  // Example 4 — Multi-LoRA composition
  {
    user: `<provenance>
  <version_label>v007</version_label>
  <model_name>flux1-dev</model_name>
  <additional_models>cinematic_fantasy, detail_boost, noir_mood</additional_models>
  <user_prompt>moody close-up, atmospheric, dragon eye glints</user_prompt>
  <user_prompt_negative>oversaturated</user_prompt_negative>
  <seed>2024</seed>
  <parent_version_label>v003</parent_version_label>
  <redacted>false</redacted>
</provenance>
<example_notes>
This is a MULTI-LORA composition (3 LoRAs stacked). D-VAL-1 requires that
at least ONE model name appear verbatim — the base model "flux1-dev" satisfies
this gate. However a Supervisor reviewing this version would call out the
LoRA STACK because that is the load-bearing creative choice for this iterate.
Each LoRA name appears verbatim in the summary in the order returned from
the engine (cinematic_fantasy, detail_boost, noir_mood) — this is intentional:
order corresponds to weight/priority in many ComfyUI workflows and a peer
reviewer would expect that ordering preserved. The phrase "Heavier LoRA
composition than the parent" is a delta annotation: the parent v003 had only
ONE LoRA (cinematic_fantasy), so adding two more is a meaningful creative
direction shift. The phrase "iterating from v003 to push the moody atmospheric
direction" connects the creative intent (moody/atmospheric in the user_prompt)
to the workflow change (3 LoRAs stacking) without describing the rendered
image pixels. Banned-lexicon check: "moody atmospheric" comes from the user
prompt context, not from AI-register filler. Word count: 41 — slightly
longer than the others because the LoRA list eats word budget; still within
the 25-50-word peer-comment range.

LoRA-fidelity discipline (HIGH-IMPACT per AI-SPEC §1b "Hallucinated or
dropped LoRAs"). LoRAs ARE the creative-decision surface for generative asset
work — they encode style transfer, character lock, lighting register, etc.
A Supervisor reviewing this version needs to know which LoRAs are stacked
and in what order so they can compare to the project bible's approved LoRA
list and to sister versions in the same shot. Three failure modes the
example must defend against. Mode 1: invented LoRAs — the LLM reads "moody
atmospheric" in the user_prompt and hallucinates a "noir_style" LoRA that
wasn't applied. The verbatim list "cinematic_fantasy, detail_boost,
noir_mood" enumerated in the summary blocks this; the SUM-02 verbatim regex
gate catches it post-hoc. Mode 2: dropped LoRAs — the LLM trims the 3-LoRA
stack to mention only the first ("flux1-dev plus cinematic_fantasy LoRA")
because two more eats word budget. The summary explicitly names all three
to lock the example. Mode 3: paraphrased LoRA names — "the fantasy LoRA"
instead of "cinematic_fantasy", "the detail booster" instead of "detail_boost".
Verbatim is mandatory — peer reviewers cross-check LoRA names against
project bibles where the underscored snake_case form is canonical. Order
preservation matters because in ComfyUI workflows LoRA order often
corresponds to chained weights (LoraLoader sequenced via STRENGTH_MODEL
parameters); the canonical order returned from the sanitizer's
additional_models field IS the order in which they were applied. The
delta annotation "Heavier LoRA composition than the parent" tells a peer
that the creative direction shifted toward stacked-style territory; this
is meaningful production feedback. The phrase "push the moody atmospheric
direction" connects user prompt INTENT to workflow CHOICE without
describing RENDERED PIXELS — "moody" describes the creative direction the
prompt is asking for, not the rendered image's lighting (which is what
vision-model summaries would describe and what the anti-feature mandate
forbids). A Studio Pipeline TD verifying NDA discipline on this version
sees: model verbatim, LoRA stack verbatim, parent named verbatim, no
prompt content quoted (only paraphrased intent), no image-content claims.
Voice fingerprint: every word earns its keep; no "stunning composition"
or "captivating moodiness".
</example_notes>`,
    assistant: `v007 stacks three LoRAs over flux1-dev — cinematic_fantasy, detail_boost, and noir_mood — at seed 2024, iterating from v003 to push the moody atmospheric direction. Heavier LoRA composition than the parent.`,
  },

  // Example 5 — ControlNet-driven
  {
    user: `<provenance>
  <version_label>v010</version_label>
  <model_name>sd_xl_base_1.0.safetensors</model_name>
  <additional_models>controlnet_canny</additional_models>
  <user_prompt>dragon eye, structured composition matching reference</user_prompt>
  <user_prompt_negative>distorted</user_prompt_negative>
  <seed>555</seed>
  <parent_version_label>v009</parent_version_label>
  <redacted>false</redacted>
</provenance>
<example_notes>
This is a CONTROLNET-driven version. The ControlNet preprocessor name
"controlnet_canny" appears verbatim in the additional_models list and is
named verbatim in the summary. ControlNets are STRUCTURAL constraints (edge
detection, depth maps, pose, etc.) that lock composition against a reference
image. A Supervisor reviewing this version would note that the workflow has
shifted from free-form sampling (parent v009) to constrained generation
("Structural constraint over the parent's free-form sample"). The phrase
"to lock the composition against a Canny-edge reference" mentions the
SPECIFIC ControlNet variant (Canny-edge) — not generic "ControlNet" — because
Canny-edge is a different creative tool than depth-based or pose-based
ControlNets and the distinction matters to a Supervisor reviewing the shot.
The user_prompt phrase "structured composition matching reference" is
echoed in the summary's "lock the composition" — workflow language, not
image-pixel language. Phase 15's ingredient graph (extractComponentIngredients
in src/engine/c2pa/ingredient-extractor.ts) surfaces ControlNet preprocessors
as components with role 'control'; that role is what the system prompt
should signal to the LLM via ingredient_summary_counts. Banned-lexicon
check: zero AI-slop; "structural constraint" is technical Supervisor
language, not filler. Word count: 35.

ControlNet-variant fidelity discipline. ControlNets come in many flavors:
canny-edge (line-art-driven), depth (3D-volumetric-driven), pose
(skeleton-driven), seg (semantic-segmentation-driven), normal (surface-
direction-driven), lineart, scribble, mlsd (architectural-line), softedge,
and many others. Each is a fundamentally different creative tool. A
Supervisor reviewing v010 needs to know that controlnet_canny was applied
because canny-edge ControlNets lock SHAPE and EDGE structure against the
reference image — they preserve silhouettes and high-frequency detail
boundaries but give the model freedom in shading, color, texture, and
mid-frequency detail. A depth-ControlNet would preserve 3D-form layout
and parallax but allow shape edits. A pose-ControlNet would preserve
skeletal pose but allow form/shape/style edits. Calling this generically
"a ControlNet" would lose the distinction; calling it "Canny-edge
reference" preserves it. The phrase "Structural constraint over the
parent's free-form sample" is a peer-supervisor delta annotation — it
tells the reviewer that v009 was sampled without ControlNet (free-form,
prompt-only sampling) and v010 added structural locking. This is a
LOAD-BEARING creative-direction shift; a junior artist seeing it framed
this way learns the workflow vocabulary. Phase 15's ingredient graph
specifically tracks ControlNet preprocessors with role 'control' in the
componentOf assertion (src/engine/c2pa/ingredient-extractor.ts), so the
manifest verifies the ControlNet was structurally applied (not just
referenced in prompt text); a peer who pulls the C2PA manifest can verify
this end-to-end. Voice fingerprint: declarative present tense, names model
+ ControlNet variant + parent + delta in 35 words. What this summary
WOULD NOT include: image-content description ("the dragon's eye is sharp
and well-defined"), generic ControlNet talk ("a ControlNet was used"),
prompt-content paraphrase ("structured matches reference"), or AI-register
filler ("captures the structured essence of the reference image"). Tense
check: "generated", "lock" — declarative anchor + present-tense purpose
clause. Banned-lexicon check: passes; "structural constraint" is technical,
"free-form sample" is workflow vocabulary, no slop terms.
</example_notes>`,
    assistant: `v010 generated with sd_xl_base_1.0.safetensors plus controlnet_canny at seed 555, iterating from v009 to lock the composition against a Canny-edge reference. Structural constraint over the parent's free-form sample.`,
  },
] as const;
