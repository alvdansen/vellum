---
phase: 21-shot-grid-view
type: deep-audit
sources:
  - codex_challenge (gpt-5.5 adversarial, sandbox=read-only, 44.8K tokens)
  - codex_review (gpt-5.5 diff-vs-base, 10K-line diff scan)
  - architect_agent (Claude opus-4-7, Plan subagent, design-pattern critique)
  - manual_smoke (T02 in browser via gstack browse)
date: 2026-05-13
verdict: BLOCK — 7 bugs (1 BLOCKING race, 4 high, 1 medium, 1 low), architectural refactor recommended before Phases 22-24

convergence:
  all_4_sources_agree:
    - Bug 1 (URL hydration chicken-and-egg)
    - Bug 2 (VersionDrawer scope)
    - "Root pattern: globally-keyed signals authored as view leaves"
  codex_challenge_unique:
    - Bug 3 (BLOCKING Load More cross-sequence race)
    - Bug 6 (initial fetch failure → blank pane)
  codex_review_unique:
    - Bug 7 (aria-current persists after return to home)
  architect_agent_unique:
    - View-independent concerns inventory across both views
    - Forward-looking risk analysis for Phases 22-24
  manual_smoke_unique:
    - Direct WCAG hex audit (all 10 tokens match UI-SPEC)
    - 8/10 D-spec contracts verified visually
---

# Phase 21 Deep Audit

Cross-source audit of Phase 21 (Production Shot Grid) using four independent reviewers: codex challenge mode (GPT-5.5 adversarial), codex review (GPT-5.5 diff scan), Claude Plan architect, and manual browser smoke. The two bugs surfaced in the T02 smoke are symptoms of one root architectural pattern. The other three reviewers independently surfaced 5 additional defects, one BLOCKING (stale Load More appends to wrong sequence).

## TL;DR

**7 bugs, not 2.** All four reviewers independently converge on the same root cause: global state was authored as leaves of view components, then severed by the `{isHome ? <HomeView /> : <ShotGridView />}` mount switch in `App.tsx:105`. Three of the new bugs would survive a naive hoist-and-fix of the two known ones — they need a deeper data-model and lifecycle revision.

Phase 21 should **not** advance to Phase 22 in current state. Two viable paths:

1. **Tactical:** Ship 2 narrow gap-closure plans (URL hydrate hoist + VersionDrawer hoist) to clear the smoke-test gate, then defer the architectural refactor and other 4 bugs to a new gap-closure phase. Risk: those 4 bugs ride along until someone hits them.

2. **Strategic:** Ship a single, larger refactor plan that resolves all 6 bugs via the architectural pattern in §4. Higher upfront cost, but unblocks Phases 22-24 on a sustainable base.

Recommendation: **Strategic.** Phase 22's review-and-approval feature and Phase 23's stats are both global-overlay concerns that will fall into the same trap if we ship the tactical fix.

---

## 1. The Bug Inventory

| # | Severity | Title | File:line | Source |
|---|----------|-------|-----------|--------|
| 1 | high | URL deep-link hydration never runs on App mount (D-09 violation) | `App.tsx:54-69` (missing call); `ShotGridView.tsx:96` (called from wrong scope) | smoke + architect + codex |
| 2 | high | VersionDrawer doesn't render when activeView='shot-grid' (D-19 violation) | `HomeView.tsx:562` (only renderer); `App.tsx:105` (unmounts it) | smoke + architect + codex |
| 3 | **BLOCKING** | Stale Load More appends shots into wrong sequence | `ShotGridView.tsx:136-144` (no sequence-id guard, no alive latch for load-more) | codex |
| 4 | high | Sequence switch shows previous sequence's grid until new fetch resolves | `ShotGridView.tsx:103` (fetch effect doesn't clear `shotGrid.value` before fetching) | codex |
| 5 | high | Drawer data model can't resolve versions from shot-grid clicks | `HomeView.tsx:448-450` (resolves via `versions.value` which only holds home-shot's versions); `ShotGridView.tsx:265` (writes any version id) | codex |
| 6 | medium | Initial shot-grid fetch failure leaves a blank pane | `ShotGridView.tsx:115/242/246` (`shotGrid===null && !gridIsFetching` matches no render branch) | codex_challenge |
| 7 | low | `aria-current="page"` persists on grid icon after returning to home view | `HomeView.tsx:506` (passes `currentGridSequenceId` unconditionally, regardless of `activeView`) | codex_review (i missed this in smoke; treated it as D-05 pass) |

**Why this matters:** Bugs 1+2 alone could be patched in ~30 min. Bugs 3-6 require touching the same files and the same data flow — patching 1+2 first means we'd revisit those files again immediately. Bug 5 in particular means the "simple fix" for Bug 2 (just hoist VersionDrawer) **will not work** — the hoisted drawer would still get `selectedVersion === null` for any shot-grid card click because the version isn't in `versions.value`.

---

## 2. Root Architectural Pattern

All three reviewers independently converged on this diagnosis:

> **Globally-keyed concerns (top-level signals) were authored as leaves of one view, then strangled by a sibling view's mount switch.**

The view toggle at `App.tsx:105` is `{isHome ? <HomeView /> : <ShotGridView />}`. This is "view-component-as-god-object": one binary mount decision conflates two distinct concern lifetimes — view-rendering surfaces (correctly conditional) and view-independent concerns (URL hydration, overlays, selected-version resolution — incorrectly conditional).

The Phase 21 CONTEXT D-22 correctly identifies and avoids this for SSE handlers — `onShotStatusChanged` was lifted out of `ShotGridView` to module scope and subscribed in `App.tsx:61` to survive view changes. But the same diagnosis was **not** applied to:

- `hydrateShotGridUrlState()` — sits in `ShotGridView.tsx:96`
- `<VersionDrawer/>` — sits in `HomeView.tsx:562`
- Selected-version-to-entity resolution — sits in `HomeView.tsx:448-450` reading `versions.value`

D-22's reasoning ("module-scope handler, subscribed in App.tsx so it survives view changes") generalizes to **anything keyed on a module-singleton signal must mount at a scope at least as broad as the signal's writers.** Phase 21 followed this principle for one signal (`shot.status_changed`) and violated it for three others.

---

## 3. View-Independent Concerns Hidden Inside HomeView

Beyond `<VersionDrawer/>` (Bug 2), the architect agent found three more concerns inside HomeView that should be hoisted:

| HomeView contents | Should hoist because | Breaks if it isn't hoisted |
|---|---|---|
| `<VersionDrawer/>` at line 562 | `selectedVersionId` written by both views | Bug 2 (already known) |
| Selected-version resolver at lines 448-450 | `versions.value` only holds home-shot's versions; shot-grid clicks write arbitrary version ids | Bug 5 — drawer can't resolve grid-card versions even after hoist |
| `hydrateSortState()` mount call at lines 180-184 | `gridSort`/`treeSort` are module singletons; deep-link `?treeSort=…` while on shot-grid view is silently ignored | Silent URL state loss — same chicken-and-egg as Bug 1 |
| `fetchWorkspaces()` mount fetch at lines 188-201 | Workspace list will be needed by Phase 22 review-panel breadcrumbs and Phase 24 polish | Wasteful refetch + flicker on every home toggle |

---

## 4. View-Independent Concerns Hidden Inside ShotGridView

| ShotGridView contents | Should hoist because | Breaks if it isn't hoisted |
|---|---|---|
| `hydrateShotGridUrlState()` at line 96 | D-09 contract is "URL > signal on first mount" — that's a *boot* contract, not a *view-mount* contract | Bug 1 (already known) |
| `headerExpanded` local state at line 90 | D-15 says "session-only state (no localStorage)" — currently view-lifetime, resets every remount | UX glitch: collapse header, switch to home, return → header is open again |
| Initial fetch effect at lines 103-124 | Currently view-local but refires on every remount → redundant fetch on home → shot-grid → home → shot-grid round trip | Wasteful refetch + flash of empty state |
| Load More handler at lines 136-144 | No alive latch + no sequence-id guard → late response from seq A can append to seq B | Bug 3 (BLOCKING) |

---

## 5. Composition Pattern Recommendation

Replace the binary ternary at `App.tsx:105` with a layered tree where each layer matches the *lifetime* of its concern:

```
<App>                                ← always mounted
  useEffect(() => {                  ← single boot scope
    hydrateSortState();              ← was in HomeView
    hydrateShotGridUrlState();       ← was in ShotGridView (Bug 1 fix)
    ensureWorkspacesLoaded();        ← was in HomeView
    onSseEvent(...)                  ← already correctly placed
    startSse();
  }, []);

  <Header/>                          ← always mounted
  <AppBody>                          ← routing layer ONLY
    {activeView === 'home'      && <HomeView/>}
    {activeView === 'shot-grid' && <ShotGridView/>}
    /* Phase 22-23 views slot in here */
  </AppBody>
  <ActiveGenerationsPanel/>          ← already correctly hoisted (App.tsx:107)
  <Overlays>                         ← always mounted, reads global signals
    {selectedVersionId.value && <VersionDrawer versionId={selectedVersionId.value} />}
  </Overlays>
</App>
```

**Key changes from current:**

1. **All hydrate calls move to App.tsx's useEffect**, before `startSse()`. Single boot scope. Bug 1 dies here.
2. **`<VersionDrawer/>` mounts as a sibling of `<AppBody>`** at App level, reading `selectedVersionId` directly. Bug 2 dies here.
3. **VersionDrawer accepts `versionId: string` as a prop, not a derived `version` object** — it owns its own fetch-by-id resolver (with a fallback to `versions.value` for the home-fast-path). Bug 5 dies here.
4. **`headerExpanded` becomes a signal** in `state/shot-grid.ts` alongside `activeView`. Survives view remounts.
5. **Load More handler gets an alive latch AND a sequence-id guard** (`if (!alive || seqId !== capturedSeqId) return;` in the `.then()`). Bug 3 dies here.
6. **Initial fetch effect prepends a `shotGrid.value = null` reset before fetching** so the stale render of seq A doesn't bleed into the new seq B fetch. Bug 4 dies here.
7. **Fetch error path sets `shotGrid.value = []` AND `gridLoadMoreError.value`**, and the render switch checks `gridLoadMoreError` before the empty-state branch. Bug 6 dies here.

**Component refactor side-effects:**

- HomeView shrinks to pure body content (tree + version list)
- ShotGridView shrinks to pure body content (filter bar + grid + sequence header)
- VersionDrawer becomes a self-resolving component that takes only a versionId
- App.tsx grows by ~15 lines (the boot useEffect and the Overlays slot)

---

## 6. Test Coverage Gap

All three reviewers agree: the test suite is **boundary-blind**. Tests assert at the signal level, not the DOM-consequence level, so any bug that depends on cross-component composition slips through.

**Specific lines where the wrong test setup pattern was used:**

| File | Lines | What's wrong |
|---|---|---|
| `App.test.tsx:121-128` | `history.replaceState(null, '', window.location.pathname)` in `beforeEach` | Deliberately erases URL state before each test — disables the path that produces Bug 1 |
| `App.test.tsx:137-191` | Tests manually set `activeView.value = 'home'` or `'shot-grid'` before render | URL → signal mount path is never exercised |
| `ShotGridView.test.tsx:111-115` | `renderAndWait()` always starts from `shotGrid.value = null` + waits for one resolved fetch | Sequence switching, stale retention, late writes never exercised |
| `ShotGridView.test.tsx:234,248` | Card click test asserts `selectedVersionId.value`, never asserts the DOM consequence | Bug 2 invisible: drawer absence cannot be detected at this boundary |
| `ShotGridView.test.tsx:154` | Loading state uses a never-resolving promise | Rejection path never tested → Bug 6 invisible |

**Single integration test pattern that would catch Bugs 1, 2, 3, 5 simultaneously:**

```ts
it('URL deep-link → shot-grid view → card click → drawer renders selected version', async () => {
  // 1. Seed URL BEFORE render (the missing piece)
  window.history.replaceState(null, '', '?view=shot-grid&seq=seq_1');

  // 2. Mock the fetch
  vi.mocked(fetchShotGrid).mockResolvedValue({
    shots: [makeShot({ id: 'shot_a', latest_completed_version: { id: 'ver_a1' } })],
    sequence: makeSequence({ id: 'seq_1', name: 'sq010' }),
    cursor: null,
    total: 1,
  });

  // 3. Render <App/>, not the view directly
  render(<App />);

  // 4. Bug 1 check — shot-grid surface mounted on URL alone
  await waitFor(() =>
    expect(screen.getByText(FILTER_BAR_STATUS_LABEL)).toBeInTheDocument(),
  );

  // 5. Click the card
  await userEvent.click(screen.getByRole('button', { name: /Open version drawer/ }));

  // 6. Bug 2+5 check — drawer renders with the right version
  await waitFor(() =>
    expect(screen.getByRole('dialog', { name: /Version drawer/ })).toBeInTheDocument(),
  );
});
```

The current test boundary stops at signal writes; the missing boundary is **signal writes → DOM consequences across the view-switch seam**.

---

## 7. Forward-Looking Risks (Phases 22-24)

If we ship Phase 21 with only the tactical 2-bug patch:

- **Phase 22 (Review and Approval)** — roadmap describes a review panel as "VersionDrawer-style overlay" + inline quick-approve confirmation popovers (ROADMAP.md:208-209). Both are global overlays keyed on global state. Authored inside one view = Bug 2 multiplies. The A/B comparison view at ROADMAP.md:210 means the ternary grows to a three-way switch and the chicken-and-egg patterns multiply.
- **Phase 23 (Production Stats)** — at-a-glance widgets likely visible from both home and shot-grid views. Conditional-mount pattern forces duplication or yet another lifted concern.
- **Phase 24 (Polish)** — sticky filter persistence is exactly the URL-hydrate pattern that just broke. SSE streaming summary needs AbortController.abort() coordinated with view switches — no obvious place in current pattern to hang that lifecycle.

If we ship the strategic refactor first:

- The boot useEffect becomes the canonical place for all future hydrates (sticky filters, deep links, per-shot sort) — no future Bug-1-shape chicken-and-eggs.
- Phase 22's overlays hang off `<Overlays>` next to `<VersionDrawer/>`, each keyed on its own global signal, surviving view switches by construction.
- The view-router slot becomes pluggable — new views ship as `{activeView === 'X' && <X/>}` without touching cross-cutting machinery.
- **Risk that does emerge:** signal coupling — overlays at App scope read many global signals. Preact's fine-grained signals largely solve this; each overlay component reads only its specific signals.

---

## 8. Recommended Remediation

Single gap-closure plan, ~1 day of work, structured as 5 atomic commits:

1. **`refactor(21): hoist hydrate calls and SSE registration to App.tsx boot scope`** — fixes Bug 1, eliminates the chicken-and-egg pattern. Adds the integration test pattern from §6.
2. **`refactor(21): rework VersionDrawer to self-resolve from versionId, hoist to App.tsx`** — fixes Bugs 2 and 5. Drawer becomes a self-contained overlay.
3. **`fix(21): add sequence-id + alive guards to ShotGridView Load More handler`** — fixes Bug 3 (the BLOCKING race). Adds a concurrent-pending-request test case.
4. **`fix(21): clear shotGrid.value on selectedSequenceForGrid change before fetching`** — fixes Bug 4. Adds a sequence-switch test case.
5. **`fix(21): render error state when initial shot-grid fetch rejects`** — fixes Bug 6. Adds a rejection test case.
6. **`fix(21): gate currentGridSequenceId prop on activeView==='shot-grid'`** — fixes Bug 7. Adds a test for "after return-to-home, no aria-current='page'" assertion.

Each commit verifiable independently. After all 6: re-run T02 smoke; expect all 12 checklist items green.

**Estimated impact on phase timeline:** +1 day to Phase 21 completion, -3 to -5 days saved on Phase 22-24 (avoiding the same pattern's recurrence).

---

## 9. Reviewer-Disagreement Resolution

The four reviewers converged on Bugs 1+2 and the root architectural diagnosis. Where they diverged:

| Finding | Channels reporting it | Notes |
|---|---|---|
| Bug 1 (URL hydration) | smoke ✓ / challenge ✓ / review ✓ / architect ✓ | Unanimous |
| Bug 2 (VersionDrawer scope) | smoke ✓ / challenge ✓ / review ✓ / architect ✓ | Unanimous |
| Bug 3 (Load More race, BLOCKING) | smoke ✗ (couldn't repro in single-shot test data) / challenge ✓ / review ✗ / architect implied ✓ | Challenge mode caught what diff-scan and smoke missed |
| Bug 4 (sequence-switch stale grid) | smoke ✗ / challenge ✓ / review ✓ / architect ✓ | High-confidence (3/4 channels) |
| Bug 5 (drawer data model) | smoke ✗ / challenge ✓ / review ✓ / architect ✗ | High-confidence; codex challenge dug into the resolver path |
| Bug 6 (fetch failure blank pane) | smoke ✗ / challenge ✓ / review ✗ / architect ✗ | Single-source; medium severity — verify via deliberate-fail test |
| Bug 7 (stale aria-current) | smoke false-positive / challenge ✗ / review ✓ / architect ✗ | I marked D-05 verified in smoke; codex caught the regression after return-to-home |

**Takeaway on review channels:**
- **Manual smoke** is best at confirming the user-facing happy path but blind to concurrent / failure-mode bugs (limited test data).
- **Codex challenge** is best at hostile probing — found 4 of the 5 new bugs.
- **Codex review** (diff-scan) is best at single-pass diff-level correctness but missed concurrency bugs that challenge mode dug out.
- **Plan architect** is best at the meta-pattern diagnosis and forward-looking risk analysis but didn't surface specific code-level defects (its strength is structure, not lines).

All four channels are additive; no single channel is sufficient.
