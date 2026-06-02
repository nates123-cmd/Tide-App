# Tide — app behaviors observed during QA harness build

These are DOCUMENTED, not patched (the harness never edits index.html). Severity
is low; tests are written around the real behavior.

## B1 — Swipe panel re-closes immediately on desktop (mouse) — LOW (touch unaffected)

**Where:** `index.html` `attachSwipeActions()` — the capture-phase click handler
on `.swipe-content` (≈ line 5672–5675) and the mouse-drag `onEnd`/`openRight`
/`openLeft` (≈ line 5642–5668).

**Behavior:** With a mouse, completing a drag past the commit threshold fires
`onEnd()` → `openRight()`/`openLeft()` (sets `translateX(-88px)`/`(104px)`), but
the browser then synthesizes a `click` from the same mouseup. The capture click
handler sees `openSide` truthy and calls `close()`, so the revealed action panel
snaps shut in the same tick. Net: on desktop you cannot leave a row "held open"
by mouse — the delete/reschedule panel flashes and closes.

**Impact:** Desktop-only cosmetic. On touch (`touchend` → `onEnd`), no synthetic
click closes it, so the panel stays open as designed. The action callbacks
(`onDelete`/`onReschedule`) are wired on the action buttons themselves and fire
correctly when clicked, so the feature is functional on touch.

**Test handling:** `sip-edit.spec.js` asserts the open transform *during* the
live drag (before mouseup) and verifies the action-button callbacks fire via a
direct click, rather than depending on the panel persisting after mouseup.

## Non-bugs noted (intentional, but worth flagging vs spec)

- **`fullStackStreak()` counts opt-in `required` items, not all scheduled items.**
  tide-v2-spec.md §Stack describes the streak as "100% of scheduled (morning +
  evening) items", but the implementation only requires items flagged
  `required` (and returns 0 if none are flagged). This looks like a deliberate
  later refinement (per-item opt-in), not a defect — tests assert the real code.

- **No offline write outbox.** Unlike other suite apps (sbFetch localStorage
  outbox + FIFO replay), Tide's `sbFetch()` writes go straight through
  `sbBearer()` with no queue. Nothing to test; called out in TESTING-PLAN so a
  future reviewer doesn't assume parity with Ink/Break.
