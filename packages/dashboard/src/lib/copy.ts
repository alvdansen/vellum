/**
 * Copy strings exported as named-export constants for verbatim
 * consumption by dashboard components.
 *
 * Centralizing copy strings here gives screen-reader users, designers, and
 * future i18n efforts a single source of truth. Components import the
 * constants directly (no inline literals); tests assert verbatim equality
 * against the constant names.
 *
 * SIGNED_TOOLTIP + PREVIEW_UNAVAILABLE_PREFIX land here as exported
 * constants. The related 'Output for ${label}' string is a
 * parameterized template at the call site — it remains a JSX literal in
 * Thumbnail.tsx because the version label varies per render.
 *
 * No emojis, no Unicode escapes — copy strings use literal characters
 * (the middle dot in SIGNED_TOOLTIP is U+00B7 'MIDDLE DOT', the same
 * character used by the existing C2paBadge tone).
 */

// ================================================================
// C2PA shield + thumbnail fallback copy
// ================================================================

/**
 * C2PA shield tooltip — locked verbatim copy.
 *
 * Surfaces in two places per <C2paShield/> render:
 *   1. `aria-label` on the <svg> element (screen-reader announcement)
 *   2. Inner `<title>` element child (native browser tooltip on hover)
 *
 * Verb-first STATE LABEL (analogous to "Active generations (N)"); the
 * middle-dot separator matches existing C2paBadge tone.
 */
export const SIGNED_TOOLTIP = 'Signed · Verified provenance';

/**
 * Thumbnail alt-text fallback prefix — used when the browser fires an
 * `onerror` on the <img> (server returned 404 / 500 / network blip).
 *
 * The full alt becomes `${PREVIEW_UNAVAILABLE_PREFIX}${version.label}` —
 * e.g., `Preview unavailable for v003`. Mirrors the existing OUTPUT_UNAVAILABLE
 * error copy (`Preview unavailable`); adds the version label so
 * screen-reader users have a referent. Matches the unified-skeleton-on-failure rule
 * by giving SR equivalent semantic info to what sighted users see.
 */
export const PREVIEW_UNAVAILABLE_PREFIX = 'Preview unavailable for ';

// ================================================================
// Sort-strip + dropdown + load-more copy
// ================================================================

/**
 * Sort-strip muted prefix label — single word "Sort" rendered with the
 * `.label-uppercase` utility (tracking + uppercase transform). Visible
 * sibling to the <SortDropdown/> trigger. NOT "Sort by:" — the dropdown's
 * `aria-label` already says "Sort versions by" / "Sort tree by" so the
 * visible label stays brief.
 */
export const SORT_STRIP_LABEL = 'Sort';

/**
 * Grid <SortDropdown/> trigger `aria-label`. Required prop; surfaces the
 * trigger purpose to screen-reader users since the visible label inside
 * the trigger is just the current option (e.g., "Latest").
 */
export const SORT_GRID_ARIA_LABEL = 'Sort versions by';

/**
 * Tree <SortDropdown/> trigger `aria-label`. Symmetric to grid; refers to
 * the workspace/project/sequence/shot tree.
 */
export const SORT_TREE_ARIA_LABEL = 'Sort tree by';

/**
 * <LoadMoreButton/> loading-state label. Single word + Unicode horizontal
 * ellipsis (U+2026) — matches the existing "Loading…" tone used elsewhere.
 */
export const LOAD_MORE_LOADING_LABEL = 'Loading…';

/**
 * <LoadMoreButton/> error-state retry CTA label. Used on the inline pill
 * below the button when the previous fetch failed; clicking the Retry
 * button re-fires the same onClick handler as the main button.
 */
export const LOAD_MORE_RETRY_LABEL = 'Retry';

/**
 * <LoadMoreButton/> error-state copy prefix for HTTP / server failures —
 * e.g., a 4xx/5xx envelope from /api/shots/:id/versions?cursor=… The full
 * pill copy becomes `${LOAD_MORE_ERROR_PREFIX_FAILED} · Retry` with
 * U+00B7 middle dot (matches the SIGNED_TOOLTIP separator tone).
 */
export const LOAD_MORE_ERROR_PREFIX_FAILED = 'Failed to load';

/**
 * <LoadMoreButton/> error-state copy prefix for network failures — fetch
 * threw (offline, server down, DNS fail). Synthesized client-side; not a
 * server-emitted code.
 */
export const LOAD_MORE_ERROR_PREFIX_NETWORK = 'Network error';

/** Version pane — page 1 in flight with nothing buffered yet. */
export const VERSIONS_LOADING = 'Loading versions…';

/** Version pane — page 1 failed with nothing buffered. Caller prepends the
 *  mapped error prefix; a Retry button accompanies it. Deliberately NOT
 *  "No versions yet": a fetch failure is not evidence of an empty history. */
export const VERSIONS_LOAD_FAILED_SUFFIX = ' — versions did not load.';
export const VERSIONS_LOAD_RETRY = 'Retry';

// ================================================================
// AI conversational summary copy (verbatim named-constant exports)
// ================================================================

/** Section heading rendered above the summary card body. */
export const SUMMARY_HEADING = 'SUMMARY';

/**
 * Existing PROVENANCE heading — preserved verbatim when the standalone
 * Provenance section is wrapped in a <details> disclosure. Kept as
 * a named constant so future planners have one source of truth for the label.
 */
export const PROVENANCE_HEADING = 'PROVENANCE';

/**
 * Disclosure toggle text — locked verbatim copy.
 *
 * The literal string ("Show provenance details") is an accepted
 * requirement phrase and must not drift.
 */
export const SUMMARY_DISCLOSURE_TOGGLE = 'Show provenance details';

/** Default Regenerate button label — no cooldown, not fetching. */
export const REGENERATE_BUTTON_LABEL = 'Regenerate';

/**
 * Regenerate button label during a fetch (initial mount OR active regenerate).
 * Uses U+2026 horizontal-ellipsis verbatim — matches the
 * LOAD_MORE_LOADING_LABEL tone.
 */
export const REGENERATE_BUTTON_FETCHING = 'Regenerating…';

/** Visible label inside the WarningPill for the summary-fallback marker. */
export const WARNING_PILL_FALLBACK_LABEL = 'AI summary unavailable';

/**
 * Long-form ARIA label for the WarningPill — full fallback disclosure for
 * screen-reader users (sighted users see only the WARNING_PILL_FALLBACK_LABEL).
 */
export const WARNING_PILL_FALLBACK_ARIA =
  'AI summary unavailable; showing structured details';

/**
 * Body text shown when the fetch fails before any engine outcome lands
 * (network error, 4xx envelope, parse failure). Verbatim user-facing copy.
 */
export const SUMMARY_ERROR_FALLBACK = '(AI summary unavailable; please retry.)';

/**
 * First-use disclosure — informed-consent surface. Renders as a
 * muted note ABOVE the first-ever summary body; auto-dismissed on first
 * Regenerate click or first explicit dismissal.
 */
export const SUMMARY_FIRST_USE_DISCLOSURE = 'AI summary uses your prompt text';

/**
 * localStorage key for "user has dismissed first-use disclosure". Namespaced
 * (`vellum:`) to avoid cross-app collisions on shared origins.
 */
export const SUMMARY_FIRST_USE_LOCALSTORAGE_KEY =
  'vellum:summary:first-use-acked';

/**
 * Template builder for the Regenerate button ARIA label. Caller passes the
 * version label (e.g., 'v003') and the SR-friendly referent is composed.
 */
export function regenerateButtonAriaLabel(versionLabel: string): string {
  return `Regenerate summary for ${versionLabel}`;
}

/**
 * Cooldown label template — used inside RegenerateButton when the
 * server-reported regenerate-available-at timestamp is in the future.
 * The cooldown digit ticks down once per second via a 1Hz setInterval.
 */
export function regenerateButtonCooldownLabel(cooldownSeconds: number): string {
  return `Regenerate (${cooldownSeconds}s)`;
}

// ================================================================
// Shot grid copy (verbatim named-constant exports)
//
// All shot-grid surfaces — filter bar, sequence header, shot card, time
// helper, empty/loading/error states, TreeSidebar grid icon, header
// home button — import from this block. Zero inline string literals in
// component files (architectural rule).
// ================================================================

// ---------- Filter bar ----------

/** Filter bar prefix label rendered with `.label-uppercase` utility. */
export const FILTER_BAR_STATUS_LABEL = 'Status';

/** Filter pill label — show all shots regardless of status. */
export const FILTER_PILL_ALL = 'All';

/** Filter pill label — wip status. Lowercase verbatim; CSS uppercases at render. */
export const FILTER_PILL_WIP = 'wip';
export const FILTER_PILL_PENDING_REVIEW = 'pending-review';
export const FILTER_PILL_APPROVED = 'approved';
export const FILTER_PILL_ON_HOLD = 'on-hold';
/** Only appears in the bar when `showOmitted === true`. */
export const FILTER_PILL_OMIT = 'omit';

/** "Show omitted" toggle visible label. Native <button role="switch" aria-checked>. */
export const SHOW_OMITTED_TOGGLE_LABEL = 'Show omitted';

/** "Show omitted" toggle ARIA label — full-sentence verb form for SR users. */
export const SHOW_OMITTED_TOGGLE_ARIA = 'Toggle omitted shots';

// ---------- Sequence header ----------

/** Sequence header chevron `aria-label` prefix when expanded. Caller concatenates sequence name. */
export const SEQUENCE_HEADER_TOGGLE_ARIA_PREFIX_OPEN = 'Collapse ';

/** Sequence header chevron `aria-label` prefix when collapsed. Caller concatenates sequence name. */
export const SEQUENCE_HEADER_TOGGLE_ARIA_PREFIX_CLOSED = 'Expand ';

/** Aggregate counts mini-pill row region label prefix. Caller concatenates sequence name. */
export const AGGREGATE_COUNTS_REGION_LABEL_PREFIX = 'Status counts for ';

// ---------- Shot grid card ----------

/** ShotGridCard button `aria-label` prefix. Caller concatenates shot name. */
export const SHOT_CARD_OPEN_ARIA_PREFIX = 'Open version drawer for ';

/** Version-count copy — exact singular form. */
export const SHOT_CARD_VERSION_COUNT_SINGULAR = '1 version';

/** Version-count plural suffix. Caller renders `${n}${SUFFIX}` when n !== 1. */
export const SHOT_CARD_VERSION_COUNT_PLURAL_SUFFIX = ' versions';

/** Copy shown when a shot has zero versions (click is disabled in this branch). */
export const SHOT_CARD_NO_VERSIONS = 'No versions yet';

/** Last-updated prefix — caller concatenates with `formatRelativeTime(epoch)`. */
export const SHOT_CARD_LAST_UPDATED_PREFIX = 'Updated ';

// ---------- Time helper ----------

/** Relative-time bucket: < 60s. Bare constant, no suffix. */
export const TIME_JUST_NOW = 'just now';

/** Relative-time bucket: 1–59 minutes. Caller renders `${n}${SUFFIX}` e.g. "5m ago". */
export const TIME_MINUTES_SUFFIX = 'm ago';

/** Relative-time bucket: 1–23 hours. */
export const TIME_HOURS_SUFFIX = 'h ago';

/** Relative-time bucket: 1–6 days. */
export const TIME_DAYS_SUFFIX = 'd ago';

/** Relative-time bucket: 1–3 weeks. */
export const TIME_WEEKS_SUFFIX = 'w ago';

/** Relative-time bucket: 1+ months (approx 30-day buckets — accepted imprecision). */
export const TIME_MONTHS_SUFFIX = 'mo ago';

// ---------- Empty / loading / error states ----------

/** Empty state — brand-new database, zero workspaces. The first thing a
 *  first-run user sees, so it says what to do, not just what is missing. */
export const TREE_EMPTY_NO_WORKSPACES =
  'No workspaces yet — ask your MCP client to create one.';

/** Empty state — sequence has zero shots. */
export const SHOT_GRID_EMPTY_NO_SHOTS =
  'No shots in this sequence yet. Shots are created via the MCP agent.';

/** Empty state — current statusFilter matches zero shots. Caller concatenates `${status}' in ${seq}.` */
export const SHOT_GRID_EMPTY_FILTER_PREFIX = "No shots with status '";

/** Empty state — All filter active, showOmitted off, all shots are omitted. */
export const SHOT_GRID_EMPTY_FILTER_ALL_NO_OMITTED_PREFIX = 'No active shots in ';

/** Empty state — single omit-only shot hidden by showOmitted toggle. */
export const SHOT_GRID_EMPTY_FILTER_OMIT_HIDDEN = 'Hidden. Toggle "Show omitted" to view.';

/** Loading state — initial fetch in flight. U+2026 ellipsis matches LOAD_MORE_LOADING_LABEL tone. */
export const SHOT_GRID_LOADING_LABEL = 'Loading shots…';

/** Error pill prefix — paired with LOAD_MORE_RETRY_LABEL CTA. */
export const SHOT_GRID_FETCH_ERROR_PREFIX = 'Failed to load shots';

/**
 * Full-pane error state copy — surfaced when the initial shot-grid fetch
 * rejects and there's no prior data to show. The retry CTA reuses
 * LOAD_MORE_RETRY_LABEL ('Retry') and re-runs the fetch effect via a
 * sequence-id re-trigger.
 *
 * Added after an audit found that without this full-pane copy, an
 * initial-fetch failure left ShotGridView rendering a blank pane
 * (shotGrid===null + gridIsFetching===false matched no branch).
 */
export const SHOT_GRID_FETCH_ERROR =
  "Couldn't load shots. Try refreshing the page.";

// ---------- TreeSidebar grid-icon affordance ----------

/** Grid-icon button `aria-label` prefix. Caller concatenates sequence name. */
export const TREE_GRID_ICON_ARIA_PREFIX = 'Open shots for ';

/** Grid-icon button ARIA suffix when active (`aria-current="page"`). */
export const TREE_GRID_ICON_ACTIVE_ARIA_SUFFIX = ' (current)';

// ---------- Header home button ----------

/** Home button `aria-label`. Surfaces when activeView === 'shot-grid'. */
export const HEADER_HOME_ARIA_LABEL = 'Back to home view';

// ================================================================
// Review and approval copy (verbatim named-constant exports)
//
// All review-and-approval surfaces — ReviewPanel, StatusChangePopover, ABCompareView,
// QuickApproveButton, ReviewActionBar, ReviewTimeline — import from this
// block. Zero inline string literals in component files (architectural rule).
// ================================================================

// ---------- Action bar labels (review panel) ----------

export const REVIEW_ACTION_APPROVE_LABEL = 'Approve';
export const REVIEW_ACTION_RETAKE_LABEL = 'Request Retake';
export const REVIEW_ACTION_HOLD_LABEL = 'Hold';
export const REVIEW_ACTION_OMIT_LABEL = 'Omit';
export const REVIEW_ACTION_RESTORE_LABEL = 'Restore Shot';

// ---------- Action bar aria-labels (one per action) ----------

export const REVIEW_ACTION_APPROVE_ARIA = 'Approve this shot';
export const REVIEW_ACTION_RETAKE_ARIA = 'Request retake of this shot';
export const REVIEW_ACTION_HOLD_ARIA = 'Place this shot on hold';
export const REVIEW_ACTION_OMIT_ARIA = 'Omit this shot';
export const REVIEW_ACTION_RESTORE_ARIA = 'Restore this shot from omit';

// ---------- Action button in-flight states (U+2026 verbatim) ----------

export const REVIEW_ACTION_APPROVE_PENDING = 'Approving…';
export const REVIEW_ACTION_RETAKE_PENDING = 'Requesting…';
export const REVIEW_ACTION_HOLD_PENDING = 'Holding…';
export const REVIEW_ACTION_OMIT_PENDING = 'Omitting…';
export const REVIEW_ACTION_RESTORE_PENDING = 'Restoring…';

// ---------- Confirmation popover prompts (LOCKED — the prompt is the only differentiator) ----------

export const REVIEW_APPROVE_PROMPT = 'Approve this shot?';
export const REVIEW_RETAKE_PROMPT = 'Request retake?';
export const REVIEW_HOLD_PROMPT = 'Hold this shot?';
export const REVIEW_OMIT_PROMPT = 'Omit this shot?';
export const REVIEW_RESTORE_PROMPT = 'Restore this shot to wip?';

// ---------- Popover controls ----------

export const POPOVER_CANCEL_LABEL = 'Cancel';
export const POPOVER_CONFIRM_LABEL = 'Confirm';
export const POPOVER_CONFIRM_PENDING = 'Submitting…';
export const POPOVER_NOTE_PLACEHOLDER = 'Add a note (optional)';
export const POPOVER_NOTE_LABEL = 'Note (optional)';
/** Composed at render: `${POPOVER_DIALOG_ARIA_LABEL_PREFIX}${promptText}`. */
export const POPOVER_DIALOG_ARIA_LABEL_PREFIX = 'Confirm status change: ';

// ---------- Quick-approve hover affordance on ShotGridCard ----------

/** Composed: `${REVIEW_QUICK_APPROVE_ARIA_PREFIX}${shotName}`. */
export const REVIEW_QUICK_APPROVE_ARIA_PREFIX = 'Quick approve ';
/** Verbatim <WarningPill/> label. U+2014 em-dash. */
export const REVIEW_QUICK_APPROVE_FAIL_LABEL = 'Approve failed — retry';
export const REVIEW_QUICK_APPROVE_FAIL_ARIA =
  'Quick approve failed; click to retry';

// ---------- Review panel header + sections ----------

export const REVIEW_PANEL_TITLE_PREFIX = 'Review: ';
export const REVIEW_PANEL_ARIA_LABEL_PREFIX = 'Review panel for ';
export const REVIEW_PANEL_CLOSE_ARIA = 'Close review panel';
export const REVIEW_SECTION_ACTIONS = 'ACTIONS';
export const REVIEW_SECTION_HISTORY = 'HISTORY';
export const REVIEW_HISTORY_EMPTY =
  'No history yet. Status changes and versions will appear here.';

// ---------- Timeline row attribution (unified version + status events) ----------

export const TIMELINE_CHANGED_BY_PREFIX = 'by ';
export const TIMELINE_VERSION_CREATED_PREFIX = 'Version ';
export const TIMELINE_VERSION_CREATED_SUFFIX = ' created';
export const TIMELINE_VERSION_COMPLETED_PREFIX = 'Version ';
export const TIMELINE_VERSION_COMPLETED_SUFFIX = ' completed';
export const TIMELINE_VERSION_FAILED_PREFIX = 'Version ';
export const TIMELINE_VERSION_FAILED_SUFFIX = ' failed';
export const TIMELINE_STATUS_CHANGED_PREFIX = 'Status → ';
export const TIMELINE_VERSION_ROW_ARIA_PREFIX = 'Open version ';
export const TIMELINE_VERSION_ROW_ARIA_SUFFIX = ' in version drawer';
/**
 * Verbatim string persisted to `shot_status_events.note` on Restore
 * (locked: the Restore popover has no textarea; the route writes this constant).
 * Also rendered verbatim in the timeline row's note slot for the Restore event.
 */
export const RESTORE_NOTE_SYSTEM_TEXT = 'Restored from omit';

// ---------- Compare mode (entry CTA + selection state) ----------

/** Uses U+2026 ellipsis ("opens a sub-flow" UX tone). */
export const COMPARE_MODE_ENTER_LABEL = 'Compare versions…';
export const COMPARE_MODE_ENTER_ARIA = 'Enter compare-versions mode';
export const COMPARE_MODE_CTA_LABEL = 'Compare';
export const COMPARE_MODE_CTA_DISABLED_ARIA = 'Select two versions to compare';
export const COMPARE_MODE_CTA_READY_ARIA = 'Compare selected versions';
export const COMPARE_MODE_CANCEL_LABEL = 'Cancel compare';
/** Composed: `${COMPARE_MODE_CHECKBOX_ARIA_PREFIX}${versionLabel}`. */
export const COMPARE_MODE_CHECKBOX_ARIA_PREFIX = 'Select version ';
export const COMPARE_MODE_HINT = 'Pick 2 versions';

// ---------- A/B compare view modal ----------

export const COMPARE_MODAL_TITLE_PREFIX = 'Compare ';
export const COMPARE_MODAL_TITLE_INFIX = ' vs ';
export const COMPARE_MODAL_ARIA_LABEL_PREFIX = 'Version comparison: ';
export const COMPARE_MODAL_CLOSE_ARIA = 'Close comparison';
export const COMPARE_MODAL_SECTION_THUMBNAILS = 'THUMBNAILS';
export const COMPARE_MODAL_SECTION_METADATA = 'METADATA DIFF';
export const COMPARE_MODAL_LOADING_LABEL = 'Loading thumbnails…';
export const COMPARE_MODAL_DIFF_LOADING = 'Loading metadata diff…';
export const COMPARE_MODAL_DIFF_ERROR =
  "Couldn't load metadata diff. Try again.";
export const COMPARE_MODAL_DIFF_EMPTY = 'No metadata differences.';
export const COMPARE_MODAL_THUMB_LOAD_FAIL =
  "Couldn't load one or both versions. Try again.";

// ---------- Error / loading ----------

/** Executor concatenates with error-shape detail; final UI string is `${prefix}${detail} — retry`. */
export const REVIEW_PANEL_ACTION_FAIL_PREFIX = 'Failed to change status: ';
export const REVIEW_HISTORY_FETCH_ERROR =
  "Couldn't load shot history. Try refreshing the page.";
export const REVIEW_PANEL_LOADING_LABEL = 'Loading review panel…';

// ================================================================
// Production stats copy (verbatim named-constant exports)
//
// All production-stats surfaces — <ProgressBar/>, the new stats subrow inside
// <SequenceHeader/>, and the new stale aria-suffix on <ShotGridCard/> —
// import from this block. Zero inline string literals in component files
// (architectural rule).
// ================================================================

// ---------- ProgressBar (% approved) ----------

/** Caller concatenates: `${STATS_PROGRESS_ARIA_PREFIX}${sequenceName}` for the bar's aria-label. */
export const STATS_PROGRESS_ARIA_PREFIX = 'Approval progress for ';

/** Caller concatenates: `${stats.approved_pct}${STATS_APPROVED_LABEL_SUFFIX}` → "60% approved". */
export const STATS_APPROVED_LABEL_SUFFIX = '% approved';

// ---------- Backlog callout (pending-review) ----------

/**
 * Singular/plural pair (English: "1 awaiting review" / "3 awaiting review" —
 * verb-noun phrasing, both forms identical). Kept as TWO constants for
 * future i18n and to mirror the SHOT_CARD_VERSION_COUNT_SINGULAR /
 * SHOT_CARD_VERSION_COUNT_PLURAL_SUFFIX precedent.
 */
export const STATS_BACKLOG_CALLOUT_SINGULAR = 'awaiting review';
export const STATS_BACKLOG_CALLOUT_PLURAL = 'awaiting review';

/** Caller concatenates: `${STATS_BACKLOG_CALLOUT_ARIA_PREFIX}${n} ${noun}` → SR announce. */
export const STATS_BACKLOG_CALLOUT_ARIA_PREFIX = 'Pending review backlog: ';

// ---------- Inline stale count ----------

/**
 * Singular/plural pair (English: "1 stale" / "3 stale" — deliberately terse;
 * both forms identical). Kept as TWO constants for future i18n.
 */
export const STATS_STALE_INLINE_SINGULAR = 'stale';
export const STATS_STALE_INLINE_PLURAL = 'stale';

/** Caller concatenates: `${STATS_STALE_INLINE_ARIA_PREFIX}${n}` → "Stale shots: 1". */
export const STATS_STALE_INLINE_ARIA_PREFIX = 'Stale shots: ';

// ---------- Per-shot stale indicator ARIA suffix ----------

/**
 * Caller appends to existing thumbnail aria-label when `shot.is_stale === true`:
 *   `${SHOT_CARD_OPEN_ARIA_PREFIX}${shot.name}${SHOT_CARD_STALE_ARIA_SUFFIX}`
 *   → "Open version drawer for SH_020 — stale".
 *
 * Codepoints: space (0x20) + em-dash (U+2014) + space (0x20) + "stale".
 * The em-dash discipline matches REVIEW_QUICK_APPROVE_FAIL_LABEL.
 */
export const SHOT_CARD_STALE_ARIA_SUFFIX = ' — stale';

// ================================================================
// Approval gate — proposals panel (no silent credit spend)
//
// The ApprovalsPanel view, ProposalCard, ProposalDecisionBar, and the
// header nav button import from this block. Zero inline string literals in
// those component files (architectural rule).
// ================================================================

// ---------- Header nav + view chrome ----------

export const APPROVALS_NAV_ARIA_LABEL = 'Approvals — pending spend queue';
export const APPROVALS_VIEW_TITLE = 'Approvals';
/** Caller concatenates: `${APPROVALS_NAV_BADGE_ARIA_PREFIX}${n}` → "3 proposals awaiting approval". */
export const APPROVALS_NAV_BADGE_ARIA_PREFIX = ' — ';
export const APPROVALS_NAV_BADGE_ARIA_SUFFIX = ' awaiting approval';
export const APPROVALS_VIEW_SUBTITLE =
  'Every generation is proposed here before any credits are spent.';

// ---------- Filter tabs ----------

export const APPROVALS_FILTER_PROPOSED = 'Pending';
export const APPROVALS_FILTER_APPROVED = 'Approved';
export const APPROVALS_FILTER_REJECTED = 'Rejected';
export const APPROVALS_FILTER_ALL = 'All';
export const APPROVALS_FILTER_GROUP_ARIA = 'Filter proposals by status';

// ---------- Stat tiles ----------

export const APPROVALS_STAT_PENDING_LABEL = 'Pending';
export const APPROVALS_STAT_APPROVED_LABEL = 'Approved';
export const APPROVALS_STAT_REJECTED_LABEL = 'Rejected';

// ---------- States (loading / empty / error) ----------

export const APPROVALS_LOADING_LABEL = 'Loading proposals…';
export const APPROVALS_EMPTY_PENDING =
  'No pending proposals — nothing is waiting to spend credits.';
export const APPROVALS_EMPTY_APPROVED = 'No approved proposals yet.';
export const APPROVALS_EMPTY_REJECTED = 'No rejected proposals.';
export const APPROVALS_EMPTY_ALL = 'No proposals yet.';
export const APPROVALS_LOAD_ERROR =
  "Couldn't load proposals. Try refreshing the page.";
export const APPROVALS_RETRY_LABEL = 'Retry';

// ---------- Proposal card field labels ----------

export const PROPOSAL_KIND_SUBMIT = 'Submit';
export const PROPOSAL_KIND_REPRODUCE = 'Reproduce';
export const PROPOSAL_KIND_ITERATE = 'Iterate';
export const PROPOSAL_KIND_EXTERNAL = 'External action';
/** Shown on external proposals so a reviewer is not left thinking approval will
 *  make something happen here. Approval authorizes; the agent then acts. */
export const PROPOSAL_EXTERNAL_NOTICE =
  'Vellum does not perform this action. Approving records that you authorized it, exactly once.';
export const PROPOSAL_COST_LABEL = 'Est. cost';
export const PROPOSAL_COST_UNKNOWN = 'not estimated';
export const PROPOSAL_SHOT_LABEL = 'Shot';
export const PROPOSAL_NOTES_LABEL = 'Note';
export const PROPOSAL_REQUEST_LABEL = 'Request';
export const PROPOSAL_DECIDED_NOTE_LABEL = 'Decision note';
export const PROPOSAL_VERSION_LABEL = 'Created version';
export const PROPOSAL_EXECUTION_ERROR_LABEL = 'Execution failed';
/** Caller concatenates: `${PROPOSAL_CREATED_PREFIX}${relativeTime}`. */
export const PROPOSAL_CREATED_PREFIX = 'Proposed ';
export const PROPOSAL_DECIDED_PREFIX = 'Decided ';

// ---------- Decision actions ----------

export const PROPOSAL_APPROVE_LABEL = 'Approve';
export const PROPOSAL_APPROVE_PENDING = 'Approving…';
export const PROPOSAL_REJECT_LABEL = 'Reject';
export const PROPOSAL_REJECT_PENDING = 'Rejecting…';
/** Caller concatenates: `${PROPOSAL_APPROVE_ARIA_PREFIX}${kind} on ${shot}`. */
export const PROPOSAL_APPROVE_ARIA_PREFIX = 'Approve ';
export const PROPOSAL_REJECT_ARIA_PREFIX = 'Reject ';
export const PROPOSAL_APPROVE_PROMPT =
  'Approve this generation? Credits will be spent when it runs.';
export const PROPOSAL_REJECT_PROMPT =
  'Reject this generation? Nothing runs and no credits are spent.';
export const PROPOSAL_NOTE_PLACEHOLDER = 'Add a note (optional)';
export const PROPOSAL_NOTE_LABEL = 'Decision note';
export const PROPOSAL_DECIDE_CONFIRM = 'Confirm';
export const PROPOSAL_DECIDE_CANCEL = 'Cancel';
/** Executor concatenates: `${PROPOSAL_DECIDE_FAIL_PREFIX}${detail}`. */
export const PROPOSAL_DECIDE_FAIL_PREFIX = 'Failed: ';

// ================================================================
// Pipeline log (Engine.getShotPipelineLog — cost + provenance markdown)
// ================================================================

export const PIPELINE_LOG_TOGGLE_LABEL = 'Pipeline log';
export const PIPELINE_LOG_TOGGLE_ARIA = 'Show the pipeline log for this shot';
export const PIPELINE_LOG_HIDE_ARIA = 'Hide the pipeline log';
export const PIPELINE_LOG_LOADING_LABEL = 'Loading pipeline log…';
export const PIPELINE_LOG_ERROR =
  "Couldn't load the pipeline log. Try again.";
export const PIPELINE_LOG_RETRY_LABEL = 'Retry';
/** Caller concatenates: `${n} ${PIPELINE_LOG_TAKE_COUNT_SINGULAR|PLURAL}` → "3 takes". */
export const PIPELINE_LOG_TAKE_COUNT_SINGULAR = 'take';
export const PIPELINE_LOG_TAKE_COUNT_PLURAL = 'takes';
