# AIPER — Super-Phase Plan

---

## Super-Phase Overview

| SP | Name | Items | Status |
|---|---|---|---|
| SP1 | MVP Delivery | F1, B6, B5, F12, F5, F10, F4, F17, B2, B3 | ✅ Complete |
| SP2 | Core Stability | F14, B1, F8, F15, F13, F2, F16, F18, F19, F20, F9 | ⬜ Active |
| SP3 | UX Polish + Infrastructure | B4, B7, B8, B9, B10, F7, F3, F6, C2, C3, C4, C5, C6 | Upcoming |
| SP4 | Documentation | F11 | Future |
| SP5 | Future (No Start Date) | C1, C7 | Deferred |

---

## SP1 — MVP Delivery ✅

### Phase Order

Dependencies within SP1 dictate this sequence:
- **F12 must precede F9** (F9 restructures the whole engine; tweaks first to set baseline)
- **F10 must precede F1** (F1 reuses the preserve-progress mechanism from F10)
- All other items are independent and ordered by blast radius (smallest changes first)

| Phase | ID | Title | Status |
|---|---|---|---|
| SP1.P1 | B6 | Hand Over / Receive Sample Modal Broken | ✅ Done |
| SP1.P2 | B2 | Timeline State Mismatch on RETURNED | ✅ Done |
| SP1.P3 | B3 | Deadline Lateness Indicator | ✅ Done |
| SP1.P4 | B5 | Retained Job Shows Stale ULR Preview | ✅ Done |
| SP1.P5 | F5 | Accidental Approve Safeguard | ✅ Done |
| SP1.P6 | F10 | Job Reassign Bug Fix | ✅ Done |
| SP1.P7 | F12 | Report Minor Tweaks | ✅ Done |
| SP1.P8 | F9 | New Addition of Special Group — Water 10500 | ~~Moved → SP2.P11~~ |
| SP1.P9 | F1 | Job Hold | ✅ Done |
| SP1.P10 | F4 | Multi-Job Dispatch | ✅ Done |
| SP1.P11 | F17 | DB Export / Backup | ✅ Done |

---

### SP1.P1 — B6: Hand Over / Receive Sample Modal Broken

**File**: `frontend/src/pages/Head/TransferManagement.jsx`

**Root cause hypothesis**: The modal is positioned absolutely or fixed without a proper z-index/portal, causing it to overflow behind the job list.

| Subphase | Task |
|---|---|
| SP1.P1.1 | Open `TransferManagement.jsx` and locate both the "Hand Over Sample" and "Receive Sample" modal JSX blocks |
| SP1.P1.2 | Identify whether the modal renders inline (in-place) or via a portal. If inline, wrap the modal in a React Portal (`ReactDOM.createPortal`) mounting to `document.body` |
| SP1.P1.3 | Ensure modal overlay uses `position: fixed; inset: 0; z-index: 1000` and the modal box is centered via flexbox |
| SP1.P1.4 | Verify `overflow: hidden` on a parent is not clipping the modal |
| SP1.P1.5 | Test on mobile viewport — tap "Hand Over" and "Receive", confirm modal renders cleanly above all content |
| SP1.P1.6 | Confirm "Confirm" button still triggers the correct transfer action |

> ✅ Completed — commit `01f90f7`. Fix was CSS-only in `frontend/src/index.css` — stacking context/z-index fix on the overlay was sufficient. A React Portal was not needed.

---

### SP1.P2 — B2: Timeline State Mismatch on RETURNED

**File**: `frontend/src/components/JobTimeline.jsx`

**Known state**: Line 87 — `RETURNED` falls into a branch, and lines 109–110 show `headApproval || instance.status === 'COMPLETED'` setting s4 to `completed`. If `headApproval` is a truthy object even on returned jobs, s4 incorrectly turns green.

| Subphase | Task |
|---|---|
| SP1.P2.1 | Read the full s4 logic block (lines ~79–114) in `JobTimeline.jsx` |
| SP1.P2.2 | Trace what `headApproval` contains on a `RETURNED` job — verify it is not a stale approval object from a prior review |
| SP1.P2.3 | Fix the s4 condition: `s4_status = 'completed'` must only be set if `dStatus === 'COMPLETED'` (full job), not merely if `headApproval` exists |
| SP1.P2.4 | On `RETURNED` status: explicitly force `s4_status = 'pending'` to override any stale headApproval check |
| SP1.P2.5 | Confirm `PENDING_HEAD_REVIEW` still renders s4 as `active` (clock icon) |
| SP1.P2.6 | Visually verify the full timeline across: DISPATCHED, RETURNED, PENDING_HEAD_REVIEW, COMPLETED |

> ✅ Completed — commits `bad3649` + `f54dc46` (two passes on `frontend/src/components/JobTimeline.jsx`). Second pass extended the fix to stages S2 and S3 as well, not just S4 as originally planned.

---

### SP1.P3 — B3: Deadline Lateness Indicator

**Files**: `frontend/src/pages/AssistantDashboard.jsx` (display), `frontend/src/pages/Head/DispatcherPage.jsx` (input)

| Subphase | Task |
|---|---|
| SP1.P3.1 | Create a shared utility function `isOverdue(deadlineStr): boolean` that returns `new Date(deadlineStr) < new Date()` |
| SP1.P3.2 | In `AssistantDashboard.jsx` line ~477: wrap the deadline display — if `isOverdue(activeTask.deadline)`, render the timestamp in `var(--color-danger)` red with an "Overdue" badge next to it |
| SP1.P3.3 | In `AssistantDashboard.jsx` line ~682: apply the same overdue styling to the task list row deadline |
| SP1.P3.4 | In `DispatcherPage.jsx`: on the deadline date/time inputs, add an `onChange` validation — if the composed datetime string is in the past, show an inline warning: "This deadline has already passed" |
| SP1.P3.5 | Do NOT hard-block form submission for past deadlines (the head may intentionally set a tight deadline). Only warn. |
| SP1.P3.6 | Verify on mobile — badge must not overflow the card |

> ✅ Completed — commit `dc6a65c`. Overdue badge added to `AssistantDashboard.jsx`; past-deadline warning added to `DispatcherPage.jsx`. Note: `isOverdue()` was implemented inline in each file, not extracted as a shared util.

---

### SP1.P4 — B5: Retained Job Shows Stale ULR Preview

**File**: `frontend/src/pages/AdminOfficer/JobsPage.jsx`

**Root cause**: The `retainForm` block (lines 770–783) does not clear or re-fetch `ulrPreview`, so the stale value from the previous submission persists.

| Subphase | Task |
|---|---|
| SP1.P4.1 | In the `retainForm` block (around line 770), add `setUlrPreview("")` to clear the stale value immediately after submission |
| SP1.P4.2 | For NABL jobs: after clearing, show the text "ULR assigned upon test completion" in the ULR preview display field (not a fetched number) |
| SP1.P4.3 | For Non-NABL opt-in jobs: after clearing, show "Slot reserved on save" — do not fetch the next slot number as a live preview |
| SP1.P4.4 | Also clear `assignUlrToNonNabl`, `ulrEditMode`, `customUlrNumber`, and `ulrValidation` state in the retain block so no stale opt-in state carries over |
| SP1.P4.5 | Verify: create a NABL job, retain form, confirm ULR preview reads "ULR assigned upon completion" not a number |
| SP1.P4.6 | Verify: create a Non-NABL opt-in job, retain form, confirm ULR section is reset cleanly |

> ✅ Completed — commit `39e28d1`. ULR preview state cleared on form retain in `AdminOfficer/JobsPage.jsx`.

---

### SP1.P5 — F5: Accidental Approve Safeguard

**File**: `frontend/src/pages/Head/DispatcherPage.jsx`

| Subphase | Task |
|---|---|
| SP1.P5.1 | Locate the analyst-picker card state in `DispatcherPage.jsx` — the UI block that appears after "Approve" is clicked |
| SP1.P5.2 | Add a "Return to Officer" button styled as a secondary/ghost button at the top-right of the analyst-picker card state |
| SP1.P5.3 | On click: clear all pre-selected analysts for this job's card, and revert the card state back to its pre-approval view (clear any `approved`, `pickerOpen`, or equivalent local state for that job ID) |
| SP1.P5.4 | Ensure "Return to Officer" does NOT call any API — this is a pure frontend state revert |
| SP1.P5.5 | Socket: no socket events needed — nothing has been committed to the backend |
| SP1.P5.6 | Verify on mobile — the button must be tappable and not overlap the analyst picker dropdown |

> ✅ Completed — commit `23b2a0f`. "Return to Officer" button added in `DispatcherPage.jsx` — pure frontend state revert, no API call.

---

### SP1.P6 — F10: Job Reassign Bug Fix

**Files**: Backend reassign routes, `TestInstance.js`

| Subphase | Task |
|---|---|
| SP1.P6.1 | Read and map the full reassign flow: find the route that handles "Head reassigns analyst" (likely in `testResultRoutes.js` or `testAssignmentRoutes.js`) |
| SP1.P6.2 | Locate exactly where `TestInstance` data is set/overwritten during a reassign. Identify if the route creates a new TestInstance or updates the existing one |
| SP1.P6.3 | If it creates a new TestInstance: change to update the existing one, preserving `results`, `method`, and `notes` fields. Only update `assignedTo` |
| SP1.P6.4 | If it updates in place: verify `results`, `method`, `notes` are not being cleared by a `$set` or `Object.assign` that overwrites them with empty values |
| SP1.P6.5 | Add a `reviewHistory` entry for the reassignment: `{ action: 'REASSIGN', by: req.user._id, note: 'Reassigned to [analyst name]', date: now }` |
| SP1.P6.6 | Frontend: verify that when analyst receives a reassigned job, previously saved values are visible in the input fields |
| SP1.P6.7 | Test edge case: reassign a job that has zero saved progress — must still work cleanly |

> ✅ Completed — commit `8fc39a4`. Fix applied to `backend/routes/tests/testResultRoutes.js` only. Reassign now updates `TestInstance` in-place; `results`/`method`/`notes` preserved; `reviewHistory` entry added.

---

### SP1.P7 — F12: Report Minor Tweaks

**File**: `backend/services/reportGenerator.js`

| Subphase | Task |
|---|---|
| SP1.P7.1 | Locate the "Contact details" row builder in `reportGenerator.js` — find where contact person, phone, and email are composed into one string |
| SP1.P7.2 | Split into two separate table rows: `Contact Person:` → contact person name only; `Email:` → email only. Remove the merged row |
| SP1.P7.3 | Verify against the reference doc (`DRINKING WATER 1741 as per 10500.docx`) whether the phone number row appears separately or is dropped. Implement accordingly |
| SP1.P7.4 | Locate where authorized signatory names appear in the report footer/signature block |
| SP1.P7.5 | Check if names are hardcoded strings or pulled from User model. If hardcoded, update `Monika Pali` → `Ms. Monika Pali` and `Jyoti Pathak` → `Ms. Jyoti Pathak`. If from DB, add a `honorific` field or derive from gender |
| SP1.P7.6 | Generate a test report and visually verify both fixes match the reference doc |

> ✅ Completed — commits `19e8034` + `393cfc1`. Both touch `backend/services/reportGenerator.js` only. Contact details split into two rows; `Ms.` prefix added to signatory names.

---

### SP1.P8 — F9: New Addition of Special Group — Water 10500 (Moved)

**Files**: Backend parameter/group routes, Admin seed scripts, `reportGenerator.js`

> Moved to SP2.P11. No code committed for this phase. Reference material in `/temp/report/`.

---

### SP1.P9 — F1: Job Hold

**Files**: `Job.js`, `JobsPage.jsx` (officer), `DispatcherPage.jsx`, `AssistantDashboard.jsx`, backend job routes

| Subphase | Task |
|---|---|
| SP1.P9.1 | **Model**: Add `ON_HOLD` to the `Job.js` status enum. Add an optional `holdReason` string field |
| SP1.P9.2 | **Backend — Hold route**: Create `POST /api/jobs/:id/hold`. Logic: set `job.status = 'ON_HOLD'`, clear `job.distribution.*.assignedHead` if not yet dispatched to analyst, record in `job.history` |
| SP1.P9.3 | **Backend — Recall from analysts**: If job was already dispatched, find all `TestInstance` documents for this job. Set their status to `HELD` (or equivalent). Do NOT clear `results`, `method`, or `notes` — preserve all progress |
| SP1.P9.4 | **Backend — ULR reservation decision**: If job has a `reservedUlrSlot` at hold time, **clear it**. The slot should not be held indefinitely. Document this in the route as a comment |
| SP1.P9.5 | **Backend — Unhold route**: Create `POST /api/jobs/:id/unhold`. Logic: set job status back to `PENDING_REVIEW` (back to officer/head queue). Emit socket event |
| SP1.P9.6 | **Socket events**: Emit `job:held` event on hold (with job ID). Head and analyst clients must listen and remove the job from their active views. Emit `job:unheld` on unhold |
| SP1.P9.7 | **Officer UI**: Add "Hold" button to the individual job card in `JobsPage.jsx`. Show only when job status is NOT already `ON_HOLD`, `COMPLETED`, or `CANCELLED`. Add a confirmation modal before triggering |
| SP1.P9.8 | **Officer UI — Held job state**: Show held jobs in the job list with a distinct "HELD" badge. Add "Release Hold" button on held job cards |
| SP1.P9.9 | **Head UI**: `DispatcherPage.jsx` — listen for `job:held` socket event and remove the job card from the dispatcher list in real-time |
| SP1.P9.10 | **Analyst UI**: `AssistantDashboard.jsx` — listen for `job:held` socket event and remove the affected task card. When job is later unheld and re-dispatched, prior saved progress is visible |
| SP1.P9.11 | **Test all stages**: hold a job at (a) officer stage, (b) head stage, (c) analyst stage. Verify correct recall behaviour at each |

> ✅ Completed — commits `7914545` + `3db94f1` (two passes). Files: `Job.js`, `TestInstance.js`, `jobCrudRoutes.js`, `jobListRoutes.js`, `jobWorkflowRoutes.js`, `testAssignmentRoutes.js`, `JobsPage.jsx`, `JobLogTable.jsx`, `JobTimeline.jsx`. Second pass added the socket listeners on DispatcherPage and AssistantDashboard that were missing from the first pass.

---

### SP1.P10 — F4: Multi-Job Dispatch to Single Analyst

**Files**: `frontend/src/pages/Head/DispatcherPage.jsx`, backend dispatch route

| Subphase | Task |
|---|---|
| SP1.P10.1 | Add a checkbox (or long-press on mobile) to each dispatcher job card to toggle multi-select mode |
| SP1.P10.2 | When 2+ jobs are selected, show a sticky bottom action bar: "Dispatch X jobs to…" with an analyst picker dropdown |
| SP1.P10.3 | The analyst picker in the action bar should show only analysts from the relevant department(s) of the selected jobs |
| SP1.P10.4 | On confirm: call `POST /api/jobs/bulk-dispatch` (new endpoint) with `{ jobIds: [...], analystId, deadline }` |
| SP1.P10.5 | Backend: iterate `jobIds`, for each job approve and create/update `TestInstance` documents assigning all parameters to `analystId` |
| SP1.P10.6 | Emit individual `job:dispatched` socket events for each job (not one bulk event — keeps existing listeners working) |
| SP1.P10.7 | Frontend: clear selection, show success toast for each dispatched job, refresh job list |
| SP1.P10.8 | Edge case: if one job in the bulk fails (e.g. already dispatched), report a partial failure without rolling back successful ones |
| SP1.P10.9 | Verify on mobile — the bottom action bar must not obstruct the job list and must be easily dismissible |

> ✅ Completed — commit `7f8bb8c`. Files: `testAssignmentRoutes.js` (+17 lines, bulk-dispatch endpoint) and `DispatcherPage.jsx` (+302 lines, multi-select UI). Note: the endpoint was added directly to `testAssignmentRoutes.js`, not as a separate route file.

---

### SP1.P11 — F17: DB Export / Backup

**Files**: New backend route, Admin UI

> A one-click export button for the admin to download a full backup of all MongoDB collections as a single archive.

| Subphase | Task |
|---|---|
| SP1.P11.1 | **Backend route**: Create `GET /api/admin/export` (admin-only). Use `mongoose.connection.db.listCollections()` to enumerate all collections, then `find({})` on each to dump all documents |
| SP1.P11.2 | **Format**: Output as a single `.json` file using `EJSON.stringify` (preserves ObjectIds and Dates). Send with `Content-Disposition: attachment` header |
| SP1.P11.3 | **Filename**: Auto-generate as `FTL_LIMS_DD-MM-YYYY_ssmmHH.json` |
| SP1.P11.4 | **Frontend**: `Backup & Export` tab in `DataSettings.jsx`. Full-width animated progress bar (aesthetic), last-backup timestamp per user stored in DB (`User.lastBackupAt`), auto-fadeout after 5s |
| SP1.P11.5 | **Authorization**: Route is `protect + authorize('ADMIN', 'ADMIN_OFFICER', 'HEAD')` |
| SP1.P11.6 | **Timestamp persistence**: `lastBackupAt` stamped on the user document after each backup; returned in login response; displayed in the backup UI |

> ✅ Completed — commits `95c7a93`, `719db4a`, `393cfc1`, `8a52077` (iterative fixes). Files: `exportRoutes.js`, `DataSettings.jsx`, `User.js`, `authRoutes.js`, `api.js`. EJSON serialization; per-user `lastBackupAt` timestamp in DB + login response; animated UI. URL base fix (`api.js`) was a separate follow-up commit.

---

## SP2 — Core Stability (Active)

### SP2 — Core Stability
| Phase | ID | Title | Status |
|---|---|---|---|
| SP2.P1 | F14 | Cross-Analyst Reassign Duplication Bug | ⬜ Next |
| SP2.P2 | B1 | ULR Preview Label Fix (Concurrent Jobs) | ⬜ Upcoming |
| SP2.P3 | F8 | Toast System Overhaul | ⬜ Upcoming |
| SP2.P4 | F15 | Global Modal Daemon | ⬜ Upcoming |
| SP2.P5 | F13 | Analyst Reassignment History Tracking | ⬜ Upcoming |
| SP2.P6 | F2 | Head Pages — Search, Filter & Sort | ⬜ Upcoming |
| SP2.P7 | F16 | Hide Test Code Suffixes in UI | ⬜ Upcoming |
| SP2.P8 | F18 | Error Handling & Modal Overhaul | ⬜ Upcoming |
| SP2.P9 | F19 | Head Monitor Tab V1 — Cancel, Reassign & Live Progress | ⬜ Upcoming |
| SP2.P10 | F20 | Head Monitor Tab V2 — Param Split/Merge & Progress Snapshot | ⬜ Upcoming |
| SP2.P11 | F9 | New Addition of Special Group — Water 10500 | ⬜ Upcoming |

---

### SP2.P9 — F19: Head Monitor Tab V1 — Cancel, Reassign & Live Progress

**What it is:** A new **Monitor** tab on the Head dashboard that covers the intermediate state between Dispatch and Review. Once a job is dispatched, it lives here until the analyst submits it for review.

**Workflow position:**
```
Dispatch ──→ Monitor ──→ Review ─→ Done
            ↑____________|
       (cancel → re-dispatch)
```

**Actions available on each Monitor card:**
- **Cancel** — pulls the job back to the Dispatch queue. No re-approval needed. Head re-dispatches directly to any analyst.
- **Reassign** — swaps the entire job mid-flight to a different analyst. No cancel required.

**Data behaviour on Cancel or Reassign:**
- All of the previous analyst's saved results carry over to the new assignment.
- `isSaved` is reset to `false` on every carried-over param.
- The new analyst sees pre-filled values but **cannot submit** until they have explicitly re-saved every param (Submit button stays locked).
- The `TestInstance` is updated in-place: `assignedTo` changes, `results` carry over with `isSaved: false`, a `MONITOR_REASSIGN` or `MONITOR_CANCEL_REDISPATCH` entry is added to `reviewHistory`.
- A socket event removes the task from the old analyst's dashboard and delivers it to the new one.

**Progress view (per-param ticks):**
- Each Monitor card shows a per-param indicator: 🟢 saved / ⚪ not yet saved.
- Updates in real-time via socket whenever the analyst saves a param (`PARAM_SAVED` event).
- Head does NOT see the actual values — only completion status per param.

| Subphase | Task |
|---|---|
| SP2.P9.1 | **Backend — fetch route**: `GET /api/jobs/monitoring` (Head-scoped) — returns all jobs with status `DISPATCHED` or `PENDING_HEAD_REVIEW` for the head's department, populated with `TestInstance` data (assignedTo name, results `isSaved` array) |
| SP2.P9.2 | **Backend — cancel route**: `POST /api/jobs/:id/monitor-cancel` — resets job status to `APPROVED` (dispatch queue), sets `TestInstance.status` to `CANCELLED`, preserves all results data on the instance. Emits `job:monitor-cancelled` socket event |
| SP2.P9.3 | **Backend — reassign route**: `PUT /api/jobs/:id/monitor-reassign` with `{ newAnalystId }` — updates `TestInstance.assignedTo`, resets all `result.isSaved` to `false`, adds `reviewHistory` entry, emits `job:monitor-reassigned` |
| SP2.P9.4 | **Frontend — Monitor tab**: Add "Monitor" tab to Head dashboard between Dispatcher and Review Queue. Fetch via the monitoring route on mount |
| SP2.P9.5 | **Frontend — Monitor card**: Show job code, sample name, NABL badge, deadline indicator, analyst name, and per-param save ticks (🟢/⚪) |
| SP2.P9.6 | **Frontend — Cancel action**: Confirmation modal — "Cancel and return to dispatch? Analyst's saved progress will be preserved for the next assignment." On confirm, call monitor-cancel route; remove card from Monitor, job reappears in Dispatcher |
| SP2.P9.7 | **Frontend — Reassign action**: Inline analyst picker (same department). Confirmation: "Reassign [job code] from [Analyst A] to [Analyst B]? Saved progress will carry over but analyst B must re-save all params before submitting." On confirm, call monitor-reassign route |
| SP2.P9.8 | **Socket — analyst side**: `job:monitor-cancelled` — remove task card from old analyst's dashboard. `job:monitor-reassigned` — remove from old analyst, add to new analyst with pre-filled (but locked) results |
| SP2.P9.9 | **Socket — head side**: Listen for `PARAM_SAVED` events (emitted when analyst saves a param) — update the per-param tick on the corresponding Monitor card in real-time |
| SP2.P9.10 | **Analyst — pre-filled lock**: On a reassigned/re-dispatched task, pre-fill result values from carried-over data but set all `isSaved: false`. Submit button disabled until all params are re-saved. Display a subtle banner: "Results pre-filled from previous assignment — please review and save each parameter." |
| SP2.P9.11 | Verify on mobile — Monitor cards scroll cleanly, per-param ticks readable, Cancel/Reassign modals don't overflow |

---

### SP2.P10 — F20: Head Monitor Tab V2 — Param Split/Merge & Progress Snapshot

**What it adds on top of V1:** Advanced job manipulation from within the Monitor tab.

**Features:**
- **Param split** — Head moves specific params from analyst A's instance to analyst B (who already has an active instance). Instead of reassigning the whole job, only selected params migrate. Directly prevents the B10 duplicate-instance bug for future cases.
- **Param merge** — If two analysts both have instances for the same job, head can consolidate params from one into the other.
- **Progress snapshot** — On card expand, show a param-by-param breakdown including: param name, analyst assigned, save status, and (optionally) the method used — but NOT the result values.

**Data behaviour (same rules as V1):**
- Moved params carry over with `isSaved: false` on the receiving analyst's instance.
- Receiving analyst must re-save moved params before submitting.
- Source analyst's instance: moved params are cleared (`value: ''`, `isSaved: false`) to prevent the Approved bleed-through seen in B10.

| Subphase | Task |
|---|---|
| SP2.P10.1 | **Backend — split route**: `PUT /api/jobs/:id/monitor-split` with `{ fromAnalystId, toAnalystId, paramIds }` — removes `paramIds` from source `TestInstance`, injects them (blank, `isSaved: false`) into target `TestInstance` (or creates new if target has no instance). Updates both instances' `retestOnly` if applicable |
| SP2.P10.2 | **Frontend — split UI**: In Monitor card expand view, each param row shows which analyst has it + a "Move" button. Clicking opens an analyst picker for the target analyst |
| SP2.P10.3 | **Frontend — progress snapshot**: Expanded card view shows param-level breakdown: param name, assigned analyst, save tick, method name (if saved). No result values exposed to head |
| SP2.P10.4 | **Socket**: Emit `instance:params-split` — source analyst's task card removes moved params, target analyst's task card gains new params (pre-filled, locked) |
| SP2.P10.5 | Test: split 1 param from analyst A to analyst B who already has an active instance — verify no new TestInstance created, B10 scenario cannot recur |
| SP2.P10.6 | Test: split to an analyst with no existing instance — verify new instance IS created |
| SP2.P10.7 | Verify progress snapshot shows correct per-param data after a split |

### SP3 — UX Polish + Infrastructure
| Phase | ID | Title |
|---|---|---|
| SP3.P1 | B4 | Analyst Task Modal Visibility (Narrow) |
| SP3.P2 | B7 | Cancellation Modal Sentence Rework |
| SP3.P3 | **B8** | **Retest Route Auth Typo (Prod Blocker)** | ✅ Done |
| SP3.P4 | **B9** | **Job Edit Wipes Parameters on Completed-Chemical Jobs** |
| SP3.P5 | **B10** | **Selective Reassign Creates Duplicate TestInstance** |
| SP3.P6 | C2 | Clean Up `/temp` |
| SP3.P7 | C3 | HTTP Compression Middleware |
| SP3.P8 | C4 | MongoDB Connection Pool Tuning |
| SP3.P9 | C5 | Scope 50mb JSON Body Limit |
| SP3.P10 | C6 | Socket.IO Auth Scope |
| SP3.P11 | F7 | Dashboard History Revamp |
| SP3.P12 | F3 | Transfer List Rework |
| SP3.P13 | F6 | Job Grouping in Officer's Page |

---

### SP3.P3 — B8: Retest Route Auth Typo (Prod Blocker)

**File**: `backend/routes/jobs/jobWorkflowRoutes.js` (lines 160, 165)

**Affected roles**: ADMIN_OFFICER (completely blocked from creating retest jobs)

**Symptom (Image 1)**: Officer opens a returned job, fills in the retest form, clicks submit. A browser `alert()` fires: `"Error saving job: User role ADMIN_OFFICER is not authorized to access this route"`. The button shows `Processing...` and never resolves. This is NOT a token/session expiry issue — the token is valid, the role check itself is wrong.

**Root cause — two typos on the same route:**

Typo 1 — Auth guard (`jobWorkflowRoutes.js:160`):
```js
// BROKEN (current):
router.post('/:id/retest', protect, authorize('AMIN_OFFIC'), async (req, res) => {
// CORRECT:
router.post('/:id/retest', protect, authorize('ADMIN_OFFICER'), async (req, res) => {
```
`roleMiddleware.js` does `roles.includes(req.user.role)`. `'ADMIN_OFFICER'` is not in `['AMIN_OFFIC']`, so it always returns 403. The frontend's `handleSubmit` catch block (JobsPage.jsx:811–814) catches this HTTP 403 and shows it via `alert()`.

Typo 2 — Variable name crash (`jobWorkflowRoutes.js:165`):
```js
// BROKEN (current):
const rootJobId = parentJob.isRetest ? parob.parentJobId : parentJob._id;
// CORRECT:
const rootJobId = parentJob.isRetest ? parentJob.parentJobId : parentJob._id;
```
`parob` is not defined anywhere — this would throw a `ReferenceError` and return a 500 even if the auth typo were fixed and the job IS a retest (second-generation retest). The route would silently fail on any retest-of-retest scenario.

**Flow context**: The retest form in `JobsPage.jsx` calls the route via `reopenParentId` state (line 761–764). It sends the full job payload (customer, sample, compliance, parameters) to `POST /api/jobs/:parentId/retest`. The route creates a child Job document with `isRetest: true` + `parentJobId` linking back to the root, then marks parent instances as `REOPENED`.

**Why it wasn't caught locally**: The developer likely tested with an ADMIN account (which has broader access) or the route was written with a placeholder role string that was never corrected. The `authorize` middleware just does a string match — no compile-time check.

| Subphase | Task |
|---|---|
| SP3.P3.1 | `jobWorkflowRoutes.js` line 160: change `authorize('AMIN_OFFIC')` → `authorize('ADMIN_OFFICER')` | ✅ |
| SP3.P3.2 | `jobWorkflowRoutes.js` line 165: change `parob.parentJobId` → `parentJob.parentJobId` | ✅ |
| SP3.P3.3 | Verify locally: log in as ADMIN_OFFICER, open a completed job, trigger retest — confirm 201 response and new job appears in the list |
| SP3.P3.4 | Verify a retest-of-retest (chain): create retest → complete it → create another retest from it → confirm `rootJobId` resolves correctly via `parentJob.parentJobId` |
| SP3.P3.5 | Deploy to prod (`aitr-ftl-backend-lims.up.railway.app`) and confirm with the officer |

---

### SP3.P4 — B9: Job Edit Wipes Parameters on Completed-Chemical Jobs

**Files**: `frontend/src/pages/AdminOfficer/JobsPage.jsx` (primary), `backend/routes/jobs/jobCrudRoutes.js:795`

**Affected roles**: ADMIN_OFFICER

**Symptom (Image 2)**: Officer opens job `2608251742` (created 2026-08-25) in edit mode. The "Test Parameters" section shows `-- Add Group --` with no parameters listed — as if the job has 0 parameters. The ULR field `TC-124342600000243` is visible, meaning the job loaded fine, but the parameter selector hydration failed silently.

**Context — what the micro head did**: The micro head dispatched something for this job (user reported this). The job's DB state at time of bug:
- `jobCode: 2608251742` (NABL, 7 chemical params) + sibling `2608251742-N` (Non-NABL, 2 params)
- `chemical.status: COMPLETED`, `micro.required: false`, `micro.status: PENDING`
- Chemical test instances: `2608251742-2a` (Ajay, 2 params, COMPLETED, had 1 REASSIGN + APPROVE), `2608251742-2b` (Om Prakash, 3 params, COMPLETED), `2608251742-2c` (Diksha, 2 params, COMPLETED)
- The job edit form is accessible because `micro` is not done — the immutability guard (`isMicroDone && isChemicalDone`) only blocks if BOTH are done

**Root cause — populated parameterId shape mismatch:**

The `GET /api/jobs/:id` route (`jobCrudRoutes.js:795`) populates `parameters.parameterId`:
```js
const job = await Job.findById(req.params.id)
  .populate('parameters.parameterId', 'name unit type _id');
```
This means `job.parameters[i].parameterId` in the API response is an **object** `{ _id, name, type, unit }`, NOT a plain string ID.

The `JobsPage.jsx` hydration `useEffect` (triggered when `editingJobId` is set) reads `job.parameters` and builds `selectedParams`. If the hydration code does something like:
```js
setSelectedParams(job.parameters.map(p => ({ ...p, _id: p.parameterId })))
```
...it sets `_id` to the full nested object. The `CascadingParameterSelector` then tries to match `p._id` or `p.parameterId` against its own parameter list (which uses plain string IDs), finds no matches, and renders nothing selected.

**Why it's intermittent / only on this job**: The bug likely affects ALL jobs opened for editing, but it's only reported now because this job is in a state where editing is still unlocked (micro pending) yet chemical is complete — which is unusual. Most edits happen before any department completes, where the user may not notice the hydration failure because they just re-select everything.

| Subphase | Task |
|---|---|
| SP3.P4.1 | In `JobsPage.jsx`, find the `useEffect` / `handleEditJob` function that sets `selectedParams`, `editingJobId`, etc. when the officer clicks "Edit" on a job card. Read the exact mapping from `job.parameters` → `selectedParams` |
| SP3.P4.2 | Identify whether `parameterId` is read as a plain string or as an object. Add defensive extraction: `const id = typeof p.parameterId === 'object' ? p.parameterId._id : p.parameterId` |
| SP3.P4.3 | Also extract `name`, `type`, `unit`, `specification` from the nested object when `parameterId` is populated: `const name = p.name || p.parameterId?.name || ''` |
| SP3.P4.4 | Ensure the hydrated array elements match the shape `CascadingParameterSelector` expects for `initialSelectedParams` — cross-check with `CascadingParameterSelector.jsx` line 24 (`useState(initialSelectedParams)`) |
| SP3.P4.5 | Handle both shapes (object and plain string) for backward compatibility with any cached/older data |
| SP3.P4.6 | Test on a fresh local job: create → dispatch → open edit → confirm parameters show selected |
| SP3.P4.7 | Test on prod job `2608251742` (`_id: 6a8d7c7d386517f8a79e4758`): open edit, confirm all 7 parameters (Moisture, Total Ash on Dry Basis, Ash Insoluble in dilute HCl, Presence of Chromate, Curcumin content, Volatile Oil Content, Starch Content) show as selected |

---

### SP3.P5 — B10: Selective Reassign Creates Duplicate TestInstance

**File**: `backend/routes/tests/testResultRoutes.js` (lines 208–297)

**Affected roles**: HEAD (triggers it), ASSISTANT/analyst (sees the effect)

**Symptoms (Images 3 & 4)**:
- Image 3 (Analyst A — Diksha's dashboard): Shows `Test Parameters (2)` with "Acidity inorganic" as an active retest field AND "Total Ash" marked `✓ Approved`. The approved value bleeds through even though it was meant to go to another analyst for retesting.
- Image 4 (Analyst B — appears to be another analyst's dashboard): Shows **two separate cards** for the same job — `Job 2607281695` and `Job 2607281695-2b-Rzua7`, both `Pending`, both dated `27/8/2026`. This is impossible by design — one job should only produce one instance per analyst per department.

**Exact DB state confirmed (local DB, job `2607281695`, `_id: 6a68856dc14ac530032fc240`):**

| testCode | status | assignedTo | paramCount | retestOnly | parentInstanceId | reviewHistory |
|---|---|---|---|---|---|---|
| `2607281695-2a` | PENDING | Diksha Dwivedi | 2 | `[density_id, water_id]` | null | [REASSIGN] |
| `2607281695-2b` | PENDING | Vishal Deshmukh | 2 | `[acidity_id]` | null | [REASSIGN] |
| `2607281695-2b-Rzua7` | PENDING | Diksha Dwivedi | 1 | `[total_ash_id]` | → points to `-2b` | [] |

Job has `chemical.status: ASSIGNED_TO_ASSISTANT`. Param IDs:
- `Density at 15°c` → `6a6875afc14ac530032fc23a`
- `Water Content (soluble water)` → `6a687649c14ac530032fc23c`
- `Acidity inorganic` → `6a687698c14ac530032fc23d`
- `Total Ash` → `6a75bd07c14ac53003339880`

**Full flow trace that caused the bug:**

1. HEAD (Monika Pali) dispatched 4 chemical params to 2 analysts: Diksha got `2607281695-2a` (2 params: Density, Water Content), Vishal got `2607281695-2b` (2 params: Acidity, Total Ash).
2. Vishal submitted `2607281695-2b` → status: `PENDING_HEAD_REVIEW`.
3. HEAD reviewed and chose **selective REASSIGN** with `selectedParams`:
   - Acidity inorganic → reassign back to Vishal (original analyst)
   - Total Ash → reassign to Diksha (different analyst)
4. This entered the **complex multi-analyst REASSIGN branch** in `testResultRoutes.js:208`.
5. For Vishal (original analyst): `retestOnly = [acidity_id]`, results updated, status → PENDING. ✅ Correct.
6. For Diksha (different analyst, line ~253): the code runs:
   ```js
   const subInstance = new TestInstance({
     testCode: `${instance.testCode}-R${Date.now().toString(36).slice(-4)}`, // → '2607281695-2b-Rzua7'
     assignedTo: diksha_id,
     results: [{ total_ash_param, value: '', isSaved: false }],
     retestOnly: [total_ash_id],
     parentInstanceId: instance._id  // links to -2b
   });
   await subInstance.save();
   ```
   **The code never checks if Diksha already has `2607281695-2a` active.** It unconditionally spawns a new instance. Now Diksha has TWO: `2607281695-2a` (her original 2 params) and `2607281695-2b-Rzua7` (the new 1 param).

**The "Approved" bleed-through (Image 3):**

`2607281695-2b`'s `results` array was saved with `Total Ash` having `isSaved: true` and a real value (from Vishal's original submission). When the selective reassign marks `retestOnly = [acidity_id]` on this instance, the frontend (`AssistantDashboard.jsx`) renders params: if `retestOnly` is non-empty, params NOT in `retestOnly` are shown as `✓ Approved` using their existing `isSaved + value`. Since Total Ash (`total_ash_id`) is NOT in `retestOnly` on instance `-2b`, it shows as Approved — even though the HEAD intended it to go to Diksha. The Head's intent and the instance data are now desynchronised.

**The correct fix** — two changes in `testResultRoutes.js`:

1. **Prevent duplicate creation**: Before `new TestInstance(...)` for a non-original analyst, check for an existing active instance for that analyst+job+dept. If found, UPDATE it instead of creating new.
2. **Fix result bleed**: When removing params from the original instance (sending them to another analyst), also clear those param values from the original instance's results (`value: '', isSaved: false`) so they don't show as Approved.

**Data fix needed (local DB)**: Cancel `2607281695-2b-Rzua7` (orphan) and merge its `Total Ash` param into `2607281695-2a`'s `retestOnly` + `results`.

| Subphase | Task |
|---|---|
| SP3.P5.1 | Read `testResultRoutes.js` lines 208–297 (the full complex REASSIGN branch) before touching anything |
| SP3.P5.2 | In the `for (const [analystId, paramIds] of Object.entries(byAnalyst))` loop (line ~254), before `new TestInstance(...)`, add: `const existingInstance = await TestInstance.findOne({ jobId: instance.jobId, assignedTo: analystId, department: instance.department, status: { $in: ['PENDING', 'PENDING_HEAD_REVIEW'] } })` |
| SP3.P5.3 | If `existingInstance` found: push new `paramIds` into `existingInstance.retestOnly` (deduped), inject blank `results` entries for params not already present, keep status `PENDING`, save. Skip `new TestInstance`. |
| SP3.P5.4 | If no `existingInstance`: proceed with `new TestInstance(...)` as before (unchanged code path) |
| SP3.P5.5 | Fix Approved bleed: in the original-analyst branch (lines ~211–234) AND in the "no params for original" branch (lines ~240–251), when removing params that go to other analysts, clear those params from `instance.results`: `value: ''`, `isSaved: false`, `testMethod: ''` — so the frontend stops rendering them as Approved |
| SP3.P5.6 | One-off data fix on local DB: set `2607281695-2b-Rzua7` status → `CANCELLED`; add `total_ash_id` to `2607281695-2a.retestOnly`; inject blank Total Ash entry into `2607281695-2a.results` if not present. Write this as a script in `/temp/` |
| SP3.P5.7 | Test: dispatch job to 2 analysts → one submits → HEAD selective-reassigns 1 param to the OTHER analyst who already has an active instance → verify only 1 instance per analyst exists, no new testCode created |
| SP3.P5.8 | Test: selective-reassign to a brand-new analyst (not previously dispatched to) → verify new instance IS created (this path must still work) |
| SP3.P5.9 | Test Approved display: after partial reassign, the retained params on the original instance must show as Approved only if they were genuinely approved (not if they were just submitted) |

### SP4 — Documentation
| Phase | ID | Title |
|---|---|---|
| SP4.P1 | F11 | Comprehensive Documentation |

### SP5 — Planned for Future
| Phase | ID | Title | Note |
|---|---|---|---|
| — | C1 | DB Schema Revision | Dedicated sprint only |
| — | C7 | Full UI Revamp | Only after feature freeze |
