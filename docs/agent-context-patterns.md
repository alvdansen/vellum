# Agent context patterns

Four patterns for building an agent that produces assets through Vellum. They
are not Vellum-specific ideas — they came out of looking at production pipelines
where an agent drives a creative tool directly — but Vellum has direct support
for two of them and opinions about the other two.

The problem they all address: an agent that generates or modifies production
assets needs to know *what good looks like* before it acts, and the record of
what it did needs to survive long enough to be argued with.

---

## 1. Put standing context in a spec, and version it

An agent working on a show needs the show's rules: the palette, the naming
convention, the lighting language, the "we never do X" list. The naive place to
put that is the prompt. The slightly less naive place is a project file the
agent reads on startup.

Both lose the same thing — **which version of the rules was in force when this
asset was made.**

That matters because the rules change. They change *because* an agent got
something wrong and the rule turned out to be ambiguous. If you cannot tell
which assets were made under the old wording, you cannot tell which ones need
revisiting, and the correction quietly rewrites history for everything.

Vellum models this as a **project spec**:

```jsonc
// Write a revision. This ALWAYS appends — there is no edit-in-place.
{ "tool": "project", "action": "set_spec",
  "id": "proj_…",
  "content": "# Palette\nHero warm 3800K…\n# Naming\n{project}_{sequence}_{shot}…",
  "note": "pin the exposure anchor — ratios were ambiguous without it" }

// Read the current one before you generate.
{ "tool": "project", "action": "get_spec", "id": "proj_…" }

// See how it evolved.
{ "tool": "project", "action": "list_spec_revisions", "id": "proj_…" }
```

Vellum does not parse the spec. It is opaque text — markdown is the obvious
choice. What Vellum does is version it, hash it, and **stamp the active revision
onto every version created afterwards**, as an append-only `spec_bound`
provenance event:

```jsonc
{ "tool": "version", "action": "provenance", "version_id": "ver_…" }
// → … { "event_type": "spec_bound",
//        "spec_bound_json": "{\"revision\":2,\"content_hash\":\"9f86d0…\"}" }
```

The per-shot pipeline log surfaces it per take (`**Spec:** revision 2`).

### The rule this buys you

> **If the agent got it wrong and the spec was ambiguous, fix the spec — not
> just the output.**

That is the difference between a system that improves over a hundred shots and
one that degrades into a hundred hand-fixes. It only works if revisions are
durable, which is why `project_specs` is append-only under the same structural
guard as provenance: the repo has no update or delete path, and a build-time
test fails if anyone adds one.

### Keep specs small and per-project

A spec is loaded before work, so its cost is paid on every call, not once at
write time. Vellum caps a revision at 256 KiB. If you are approaching that,
you want several narrower specs (one per sequence, or per look family), not one
larger one — see pattern 2.

---

## 2. Serve context as addressable resources, not one monolith

The tempting design is to concatenate every spec into one big context file that
the agent always has loaded. It works at 5 entries and gets worse at every
number after that: context cost grows with the whole show, and retrieval quality
drops as the relevant paragraph gets buried among irrelevant ones.

MCP already has the right primitive. Vellum serves specs as a **templated
resource**:

```
vellum://project/{project_id}/spec
```

The agent fetches the project it is actually working in. Resources cost **zero
tool slots** (Vellum is capped at 12 and uses 7), so this scales without
crowding the tool surface.

This is the same reason Vellum's own onboarding is three resources rather than a
preamble:

| Resource | What it carries |
| --- | --- |
| `vellum://manual` | How to drive the tools, the response envelope |
| `vellum://capabilities` | Machine-readable actions, limits, configured providers |
| `vellum://output-contract` | The exact schema for registering an external output |
| `vellum://project/{id}/spec` | That project's standing context |

**If you are building your own MCP server**: reach for resources before you
reach for a bigger system prompt. Anything that is (a) reference material,
(b) per-entity, and (c) not needed on every call is a resource, not context.

---

## 3. Gate on irreversibility, not just on cost

Vellum's approval gate exists so nothing spends credits without a human:
`propose` records the verbatim request, `approve` executes it exactly once, and
a guarded claim makes double-spend structurally impossible.

Spend is the obvious thing to gate. It is not the only thing worth gating.

An agent driving a creative tool does things that cost nothing and cannot be
undone — relighting a scene, overwriting a working file, publishing to a
tracker. "It's free" is not the same as "it's safe." The property that deserves
a human is **irreversibility**.

So the same machinery takes actions Vellum does not execute:

```jsonc
{ "tool": "generation", "action": "propose",
  "kind": "external",
  "shot_id": "shot_…",
  "external_action": "Relight sh010: KEY 45° camera-left + RIM opposite. Overwrites Lighting.umap.",
  "external_tool": "unreal-mcp",
  "external_request": { "op": "place_light", "type": "RectLight", "temperature": 3800 } }
```

A human approves it. **Nothing runs** — Vellum has no idea how to talk to your
tool and does not try. What you get is the part that was missing: a durable,
at-most-once record that a named person authorized this exact action at this
time, sitting in the same review queue as your spend proposals.

Then the agent acts, and registers whatever came out:

```jsonc
{ "tool": "generation", "action": "register",
  "shot_id": "shot_…", "provider": "unreal-mcp",
  "outputs": [{ "url": "https://…/sh010_relit.png" }] }
```

**Pair it with a clean tree.** The strongest version of this pattern is: commit
before the agent acts, let it act, review the diff, then keep or discard. The
proposal record says who authorized what; the VCS diff says what actually
changed. Neither substitutes for the other.

---

## 4. Compile, then execute

Do not ask one agent pass to both interpret human intent and act on it. Split
it:

**Pass 1 — compile.** Turn what a person said into something unambiguous.
Numbers instead of adjectives, ranges instead of vibes, explicit units,
relationships instead of absolutes. The output is a spec revision (pattern 1).

**Pass 2 — execute.** A separate agent, loaded with that spec, does the work.

The reason to split is that the two passes fail differently. Compilation fails
by being vague, and a human reviewing the spec catches it. Execution fails by
being wrong, and a human reviewing the *output* catches it. Fused into one pass,
a vague interpretation and a wrong result are indistinguishable — you cannot
tell whether the agent misunderstood the brief or misapplied it.

Some rules for the compile pass that are worth stealing wholesale:

- **Convert every subjective quality to a number or a range.** "Moody" is not
  actionable. "40–50° off camera axis, 4:1 key-to-fill, 3800K" is.
- **State units.** `100x100` is a bug waiting to happen; `100×100 cm` is not.
  Unstated units are exactly the ambiguity the exercise exists to remove.
- **Anchor to ratios, not absolutes** — but then **pin the anchor**. Relative
  values only transfer between contexts if the thing they are relative to is
  fixed. A ratio-based spec with a floating exposure reference silently fails to
  be portable, which is worse than not being portable at all.
- **Say what must never happen.** A prohibitions list ("no source above 5600K in
  this sequence") is more useful to an agent than another paragraph of
  description.
- **Instruct the compiler to ask rather than invent.** Missing information
  should surface as a question, not a plausible default.

---

## Putting it together

A production loop that uses all four:

1. `project set_spec` — compile the brief into a versioned spec (1, 4).
2. Agent reads `vellum://project/{id}/spec` before acting (2).
3. For a paid generation: `generation propose` → human approves → executes once.
   For an irreversible external action: `propose kind=external` → human
   authorizes → the agent acts (3).
4. Output lands via `submit` or `register`. Vellum stamps the spec revision onto
   the version automatically.
5. Something comes out wrong. Check `version provenance` for the revision it was
   made under. If the spec was ambiguous, `set_spec` a new revision — earlier
   takes stay dated to the revision they were actually made under (1).

Step 5 is the one that compounds.
