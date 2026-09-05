# User Acceptance Testing Plan
## Assembly Workflow Tracker

| Field | Value |
|---|---|
| **Build** | v11 (post-Phase 11 hardening sweep) |
| **Environment** | _____________________ (staging / production) |
| **Tester name** | _____________________ |
| **Test date** | _____________________ |
| **AUTH_ENABLED** | ☐ false (legacy identity) &nbsp;&nbsp; ☐ true (Supabase Auth) — *confirm which before starting; several tests below only apply in one mode, marked accordingly* |

**Instructions:** Run tests in order within each section — several depend on state created by earlier tests in the same section (e.g. Stage Movement tests require the job created in Job Creation). Check the Pass or Fail box for each test. Any Fail must include a note describing what actually happened, not just that it failed.

---

## 1. Job Creation

### UAT-JOB-01 — Create a job with all fields
**Steps:**
1. Open the Dashboard tab.
2. Tap **New Job**.
3. Enter a unique job number (e.g. `UAT-001`), customer name, description, due date, and priority.
4. Save.

**Expected behavior:** Job appears immediately on the Dashboard job list, in the "Ready for Assembly" stage, 0% complete, with the entered due date and priority shown.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-JOB-02 — Duplicate job number is rejected
**Steps:**
1. Attempt to create a second job using the **same job number** as UAT-JOB-01 (`UAT-001`).

**Expected behavior:** Save is rejected with a clear message that the job number already exists. No duplicate job is created.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-JOB-03 — Edit an existing job
**Steps:**
1. Open `UAT-001`.
2. Change the customer name and due date.
3. Save.

**Expected behavior:** Changes are reflected immediately on the Dashboard and in the job detail view. An entry appears in the Activity tab for the edit.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-JOB-04 — Delete a job
**Steps:**
1. Open `UAT-001`, delete it, confirm the delete dialog.
2. **Hard refresh the page** (not just navigate away and back).

**Expected behavior:** Job disappears immediately, and **remains gone after the hard refresh.** *(This specific check matters — a bug where deletion only removed the job from local view but not the database was found and fixed in Phase 11; confirming it survives a refresh is the real test.)*

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

## 2. Assignment

*Create a fresh job `UAT-002` for this section before starting.*

### UAT-ASSIGN-01 — Lead assigns a job to a team member
**Steps (as a Lead or Admin):**
1. Open `UAT-002`.
2. Assign it to a specific team member.

**Expected behavior:** Assignee's name appears on the job card and detail view.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-ASSIGN-02 — Assembler cannot assign jobs *(AUTH_ENABLED=true only)*
**Steps (signed in as an Assembler):**
1. Attempt to change `UAT-002`'s assignment.

**Expected behavior:** The action is rejected (either the option isn't available, or attempting it produces a permission-denied message). The job's assignment does not change.

☐ Pass &nbsp;&nbsp; ☐ Fail &nbsp;&nbsp; ☐ N/A (AUTH_ENABLED=false) — Notes: _______________________________________________

---

## 3. Stage Movement

*Use `UAT-002`, assigned to the assembler account you'll test with.*

### UAT-STAGE-01 — Forward move blocked by incomplete checklist
**Steps:**
1. Open `UAT-002` (currently "Ready for Assembly," checklist not started).
2. Attempt to advance to the next stage ("Layout") without completing the checklist.

**Expected behavior:** The move is blocked with a message referencing the incomplete checklist. The job remains in "Ready for Assembly."

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-STAGE-02 — Forward move succeeds once checklist is complete
**Steps:**
1. Complete every checklist item for the current stage.
2. Advance to the next stage.

**Expected behavior:** Move succeeds. Job now shows "Layout" as its stage.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-STAGE-03 — Cannot skip stages
**Steps:**
1. With `UAT-002` in "Layout," use **Move…** to attempt jumping directly to "Testing" (skipping Bearings, Drive, Final Assembly).

**Expected behavior:** Rejected with a message that stages can't be skipped. Job remains in "Layout."

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-STAGE-04 — Backward move (correction) is always allowed
**Steps:**
1. With `UAT-002` in "Layout," move it backward to "Ready for Assembly."

**Expected behavior:** Succeeds immediately, no checklist requirement enforced for backward moves.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-STAGE-05 — Drag-and-drop on the Kanban board respects the same rules
**Steps:**
1. On the Board tab, drag `UAT-002`'s card forward by one column with its checklist incomplete.

**Expected behavior:** Same rejection as UAT-STAGE-01 — dragging is not a way around the gate.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

## 4. Checklists

### UAT-CHK-01 — Check off an item
**Steps:**
1. Open a job in an active stage.
2. Tap an unchecked checklist item.

**Expected behavior:** Item shows as checked immediately. Progress indicator (e.g. "3/5") updates.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-CHK-02 — Uncheck an item
**Steps:**
1. Tap a previously-checked item to uncheck it.

**Expected behavior:** Item returns to unchecked. If this was the last completed item needed to advance, a subsequent stage-advance attempt should now be blocked again.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-CHK-03 — Checklist items are logged
**Steps:**
1. Check one item, then view the Activity tab.

**Expected behavior:** An entry appears naming the specific checklist item, not just "checklist changed."

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

## 5. Blueprint Extraction

*This section covers a code path fixed in Phase 11 — the file picker previously threw an error on selection. Confirming it works at all is itself part of the test, not just a formality.*

### UAT-BP-01 — Select and scan a blueprint on an existing job
**Steps:**
1. Open a job → Blueprint section.
2. Tap to select a blueprint image or PDF.
3. Confirm the file picker opens and accepts a file **without an error appearing.**
4. Run the extraction.

**Expected behavior:** File selection works with no error. Extraction completes and shows a component list, an engineering data panel, and a confidence percentage.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-BP-02 — Create a new job from a blueprint scan
**Steps:**
1. From the Dashboard, choose **New Job from Blueprint**.
2. Select and scan a drawing.
3. Review the pre-filled job form (job number, customer read from the title block).
4. Save.

**Expected behavior:** Job is created with the scanned spec/BOM attached — confirm by reopening the job and seeing the blueprint data present (not just an empty job with no blueprint).

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-BP-03 — Drive/tail component classification
**Steps:**
1. Scan a drawing that includes both drive-end and tail-end hardware (e.g. bearings/shafts at both ends).
2. Review the extracted component list, grouped by subassembly.

**Expected behavior:** Drive-end and tail-end components appear under distinct, correctly-labeled groups — not merged into one generic "bearings" bucket, and not swapped (a drive-end bearing should not appear grouped under tail-end or vice versa).

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-BP-04 — Low-confidence extraction is flagged, not silently accepted
**Steps:**
1. Scan a low-quality or partially-illegible drawing (blurry photo, poor lighting).

**Expected behavior:** Extraction still completes but shows a lower confidence score and a **"review required"** status rather than being silently marked approved.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

## 6. Blueprint Review

### UAT-REV-01 — Approve a blueprint extraction (Lead/Admin)
**Steps (signed in as Lead or Admin):**
1. Open a job with a `review_required` blueprint extraction.
2. Tap **Approve**.

**Expected behavior:** Status changes to "Approved." An entry appears in the Activity tab for the approval (this exact path was found missing and fixed in Phase 10 — confirm it's actually there).

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-REV-02 — Reject a blueprint extraction
**Steps (signed in as Lead or Admin):**
1. Open a job with a pending extraction.
2. Tap **Reject**.

**Expected behavior:** Status changes to "Rejected." Also logged to Activity.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-REV-03 — Assembler cannot approve/reject *(AUTH_ENABLED=true only)*
**Steps (signed in as Assembler):**
1. Attempt to approve or reject a blueprint extraction.

**Expected behavior:** Blocked — the action is unavailable or explicitly rejected.

☐ Pass &nbsp;&nbsp; ☐ Fail &nbsp;&nbsp; ☐ N/A (AUTH_ENABLED=false) — Notes: _______________________________________________

---

### UAT-REV-04 — Version history and comparison
**Steps:**
1. Re-scan the same job's blueprint a second time (creating version 2).
2. Open **Version History**.
3. Select both versions and tap **Compare**.

**Expected behavior:** Both versions listed with their own status/confidence. Comparison shows a clear diff of what dimensions or components changed between versions.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-REV-05 — The job uses the latest *approved* version, not just the latest scan
**Steps:**
1. With version 1 approved and version 2 (from UAT-REV-04) still pending review, check which spec/BOM the job detail view is actually showing.

**Expected behavior:** Job shows version 1's data (the approved one), not version 2's unapproved data, until version 2 is explicitly approved.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

## 7. Notes

### UAT-NOTE-01 — Add a job-specific note
**Steps:**
1. Open a job → Notes.
2. Add a Progress note with text.

**Expected behavior:** Note appears attached to the job, with type, date, and author shown.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-NOTE-02 — Add a shop-wide note (no job attached)
**Steps:**
1. From the Notes tab (not a specific job), add a note without selecting a job.

**Expected behavior:** Note is created and appears in the general Notes list without a job number attached.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-NOTE-03 — All three note types
**Steps:**
1. Create one note each of type Progress, Issue, and Next Steps.

**Expected behavior:** Each is visually distinguished (label/color) and all three appear correctly in the list.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

## 8. Blockers

### UAT-BLK-01 — Any signed-in user can report a blocker
**Steps (as an Assembler):**
1. Open a job → report a blocker with an issue description, severity, and department.

**Expected behavior:** Blocker is created and appears in the Blockers list and on the job.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-BLK-02 — Only Lead/Admin can resolve a blocker *(AUTH_ENABLED=true only)*
**Steps (as an Assembler):**
1. Attempt to mark a blocker "Resolved."

**Expected behavior:** Blocked. Switch to a Lead/Admin account and confirm the same action succeeds there.

☐ Pass &nbsp;&nbsp; ☐ Fail &nbsp;&nbsp; ☐ N/A (AUTH_ENABLED=false) — Notes: _______________________________________________

---

### UAT-BLK-03 — Delete a blocker and confirm it doesn't reappear
**Steps (as Lead/Admin):**
1. Delete a blocker.
2. **Hard refresh the page.**

**Expected behavior:** Blocker remains deleted after refresh. *(Same class of bug as UAT-JOB-04 — fixed in Phase 11 for this table too; the refresh check is the real test.)*

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

## 9. Auth

*Skip this entire section if AUTH_ENABLED=false; mark all as N/A.*

### UAT-AUTH-01 — Sign in with valid credentials
**Steps:**
1. Open the app with no existing session.
2. Enter a valid email/password.

**Expected behavior:** Login screen disappears, app loads normally.

☐ Pass &nbsp;&nbsp; ☐ Fail &nbsp;&nbsp; ☐ N/A — Notes: _______________________________________________

---

### UAT-AUTH-02 — Sign in with invalid credentials
**Steps:**
1. Enter an incorrect password.

**Expected behavior:** Clear error message. Login screen remains, app data is not loaded.

☐ Pass &nbsp;&nbsp; ☐ Fail &nbsp;&nbsp; ☐ N/A — Notes: _______________________________________________

---

### UAT-AUTH-03 — Session persists across a page reload
**Steps:**
1. Sign in successfully.
2. Hard refresh the page.

**Expected behavior:** No login screen on reload — session is restored automatically.

☐ Pass &nbsp;&nbsp; ☐ Fail &nbsp;&nbsp; ☐ N/A — Notes: _______________________________________________

---

### UAT-AUTH-04 — Sign out
**Steps:**
1. From Settings, sign out.

**Expected behavior:** Returns to the login screen. Reloading the page does not restore the session.

☐ Pass &nbsp;&nbsp; ☐ Fail &nbsp;&nbsp; ☐ N/A — Notes: _______________________________________________

---

### UAT-AUTH-05 — Password reset request
**Steps:**
1. From the login screen, tap **Forgot Password?**, enter an email.

**Expected behavior:** Confirmation message that a reset email was sent (verify the email actually arrives, separately).

☐ Pass &nbsp;&nbsp; ☐ Fail &nbsp;&nbsp; ☐ N/A — Notes: _______________________________________________

---

## 10. Roles

*Requires three test accounts: one per role. Skip if AUTH_ENABLED=false; mark all as N/A.*

### UAT-ROLE-01 — New signup defaults to Assembler
**Steps:**
1. Have an admin provision a brand-new account with no role specified.

**Expected behavior:** Account's role is "assembler" by default — never a higher role automatically.

☐ Pass &nbsp;&nbsp; ☐ Fail &nbsp;&nbsp; ☐ N/A — Notes: _______________________________________________

---

### UAT-ROLE-02 — Assembler is scoped to their own assigned jobs
**Steps (as an Assembler assigned to Job A, not Job B):**
1. Attempt to update progress/stage on Job A. Then attempt the same on Job B.

**Expected behavior:** Job A succeeds; Job B is blocked with a message indicating the job isn't assigned to them.

☐ Pass &nbsp;&nbsp; ☐ Fail &nbsp;&nbsp; ☐ N/A — Notes: _______________________________________________

---

### UAT-ROLE-03 — Assembler cannot change non-progress fields
**Steps (as an Assembler, on their own assigned job):**
1. Attempt to change the job's priority or customer.

**Expected behavior:** Blocked, even though it's their own assigned job — only progress-related updates are permitted.

☐ Pass &nbsp;&nbsp; ☐ Fail &nbsp;&nbsp; ☐ N/A — Notes: _______________________________________________

---

### UAT-ROLE-04 — Admin has unrestricted access
**Steps (as Admin):**
1. Create, assign, move, delete a job; approve a blueprint; resolve a blocker; change a user's role.

**Expected behavior:** All actions succeed without restriction.

☐ Pass &nbsp;&nbsp; ☐ Fail &nbsp;&nbsp; ☐ N/A — Notes: _______________________________________________

---

### UAT-ROLE-05 — A user cannot change their own role
**Steps (as any signed-in user, including Admin):**
1. Attempt to edit your own account's role directly.

**Expected behavior:** Blocked — role changes must come from a different admin account, never self-applied.

☐ Pass &nbsp;&nbsp; ☐ Fail &nbsp;&nbsp; ☐ N/A — Notes: _______________________________________________

---

## 11. Realtime Updates

*Requires two devices/browsers signed into the same shop simultaneously.*

### UAT-RT-01 — A job change on Device A appears on Device B without refreshing
**Steps:**
1. On Device A, move a job to a new stage.
2. On Device B (already open, no manual refresh), watch for the update.

**Expected behavior:** Device B's view updates within a few seconds automatically.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-RT-02 — A new blocker appears live on another device
**Steps:**
1. Device A reports a blocker.
2. Confirm it appears on Device B without refreshing.

**Expected behavior:** Same as above — automatic, no manual sync needed.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-RT-03 — Two devices editing different jobs concurrently
**Steps:**
1. Device A edits Job X. Device B simultaneously edits Job Y.

**Expected behavior:** Both edits succeed independently — neither device's change is lost or overwritten by the other.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-RT-04 — Reconnect after network loss
**Steps:**
1. On Device A, disable wifi/network for ~30 seconds, then re-enable it.
2. While Device A was offline, have Device B make a change.

**Expected behavior:** Device A reconnects automatically (check Health Dashboard → Realtime status) and picks up the change Device B made while it was offline, without requiring a manual page reload.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-RT-05 — Checklist changes are the one known gap
**Steps:**
1. Device A checks off a checklist item on a job Device B has open.
2. Watch Device B — do **not** refresh manually.

**Expected behavior:** Device B does **not** show the change live (this is a documented, known limitation — `job_checklist` has no realtime channel). It should appear after Device B's next natural reload or manual sync. **This is expected, not a bug** — check the box based on whether it matches this expected (non-live) behavior.

☐ Pass (matches known limitation) &nbsp;&nbsp; ☐ Fail (behaved differently than documented) — Notes: _______________________________________________

---

## 12. AI Actions

### UAT-AI-01 — Ask a question (no action taken)
**Steps:**
1. Open the AI Assistant tab.
2. Type a question (e.g. "which jobs are overdue?") and tap **Ask**.

**Expected behavior:** A text answer appears. Nothing in the app's data changes.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-AI-02 — Request an action shows a review card before doing anything
**Steps:**
1. Type a request like "move UAT-002 to layout" and tap **Do It** (not Ask).

**Expected behavior:** A review card appears describing the interpreted action **before anything happens**. Confirm the job has **not** yet moved by checking the Dashboard in another tab.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-AI-03 — Confirming executes the action
**Steps:**
1. From the review card in UAT-AI-02, tap **Confirm**.

**Expected behavior:** The job actually moves. A result card shows success. An Activity log entry appears tagged as AI-driven.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-AI-04 — Cancelling does not execute the action
**Steps:**
1. Request another action, but tap **Cancel** on the review card instead of Confirm.

**Expected behavior:** Nothing changes. No repository write occurs.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-AI-05 — AI cannot bypass the checklist gate
**Steps:**
1. On a job with an incomplete checklist, ask the AI to "move [job] to the final stage" (skipping stages).

**Expected behavior:** The review card shows this step as **blocked**, with a reason referencing the checklist/stage-skip rule — the same rule enforced everywhere else in the app. Confirming does not force it through.

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-AI-06 — Multi-step request
**Steps:**
1. Request something that implies several steps, e.g. "start UAT-002: assign it to me, move it to layout, and add a note that we're starting."

**Expected behavior:** The review card shows **multiple** distinct steps, each previewed separately. Confirming executes all of them in order (unless one is blocked, in which case execution stops at that step).

☐ Pass &nbsp;&nbsp; ☐ Fail — Notes: _______________________________________________

---

### UAT-AI-07 — AI action respects role permissions *(AUTH_ENABLED=true only)*
**Steps (signed in as an Assembler):**
1. Ask the AI to assign a job to someone (a Lead-only action).

**Expected behavior:** The review card shows this step as blocked due to insufficient permission — same enforcement as the equivalent manual UI action would get.

☐ Pass &nbsp;&nbsp; ☐ Fail &nbsp;&nbsp; ☐ N/A (AUTH_ENABLED=false) — Notes: _______________________________________________

---

## Sign-off

| Section | Total tests | Passed | Failed | N/A |
|---|---|---|---|---|
| 1. Job Creation | 4 | | | |
| 2. Assignment | 2 | | | |
| 3. Stage Movement | 5 | | | |
| 4. Checklists | 3 | | | |
| 5. Blueprint Extraction | 4 | | | |
| 6. Blueprint Review | 5 | | | |
| 7. Notes | 3 | | | |
| 8. Blockers | 3 | | | |
| 9. Auth | 5 | | | |
| 10. Roles | 5 | | | |
| 11. Realtime Updates | 5 | | | |
| 12. AI Actions | 7 | | | |
| **Total** | **51** | | | |

**Overall result:** ☐ Approved for production deployment &nbsp;&nbsp; ☐ Blocked — failures require resolution first

**Tester signature:** _____________________ &nbsp;&nbsp; **Date:** _____________________

**Notes on any failed test must reference the specific UAT ID (e.g. "UAT-JOB-04 failed") so it can be traced back to this document during follow-up.**
