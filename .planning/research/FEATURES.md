# Feature Research — v1.3 Production Shot Grid

**Domain:** VFX production management — shot-status workflow, shot grid UI, review/approval surface, production statistics, AI summary evolution, hover-to-scrub
**Milestone:** v1.3 — Production Shot Grid
**Researched:** 2026-05-11
**Confidence:** HIGH for status workflow conventions and shot grid layout (well-documented in ShotGrid/Kitsu/ftrack). MEDIUM for hover-to-scrub implementation (technical pattern is clear; sprite-sheet generation details need validation against existing thumbnail cache architecture). MEDIUM for AI summary scope evolution (no established VFX-domain precedent; grounded in general LLM UX research).

---

## Executive Summary

v1.3 builds a production-management layer on top of the v1.2 visual dashboard. The six feature areas divide into two classes:

**Production-structure features** (shot status workflow, shot grid, review surface, sequence stats): These have established conventions across ShotGrid/ftrack/Kitsu that have converged over ~15 years. The research reveals a canonical five-state machine (WIP → Pending Review → Approved / Retake / On Hold), a shot card with ~6 fields per shot (thumbnail, code, status badge, version count, last-updated, assignee-optional), and a review pattern where "inline approval" is the right call for a solo/small-team tool, while "full review panel" is the studio-at-scale convention.

**UX-polish features** (hover-to-scrub, SSE streaming, sort persistence, narrative coherence): These are well-understood as patterns (sprite-sheet hover scrub is the industry approach; SSE token streaming is proven) but have non-trivial implementation cost. The research confirms they are differentiators, not table stakes, for a solo artist tool. Ship sprite-sheet scrub over raw-video scrub. Ship SSE streaming on the Regenerate path only, not the initial cache-hit read path.

**Key callout for v1.3 scoping:** ShotGrid's full production status machine has 20+ states. For VFX Familiar's solo-artist / small-team audience, four states are sufficient: WIP, Pending Review, Approved, On Hold. Adding "Client Approved" and "Tech Check" states is a studio-at-scale concern that actively hurts usability for a solo artist.

---

## 1. Shot Grid Visual Conventions

### What professionals see per shot card

Across ShotGrid (Flow Production Tracking), ftrack, and Kitsu, shot cards in a grid view converge on the same ~6 fields:

| Field | Priority | Notes |
|-------|----------|-------|
| Thumbnail (latest completed version) | Required | Frame.io convention: highest-numbered version's poster frame on the stack card. Falls back to skeleton when in-progress or no renders. |
| Shot code / name | Required | Zero-padded, underscore-separated (e.g. `SQ010_SH030`). Frozen first column in table view; overlaid as label in grid view. |
| Status badge | Required | Color-coded pill. ShotGrid uses abbreviated codes: `wip`, `rev`, `apr`, `hld`, `rdy`. |
| Version count | High value | "v003" or "3 versions" — tells supervisor how many iterations without opening the shot. |
| Last updated | High value | Relative timestamp ("2h ago", "yesterday"). Coordinators scan this to find stale shots. |
| Assignee (avatar / initials) | Studio-at-scale required; solo-artist optional | Irrelevant when there is only one artist. Surface only when assignee data exists. |
| Flags / alerts | Nice to have | Red flag for "client declined", yellow for "on hold". ftrack uses these to surface shots needing attention. |

Fields that appear in studio tools but are anti-features for VFX Familiar v1.3:
- Cut in / cut out frame range (editorial dependency; not applicable to AI-generated shots)
- Bid days vs. actual days (financial planning; out of scope)
- Sequence-level episode data (TV show structure; more complex than needed for a solo project)

### Layout that works at different shot counts

| Shot count | Recommended layout | Pagination approach |
|------------|-------------------|---------------------|
| 10–50 shots | CSS Grid, 3–4 columns, 240×135 card thumbnails; no virtual scroll needed | Simple "load all" — no DOM overhead for < 50 cards |
| 50–200 shots | CSS Grid, 3–5 columns; add filter bar (status filter, sequence filter) | Cursor-based pagination (already built in v1.2); page size 20–40 cards. Simple pagination outperforms virtual scroll at this count: at < 100 items, virtual scroll is overhead without measurable gain. |
| 200+ shots | Switch to table/list layout as primary with optional grid; add virtual scrolling | TanStack Virtual works via `preact/compat` alias. Grid virtual scroll is harder than list virtual scroll — default to list view at > 200. |

**Layout recommendation for v1.3:** CSS Grid with `minmax(220px, 1fr)` columns (auto-fill), explicit 16:9 aspect-ratio containers, lazy-load thumbnails. Toggle between grid view (visual) and table/list view (data-dense). Default: grid view. At > 200 shots, recommend switching default to table view with virtual scroll.

**Grouping by sequence:** At > 50 shots, grouping by sequence is essential. Kitsu shows sequences as collapsible sections with a sequence-level status rollup. ShotGrid uses a spreadsheet with group-by on sequence field. For v1.3: group shots by sequence in the grid, with a collapsible section header showing sequence name + aggregate status counts.

### Table stakes vs. v1.3 must-have vs. v1.4+

| Feature | Classification | Reason |
|---------|---------------|--------|
| Thumbnail per shot card | Table stakes | Without this, it is not a shot grid |
| Status badge (color + label) | Table stakes | Core purpose of a shot grid |
| Shot code / name | Table stakes | Identification |
| Version count indicator | v1.3 must-have | High-value, low-cost; tells supervisor at a glance |
| Last-updated timestamp | v1.3 must-have | Coordinators live by this |
| Group-by sequence header | v1.3 must-have | Essential past 30 shots |
| Status filter bar | v1.3 must-have | Critical for "show me all WIP shots" |
| Assignee avatar | v1.4+ | Not needed until multi-user auth ships |
| Drag-to-reorder shots | Anti-feature | Studio-grade; VFX Familiar is not a scheduling tool |
| Gantt timeline view | Anti-feature | Out of scope; scheduling tool territory |

### Solo artist vs. studio team differences

**Solo artist needs:** Minimal fields. No assignee. No bid days. No client approval layer. Status is for self-tracking ("have I reviewed this yet?") and for the AI familiar to understand what's actionable.

**Small team (2–5 artists) needs:** Adds assignee initials and "who submitted this version?" on the card. No financial tracking. Single-stage review (supervisor approves; no client portal).

**50-artist studio needs:** Full 20-state status machine. Client portal with separate login. Bid vs. actual tracking. Department-level status (comp status, lighting status, etc.). None of this is in scope for v1.3 or VFX Familiar's audience.

---

## 2. Status Workflow Conventions

### The canonical VFX state machine (industry-wide)

Research across ShotGrid, ftrack, Kitsu, and the CAVE Academy production guide reveals a convergent state machine. All tools use different labels but map to the same system states:

**System states (universal):**
- Not Started (ready to work)
- In Progress (artist working)
- Submitted for Review (artist done, supervisor looking)
- Approved (supervisor done, locked)
- Blocked (external dependency, on hold)

**ShotGrid's abbreviated codes** (the industry-standard shorthand):
- `wtg` — Waiting to Start
- `rdy` — Ready to Start
- `ip` — In Progress (WIP)
- `rev` — In Review / Pending Review
- `apr` — Approved
- `hld` — On Hold
- `rtk` — Retake (declined, back to artist)
- `cncl` — Cancelled / Omitted

Full studio pipelines extend this to 20+ states including Tech Checks and Client Approval layers. For VFX Familiar v1.3, the relevant subset is:

**Recommended v1.3 state set (4 states + 1 terminal):**
```
WIP → Pending Review → Approved
                     → Retake/WIP (declined returns to WIP)
         WIP ← On Hold → WIP (unblocked)
```

| Status | Display Label | Color | Trigger | Who Changes It |
|--------|--------------|-------|---------|----------------|
| `wip` | WIP | Amber/Yellow | Artist starts work OR retake returns | Artist or AI familiar |
| `rev` | Pending Review | Blue/Purple | Artist submits for review (version created) | Artist submitting |
| `apr` | Approved | Green | Supervisor/artist approves | Reviewer |
| `hld` | On Hold | Grey | Work paused (external dependency, feedback needed) | Any role |

**Collapsed-state approach for solo artist:** Because VFX Familiar's persona is a solo artist using an AI familiar, "Pending Review" means "the artist has reviewed their own work and is happy with it" OR "ready for a collaborator/director to look at." Retake is simply returning to WIP with a note. This collapses the supervisor/artist distinction.

### What "Pending Review" means in practice

In ShotGrid/Kitsu, "Pending Review" (WFA — Waiting For Approval in Kitsu) is triggered by the **artist** when they upload a version and consider their work complete for this iteration. It flags the shot for the supervisor's daily review queue. The supervisor then either:
1. Approves → status changes to `apr`
2. Requests retake with note → status changes back to `wip` (Kitsu calls this "Retake")
3. Puts on hold → status changes to `hld`

For VFX Familiar's AI familiar context: the AI familiar can automatically suggest moving to "Pending Review" when a version completes and the generation parameters match the artist's target. The artist confirms.

### What "On Hold" means in practice

"On Hold" in VFX production has a specific meaning distinct from "blocked": it is an **external request** to pause work on a shot (client feedback needed, reference plate not delivered, editorial change pending). It is NOT the same as "blocked by dependency" (which stays in WIP with a note). The distinction matters because On Hold shots are tracked separately in coordinator dashboards.

For v1.3: "On Hold" means "work deliberately paused — do not prioritize for next generation cycle." Useful even in a solo artist context where a shot is waiting for a reference, a direction decision, or a model that isn't available yet.

### Status change triggers (who and what)

| Status Change | Trigger | Notes |
|--------------|---------|-------|
| WIP → Pending Review | Version submitted and artist marks ready | Manual artist action OR AI familiar auto-suggest on generation complete |
| Pending Review → Approved | Reviewer clicks Approve (or leaves approval note) | Requires explicit action; no auto-approve |
| Pending Review → WIP (Retake) | Reviewer declines with note | Note per version is table stakes for tracking why |
| Any → On Hold | Any actor explicitly sets it | Reason/note required |
| On Hold → WIP | Any actor explicitly resumes | Clears on-hold flag |
| Approved → WIP | "Reopen" action (undo approval) | Should require confirmation; uncommon but needed |

### Status conventions that differ between tools

- **Kitsu** calls the review-pending state "WFA" (Waiting For Approval); ShotGrid calls it "rev"; ftrack calls it "in_progress" mapped to its review system state
- **Kitsu** uses "Retake" as a distinct terminal state before returning to WIP; ShotGrid collapses this back to WIP with a note
- **ftrack** maps all statuses to four system states: `not_started`, `in_progress`, `done`, `blocked` — simplest model
- **ShotGrid** is most customizable, allowing studios to add/rename statuses; its defaults are the industry shorthand most VFX artists know

**Recommendation for v1.3:** Use display labels that match industry vocabulary (`WIP`, `Pending Review`, `Approved`, `On Hold`) with ShotGrid-style abbreviation codes internally (`wip`, `rev`, `apr`, `hld`). Avoid Kitsu's "WFA" label (less familiar outside animation) and ftrack's generic system-state labels.

### Table stakes vs. v1.3 must-have vs. v1.4+

| Feature | Classification | Reason |
|---------|---------------|--------|
| 4-state machine (WIP/Rev/Approved/OnHold) | v1.3 must-have | Core of the milestone |
| Color-coded status badge on shot card | v1.3 must-have | Primary visual signal |
| Note per status change (per version) | v1.3 must-have | Table stakes for any review tool; how did this version get approved? |
| Retake flow (decline with note → back to WIP) | v1.3 must-have | Without this, "Pending Review" is pointless |
| Status change history log | v1.3 must-have | Append-only; who changed when and why |
| Client approval layer (separate status + portal) | Anti-feature for v1.3 | Studio-at-scale; VFX Familiar doesn't have multi-tenant auth |
| Tech check status (pipeline compatibility gate) | Anti-feature for v1.3 | Pipeline engineering concern; not applicable to AI generation |
| Automated status transitions (e.g., auto-approve after N days) | Anti-feature | Production tools that do this breed chaos; approval must be deliberate |

---

## 3. Review & Approval UX

### How VFX supervisors actually review shots

The industry review workflow, based on research across ShotGrid, ftrack, Kitsu, Frame.io, and RV:

**Daily review session (synchronized):**
1. Supervisor opens a playlist / daily queue of "Pending Review" shots
2. For each shot: plays the latest version, reads submission note from artist
3. Makes notes (annotated frames, text comment)
4. Approves OR declines with note, changing shot status
5. Artists see updated status + notes in their queue

**Async review (increasingly common post-2020):**
1. Artist uploads version, marks as Pending Review
2. Supervisor reviews in own time (Frame.io, Kitsu), annotates with timestamped notes
3. Status update notifies artist

The shift to async has been significant. Frame.io V4 is optimized for async. For VFX Familiar, async is the right model — the "supervisor" and "artist" may be the same person with different hats, or a small team reviewing each other's work.

### Inline approval vs. review panel

**Inline approval (one-click from the grid):** Appropriate when:
- The supervisor already knows the shot well
- The thumbnail tells the story (e.g., a color-grade iteration)
- Speed of review matters more than depth

Frame.io uses inline approval (single click) for Review Links. Kitsu supports inline status change with optional comment. Sohonet's Storylink emphasizes one-click approval for speed.

**Full review panel:** Appropriate when:
- Supervisor needs to see the version in detail (full-screen playback)
- A/B comparison against previous version is needed
- Frame-level annotation is required
- Notes must be written before status changes

**Recommendation for v1.3:** Both, in sequence. Shot grid provides inline status-change buttons (approve / request retake / hold) for quick decisions. Clicking the shot card opens a review panel (VersionDrawer or dedicated ReviewPanel) for detailed review, version history, note timeline, and A/B compare. This matches Frame.io's pattern: grid = triage; player = deep review.

**Key UX rule:** Approval from the grid (inline) should require a single confirmation to prevent accidental status changes. The grid approve button triggers a small confirmation popover ("Approve v003?") before committing.

### A/B version comparison

In professional tools, A/B comparison takes two forms:

**Wipe / overlay mode (RV's primary mode):**
- Two versions stacked; user drags a wipe line to reveal version A under version B
- Best for pixel-level comparison (subtle color, lighting, motion differences)
- RV is the industry-standard tool for this
- Frame.io V4 Comparison Viewer uses wipe + side-by-side

**Side-by-side mode:**
- Two versions displayed simultaneously
- Best for gross composition differences ("dragon close-up vs. wide shot")

**Practical implication for v1.3:** For AI-generated stills (VFX Familiar's primary output type), A/B comparison is valuable but the implementation can be lightweight. A two-panel "Compare" view that shows version A and version B side by side with metadata is sufficient. Wipe/overlay is aspirational but complex to implement for general images (video wipe is even harder).

**v1.3 minimum viable A/B:** Select two versions from the version list → open a split-screen comparison with thumbnails/full images side by side + metadata diff (model, seed, prompt delta, parameters). No interactive wipe needed in v1.3.

**What the reviewer actually compares:** Model name, LoRA, seed, sampler parameters, prompt delta. These are already in the provenance graph. Surface the structured diff alongside the visual comparison — this is VFX Familiar's differentiator over pure visual-review tools.

### Notes per version

Every professional VFX tool treats notes as version-attached, append-only records:
- A note is attached to a specific version, not just a shot
- Notes have a timestamp and (in multi-user tools) an author
- Status changes are logged alongside notes ("approved by [user] with note: looks great")

For v1.3: notes are per-version, append-only (consistent with provenance architecture). A note submitted with a status change is recorded as a provenance event. Notes without status changes are also valid (annotation / feedback during ongoing WIP).

### Table stakes vs. v1.3 must-have vs. v1.4+

| Feature | Classification | Reason |
|---------|---------------|--------|
| Review panel (VersionDrawer with status actions) | v1.3 must-have | Core of the milestone |
| Inline quick-approve from grid (with confirmation) | v1.3 must-have | Speed of review for experienced supervisors |
| Notes per version (append-only, timestamped) | v1.3 must-have | Table stakes for any review tool |
| Two-panel side-by-side comparison | v1.3 must-have | High value, moderate implementation cost |
| Approval confirmation popover (prevent accidental) | v1.3 must-have | UX guard rail |
| Frame-level annotation (draw on image) | v1.4+ | Kitsu/Frame.io feature; complex; not needed for AI-gen workflow |
| Interactive wipe comparison | v1.4+ | High complexity; side-by-side covers 90% of the value |
| Client review portal (separate login) | Anti-feature | Requires auth system that doesn't exist |
| Real-time sync review (cineSync-style) | Anti-feature | Overkill for solo/small-team scope |

---

## 4. Production Stats / Reporting

### What coordinators actually track

Based on Kitsu's production report, ftrack's dashboard, and ShotGrid's reporting, production coordinators track:

**Sequence-level stats (most important at daily standup):**
- % shots approved in this sequence
- % shots in Pending Review (backlog)
- % shots WIP (in flight)
- % shots On Hold (blocked)
- Retake rate per sequence (how many shots needed more than N versions)
- Average versions per shot (quality signal — high = struggling, low = fast)

**Project-level stats (weekly/milestone level):**
- Overall % approved (the headline number)
- Shots remaining (approved vs. total)
- Shots by status (pie chart or horizontal bar)
- Retake trends over time (are we getting better or worse?)
- Days-to-lock estimate (rough: remaining shots / approval rate)

**Kitsu's sequence stats approach:**
- Pie charts per sequence, color-coded by status
- Retake column (red dots per episode/sequence)
- Count + percentage per status
- Estimation vs. actual (person days)

**Notably absent from all tools:** "Days to lock" as an automated calculation. Coordinators derive this manually or in spreadsheets from approval rate + remaining count. This is a gap VFX Familiar could fill.

### Right granularity: widget vs. detailed view

**Dashboard widget (always visible, at-a-glance):**
- Single headline number: "47% approved" or "12/25 shots done"
- Status bar or donut chart (color-coded: green/blue/amber/grey)
- Delta from last session: "↑ 3 shots approved today"

**Detailed view (on-demand, sequence drill-down):**
- Table with sequence rows, each showing shot counts by status
- Retake rate column
- Version count per shot
- Average versions per shot (quality metric)
- Days since last activity per shot (stale shots flag)

**What solo artists need vs. studio teams:**
- Solo artist: headline number + "which shots need my attention?" sorted list
- Small team: sequence-level breakdown + assignee workload
- Studio: full Gantt + financial tracking + client approval percentage

**For v1.3:** Dashboard widget (headline % approved + status breakdown) + sequence-level detail table. No Gantt. No financial tracking. The "which shots need attention" list is more valuable than charts.

### Specific metrics to surface

| Metric | Value | Implementation |
|--------|-------|----------------|
| Total shots + % approved | High | COUNT(*) + COUNT(status='apr') / total |
| Shots by status (counts) | High | GROUP BY status |
| Shots pending review count | High | "Your review backlog" — actionable |
| Average versions per shot | Medium | AVG(version_count) per shot |
| Shots with no activity in > N days | Medium | Stale shot detection |
| Retake rate (shots that went WIP→rev→wip at least once) | Medium | Event log analysis |
| Days-to-lock estimate | Nice to have | (remaining * avg_days_per_approval) — rough but useful |

### Table stakes vs. v1.3 must-have vs. v1.4+

| Feature | Classification | Reason |
|---------|---------------|--------|
| Sequence-level % approved | v1.3 must-have | Core production stat |
| Status breakdown (counts by status) | v1.3 must-have | Table stakes for any production tool |
| Shots pending review count ("your backlog") | v1.3 must-have | Actionable number |
| Stale shot detection (no activity > N days) | v1.3 must-have | High value, simple query |
| Average versions per shot | v1.3 nice-to-have | Quality signal; simple to compute |
| Retake rate | v1.4+ | Requires event log analysis; lower priority |
| Days-to-lock estimate | v1.4+ | Useful but rough; requires calibration |
| Financial / bid tracking | Anti-feature | Out of scope permanently |
| Gantt chart | Anti-feature | Out of scope permanently |
| Artist workload breakdown | v1.4+ | Only relevant with multi-user auth |

---

## 5. AI Summary Context Evolution

### v1.2 baseline

v1.2 ships per-version, single-call summaries: "v003 is a tighter close-up of the dragon's eye, generated with Flux + cinematic_fantasy LoRA at seed 42." The summary is grounded in one version's provenance blob.

### What should evolve in v1.3

Three expansion directions, each independently valuable:

**Direction A: Shot-level version history summary**
- "This shot has 5 versions. v001–v002 explored wide-angle compositions; v003–v004 narrowed to close-up; v005 is the approved final."
- Grounding: all 5 versions' provenance blobs + status change events
- Value for: coordinator overview, "what happened in this shot" at a glance
- Implementation: multi-version prompt with provenance chain summary, not individual per-version calls
- Risk: longer context = higher cost and more hallucination surface. Mitigate: structured JSON input, not raw text.

**Direction B: Sequence progress narrative**
- "SQ010 has 8 of 12 shots approved. The dragon close-up series (SH020–SH040) is complete. SH050 and SH060 are pending review. SH070–SH080 are on hold pending the HDRI update."
- Grounding: sequence shot statuses + version counts + status change events
- Value for: daily standup / coordinator report; supervisor "where are we?" question
- Implementation: structured data input (no provenance blobs; just status table), short 4-6 sentence summary
- Risk: low (highly structured input; little hallucination opportunity)

**Direction C: Cross-version comparison summary (A/B review)**
- "v003 vs. v005: The main difference is the LoRA strength (0.6 → 0.8) and a seed change (42 → 17). v005 shows tighter scale detail and warmer highlights. v003 remains the approved version."
- Grounding: diff between two versions' provenance blobs
- Value for: during a review session, "summarize what changed"
- Implementation: diff two provenance records, generate 2-3 sentence comparison
- Risk: low (structured input); medium implementation complexity (diff formatting)

### What VFX leads actually want to know

Based on domain research and the v1.2 brief:

1. **"What changed from the last version?"** — always the first question at dailies
2. **"Why did the supervisor decline this?"** — status change note + version history
3. **"Where is this shot in the approval chain?"** — status + version count + days since last activity
4. **"Is this shot going in the right direction?"** — version history narrative (Direction A)
5. **"How is this sequence tracking?"** — sequence progress narrative (Direction B)

The v1.2 summary answers (1) partially (via parent diff) and implicitly answers (4) for the current version. v1.3 should explicitly address (2) via notes surfacing in the review panel, and should add (3) and (5) as new summary scopes.

### v1.3 recommendation: phased AI scope

**v1.3 must-have:** SSE streaming on the per-version summary (already deferred from v1.2; directly addresses "AI summary UX polish"). Users perceived streaming responses as 40–60% faster than equivalent non-streaming responses, even at identical total latency.

**v1.3 must-have:** Cross-version comparison summary (Direction C) — activates when user opens A/B compare panel. Low risk, high value at review time, structured input.

**v1.3 nice-to-have:** Shot-level version history summary (Direction A) — "summarize this shot's history" button in the review panel. Medium complexity.

**v1.4+:** Sequence progress narrative (Direction B) — higher complexity multi-shot context; defer until Direction A is validated.

**Anti-features for AI summary evolution:**
- Cross-shot comparison ("how does SH020 compare to SH030?") — hallucination risk increases dramatically when comparing shots with different content
- Automatic summary of the whole project — token cost and hallucination risk too high
- User-editable summaries — breaks append-only provenance contract
- Vision-model "describe the image" additions — still the primary anti-feature from v1.2

### SSE streaming specifics

Research confirms SSE is the right transport for streaming AI token output (simpler than WebSockets for one-way server→client; browser-native EventSource; already used in v1.2 architecture). Studies show:
- Users perceive streaming responses as 40–60% faster at identical total latency
- TTFT (time to first token) < 800ms is the perceived-instant threshold
- Streaming engagement drops off quickly if TTFT > 2s

**Implementation guidance:** Stream on the Regenerate path (active user intent, user is waiting). Do NOT stream on the initial cache-hit read path (cache hit should be instant; streaming a cached result adds artificial delay with no benefit). The Anthropic SDK supports streaming via `.stream()` and EventSource-compatible response format.

**v1.3 SSE scope:** Stream the per-version summary Regenerate call only. The initial read from cache renders instantly from DB without streaming. Extend to shot-history summary if Direction A ships in v1.3.

### Table stakes vs. v1.3 must-have vs. v1.4+

| Feature | Classification | Reason |
|---------|---------------|--------|
| SSE streaming for Regenerate path | v1.3 must-have | Deferred from v1.2; UX polish bundle; perceived 40-60% speed gain |
| Cross-version comparison summary (v1.3 A/B) | v1.3 must-have | High value at review time; structured input, low hallucination risk |
| Shot-level version history narrative | v1.3 nice-to-have | Activates when reviewing a shot with > 3 versions |
| Cross-version narrative coherence (summaries reference each other) | v1.3 nice-to-have | Deferred from v1.2; achievable via parent diff in prompt |
| Sequence progress narrative | v1.4+ | Multi-shot context; token cost; defer after Direction A validated |
| Vision-model image description | Anti-feature permanent | Hallucination source; provenance is ground truth |
| User-editable summaries | Anti-feature permanent | Breaks append-only contract |

---

## 6. Hover-to-Scrub

### How Frame.io and professional tools implement it

Frame.io V4 uses frame-accurate hover scrub with what the engineering team describes as "two-tiered data loading." The thumbnail grid loads sprite-sheet previews; the player loads the full video. The user experience from the grid is: hover → sprite-sheet scrub (instant, no buffering); click → full player loads.

**Sprite-sheet approach (industry standard for web hover-scrub):**

A sprite sheet is a single image containing a grid of extracted frames. The browser loads one image; JavaScript/CSS shifts `background-position` to show the correct frame on hover. No video buffering required.

FFmpeg generates the sprite sheet server-side:
```bash
# Extract 1 frame per 2 seconds, 160×90, 5-column grid
ffmpeg -i input.mp4 -vf "fps=1/2,scale=160:90,tile=5x4" spritesheet.jpg
```

Frontend CSS technique:
```
background-image: url(spritesheet.jpg);
background-position: -Xpx -Ypx; /* shifted based on hover position */
background-size: total_sheet_width total_sheet_height;
```

Performance: Sprite sheets load as a single HTTP request. Subsequent frame-shifts are pure CSS/JS with no network requests. 3–4x faster than seeking in a loaded video.

**Direct video scrub approach (DaVinci Resolve / Premiere pattern):**
- HTML5 `<video>` element, `preload="metadata"`, `muted`
- On `mouseenter`: `video.play()`
- On `mousemove`: update `video.currentTime = (xPos / cardWidth) * video.duration`
- Requires video to be loaded (at least metadata); choppy without dense keyframes

**Keyframe density is critical for video scrub:** A video with keyframes every 100 frames is 20x choppier than one with keyframes every 5 frames during scrubbing. Re-encoding with `-x264-params keyint=10:scenecut=0` produces smoother scrub at a 5x file size increase.

**For VFX Familiar:** Sprite-sheet approach is correct. It builds on the existing thumbnail infrastructure (FFmpeg already ships for MP4 first-frame extraction in v1.2). Server generates the sprite sheet at version completion; serves via the existing thumbnail cache route; client-side is a CSS `background-position` shift.

### Typical VFX shot duration

- **Industry average:** 5–8 seconds per VFX shot (film/TV)
- **Range:** 2–30 seconds for most shots; exceptions go to several minutes
- **Frame counts:** 100–500 frames is the typical range at 24fps; 500+ frames is considered long
- **AI-generated content (VFX Familiar context):** likely shorter — ComfyUI video outputs typically run 2–15 seconds

**Sprite sheet sizing for a 5–15 second shot:**
- At 1 frame per 0.5 seconds: 10–30 frames → sprite sheet of 10–30 tiles
- At 160×90 per frame, 5 columns: 2–6 rows → sprite sheet 800px wide × 90–540px tall
- Total sprite sheet size: ~100–300KB for JPEG (acceptable for a hover preview)

### Minimum viable vs. full experience

| Tier | Description | Implementation |
|------|-------------|----------------|
| **Minimum viable** | Single static sprite sheet per video, 1 frame/2sec, CSS position shift on hover | FFmpeg tile filter on completion; one route serving sprite sheet; JS `mousemove` handler updating `background-position` |
| **Standard** | Per-frame timestamp metadata (WebVTT or JSON), smooth interpolation between tiles, loading state | Sprite sheet + JSON metadata file; client maps hover X position to timestamp → tile offset |
| **Full experience** | Variable density (more frames for short clips), lazy sprite-sheet load, touch support (scrub on touchmove) | Adaptive sampling; IntersectionObserver-gated prefetch; touch event handling |

**v1.3 target:** Standard tier. Generate sprite sheets server-side at video completion (extends existing FFmpeg infrastructure). Serve via thumbnail cache route. Implement client-side `mousemove` → `background-position` with JSON timestamp metadata.

**Image stills (non-video):** Hover-to-scrub is not applicable. Instead: hover-to-zoom (CSS `transform: scale(1.05) translateY(-2px)`) already deferred from v1.2. Ship this for stills, sprite-sheet scrub for videos.

### Solo artist vs. studio team difference

Solo artists generate primarily image stills with occasional video outputs. Hover-to-scrub is most valuable when reviewing many video outputs in a grid session — more applicable to a studio team doing animation/compositing review than a solo generative artist. However, as ComfyUI video workflows mature, video outputs will become more common.

**Conclusion:** Implement sprite-sheet scrub for videos (it will become increasingly important) but accept that for most v1.3 use cases, the value is moderate vs. the thumbnail-only experience.

### Table stakes vs. v1.3 must-have vs. v1.4+

| Feature | Classification | Reason |
|---------|---------------|--------|
| Hover-to-zoom for image stills (CSS transform) | v1.3 must-have | Deferred from v1.2; low implementation cost |
| Sprite-sheet hover scrub for video outputs | v1.3 must-have | Deferred from v1.2; core of UX polish bundle |
| Server-side sprite sheet generation on version completion | v1.3 must-have | Required infrastructure for sprite scrub |
| Touch scrubbing on mobile | v1.4+ | Secondary use case; touch-based scrub adds complexity |
| Full video in-grid playback (click-to-play) | v1.3 nice-to-have | `<video>` with muted autoplay on hover as fallback for sprite failures |
| Interactive wipe comparison with video | Anti-feature v1.3 | Very high complexity; not justified for AI-gen workflow |

---

## 7. Sort Persistence (Cross-Session)

### What v1.2 shipped vs. what was deferred

v1.2 shipped global localStorage sort persistence (one sort preference per list type). v1.3 carries forward **per-shot sort persistence** — different shots may want different sort defaults (a shot with 20+ versions benefits from "latest first"; a shot with 3 versions doesn't need sort at all).

**Current v1.2 localStorage key scheme:**
```
vfx-familiar:sort:versions    // global version grid sort
vfx-familiar:sort:tree        // tree sidebar sort
```

**v1.3 per-shot extension:**
```
vfx-familiar:sort:versions:<shotId>   // per-shot override
```

Falls back to global `vfx-familiar:sort:versions` if no per-shot preference exists. LRU eviction at quota (already built in v1.2).

### When per-shot sort matters

Per-shot sort is most valuable when:
- A shot has many versions (> 10) and the artist knows their work patterns (e.g., "I always look at the most recent")
- Different shots use different version naming conventions (some by date, some by iteration)
- The artist wants to compare specific version ranges without changing the global default

For solo artists with < 10 versions per shot, this is a "nice to have" — the global default is usually fine.

**v1.3 recommendation:** Implement per-shot sort override in localStorage with the key scheme above. This is a small incremental extension of the v1.2 sort infrastructure — likely a 1–2 plan addition rather than a full phase.

---

## Feature Dependencies (v1.3 build order signal)

```
v1.2 base (DONE):
   ├── Thumbnail cache (FFmpeg + sharp)
   ├── Sort infrastructure (cursor-based pagination)
   └── AI summary (Anthropic SDK, SSE bus, circuit breaker)

v1.3 Phase ordering logic:

Phase A — Shot Status Engine + Grid View
   Requires: v1.2 base
   Blocks: Phase B (review surface needs status to exist)
   Content: status state machine, DB schema, HTTP routes, grid view + status badges, sequence grouping

Phase B — Review & Approval Surface
   Requires: Phase A (status transitions need status engine)
   Blocks: Phase C (stats need status changes to exist)
   Content: review panel, inline approve, notes per version, A/B compare

Phase C — Production Stats
   Requires: Phase A + Phase B (stats aggregate status data)
   Content: sequence-level stats widget, stale shot detection, status breakdown

Phase D — UX Polish Bundle
   Requires: Phase A (needs shots to scrub)
   Parallel with Phase B/C (no file overlap)
   Content: hover-to-scrub (sprite sheet), SSE streaming AI, per-shot sort persistence, cross-version comparison summary

Phase E — AI Summary Evolution
   Requires: Phase A + Phase B (comparison summary needs review context)
   Parallel with Phase C/D (no file overlap if structured carefully)
   Content: SSE streaming Regenerate, cross-version comparison summary, shot-history narrative
```

**Recommended ordering:** A → B → C → D+E (parallel).

---

## Anti-Features (deliberately out of scope for v1.3)

| Anti-Feature | Reason |
|-------------|--------|
| Client approval portal (separate login) | Requires auth system; out of VFX Familiar scope |
| Tech check status layer | Pipeline engineering; not applicable to AI generation |
| 20-state status machine (full ShotGrid model) | Over-engineered for solo/small team; 4 states are sufficient |
| Gantt / scheduling view | Scheduling tool; out of scope |
| Financial tracking (bid vs. actual) | Out of scope permanently |
| Frame-level annotation (draw on image) | Complex; Frame.io differentiator; not needed for AI-gen workflow |
| Real-time sync review (cineSync-style) | Requires WebSocket complexity; single-user scope |
| Vision-model image description in summaries | Permanent anti-feature; hallucination source |
| Automated approval (auto-approve after N versions) | Dangerous in any pipeline |
| Cross-shot AI comparison ("how does SH020 compare to SH030?") | High hallucination risk; defer until provenance-grounded approach validated |

---

## Summary Table: v1.3 Must-Haves vs. Nice-to-Haves vs. v1.4+

### Must-Haves (core milestone promise)

| Feature | Phase |
|---------|-------|
| 4-state shot status engine (WIP/Rev/Approved/OnHold) | A |
| Status badges on shot grid cards | A |
| Status change with note (per version) | A |
| Shot grid grouped by sequence | A |
| Status filter bar on grid | A |
| Review panel with approve/retake/hold actions | B |
| Inline quick-approve from grid (with confirmation popover) | B |
| Notes per version (append-only) | B |
| Two-panel A/B comparison view | B |
| Sequence-level % approved widget | C |
| Status breakdown by count | C |
| Pending review backlog count | C |
| Stale shot detection | C |
| Hover-to-zoom for image stills (CSS) | D |
| Sprite-sheet hover scrub for video | D |
| SSE streaming on AI summary Regenerate path | E |
| Cross-version comparison summary (A/B panel) | E |
| Per-shot sort persistence | D |

### Nice-to-Haves (ship if time permits)

| Feature | Notes |
|---------|-------|
| Shot-level version history narrative | Direction A AI; moderate complexity |
| Cross-version narrative coherence (lineage-aware summaries) | Deferred from v1.2 |
| Grid ↔ table view toggle | Useful at > 50 shots |
| Average versions per shot stat | Simple query; low value to implement |
| Click-to-play video in grid (fallback to sprite scrub) | `<video>` muted hover play |

### v1.4+ (explicitly deferred)

| Feature | Reason for deferral |
|---------|---------------------|
| Retake rate trend over time | Requires event log analysis; lower priority |
| Days-to-lock estimate | Rough without calibration; needs approval rate history |
| Sequence progress narrative (AI) | Multi-shot token cost; validate Direction A first |
| Artist workload breakdown | Needs multi-user auth |
| Touch scrubbing | Secondary use case |
| Assignee avatar on shot card | Needs multi-user auth |
| Custom status states (studio-configurable) | Scope creep; 4 states cover VFX Familiar's audience |

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|------------|-------|
| Status workflow conventions | HIGH | Verified across ShotGrid, Kitsu, ftrack official docs and community resources. Industry convergence is clear. |
| Shot grid layout per-card info | HIGH | Well-documented in multiple sources; strong industry consensus. |
| Review & approval UX | HIGH | Frame.io, Kitsu, RV all document their review workflow. |
| Production stats metrics | MEDIUM | Kitsu docs are thorough; ftrack docs partially inaccessible. Metrics listed are cross-validated across two sources. |
| AI summary evolution | MEDIUM | General LLM UX research is solid; VFX-specific precedent for multi-version summaries is sparse. Recommendations are grounded in general best practices + VFX domain logic. |
| Hover-to-scrub implementation | MEDIUM | Sprite-sheet approach is well-documented technically. Integration with existing FFmpeg thumbnail cache needs implementation-time validation. |
| Virtual scroll threshold (< 100 items = no virtual scroll needed) | HIGH | Multiple React/Preact performance guides agree; the 50–100 item threshold is consistent. |
| TanStack Virtual Preact compatibility | MEDIUM | Works via `preact/compat` alias; not officially supported but confirmed pattern via TanStack Query + Preact example. |
| SSE streaming perceived speed improvement | MEDIUM | 40–60% figure from UX research; not VFX-domain-specific but strongly applicable. |

---

## Sources

- [CAVE Academy — Production Statuses](https://caveacademy.com/wiki/production/production-statuses/) — comprehensive 20-state VFX production status machine with transitions
- [Kitsu — Status, Publish and Review](https://kitsu.cg-wire.com/status-publish-review/) — WFA/WIP/Approved/Retake Kitsu state model
- [Kitsu — Building Production Reports](https://kitsu.cg-wire.com/production-report/) — sequence stats, pie charts, retake tracking, time metrics
- [Kitsu — Short Production (shots-only)](https://kitsu.cg-wire.com/short-shot/) — shot view layout, columns, status display
- [ShotGrid Community — Latest version status on Shots page](https://community.shotgridsoftware.com/t/can-i-display-the-status-of-the-latest-version-for-each-shot-on-my-shots-page/8555) — query field approach for version status on shot cards
- [Netflix Partner Help — Navigating Flow Production Tracking](https://partnerhelp.netflixstudios.com/hc/en-us/articles/15978795859475-Navigating-Flow-Production-Tracking-fka-ShotGrid) — Shot status by vendor reporting
- [Frame.io V4 Beta — New Design, Navigation](https://blog.frame.io/2024/05/21/frame-io-v4-web-app-beta-feature-focus-new-design-smooth-navigation/) — hover scrub, card size/aspect ratio customization
- [FastPix — Create Video Previews with Sprite Sheets](https://www.fastpix.io/blog/create-video-previews-with-sprite-sheets-for-streaming) — sprite sheet technical approach, timestamp mapping
- [DEV Community — Hover Previews with Sprite Sheets in Node.js](https://dev.to/speaklouder/how-video-platforms-show-instant-hover-previews-using-sprite-sheets-in-nodejs-2l0l) — FFmpeg tile command, CSS background-position technique, 160×90 tile dimensions
- [Muffinman — Scrubbing Videos with JavaScript](https://muffinman.io/blog/scrubbing-videos-using-javascript/) — keyframe density impact on scrub smoothness; MVE vs. full experience
- [DVXuser Forum — Average VFX Shot Length](https://www.dvxuser.com/threads/average-length-of-an-fx-shot.323036/) — 100–500 frame range; 5–8 second average
- [ftrack — 7 Tips for Managing Large Shot Counts](https://www.ftrack.com/en/2021/05/7-tips-for-managing-large-shot-counts.html) — VFX supervisor recommendations; side-by-side comparison; iteration tracking
- [Silver Monkey Studio — Async Dailies in VFX](https://silvermonkey.studio/async-dailies-in-vfx-moving-reviews-out-of-the-meeting-room/) — async review workflow; supervisor annotation before status change
- [TidyVFX — RV Player Comparing Images](http://tidyvfx.blogspot.com/2013/08/rv-player-comparing-images.html) — wipe/overlay comparison workflow in RV; F6 wipe, stack view, layer order
- [Animost — VFX Shot Tracking Software](https://animost.com/ideas-inspirations/vfx-shot-tracking-software/) — table stakes features; review workflow; DCC integration differentiators
- [Logik Forums — Aquarium discussion](https://forum.logik.tv/t/ftrack-shotgrid-nim-gtfo-aquarium/9994) — solo/small team tool preferences; node-based canvas as differentiator
- [Procedure.tech — SSE Still Wins in 2026](https://procedure.tech/blogs/the-streaming-backbone-of-llms-why-server-sent-events-(sse)-still-wins-in-2025) — SSE vs WebSocket for one-way streaming; perceived speed improvement evidence
- [Medium — How We Used SSE to Stream LLM Responses at Scale](https://medium.com/@daniakabani/how-we-used-sse-to-stream-llm-responses-at-scale-fa0d30a6773f) — SSE reliability patterns; heartbeat; reconnect handling
- [iGnek — Virtual Scrolling vs Pagination in React](https://www.ignek.com/blog/optimizing-large-lists-in-react-virtualization-vs-pagination) — < 50–100 items: pagination preferred; virtual scroll overhead without benefit
- [Bret.io — Simple TanStack Query with Preact](https://bret.io/blog/2026/simple-tanstack-query-in-preact/) — preact/compat alias pattern for TanStack libraries
- [GitHub TanStack/virtual](https://github.com/TanStack/virtual) — framework support list; Preact not officially listed; preact/compat path required
