import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canApprove,
  effectiveApprover,
  isApprovalComplete,
  nextStateOnApprove,
  nextStateOnReject,
} from "./approval.ts";

const MANAGER = "mgr-1";
const ADMIN = "admin-1";
const PARTNER = "partner-1";

test("canApprove: manager approves direct report's submitted sheet", () => {
  assert.equal(
    canApprove("submitted", "manager", MANAGER, PARTNER, MANAGER),
    true,
  );
});

test("canApprove: only submitted sheets are approvable", () => {
  for (const state of [
    "not_started",
    "in_progress",
    "in_correction",
    "approved",
    "locked",
  ] as const) {
    assert.equal(
      canApprove(state, "manager", MANAGER, PARTNER, MANAGER),
      false,
      state,
    );
  }
  assert.equal(
    canApprove("submitted", "manager", MANAGER, PARTNER, MANAGER),
    true,
  );
});

test("D2: self-approval blocked for manager and admin", () => {
  // Manager viewing their own submitted sheet.
  assert.equal(
    canApprove("submitted", "manager", MANAGER, MANAGER, MANAGER),
    false,
  );
  // Admin viewing their own submitted sheet (admin is self-managed).
  assert.equal(
    canApprove("submitted", "admin", ADMIN, ADMIN, ADMIN),
    false,
  );
});

test("canApprove: manager cannot approve a non-report's sheet", () => {
  // Sheet belongs to a partner managed by someone else.
  assert.equal(
    canApprove("submitted", "manager", "mgr-2", PARTNER, MANAGER),
    false,
  );
  // Unmanaged partner (D3) is admin's responsibility, not a manager's.
  assert.equal(
    canApprove("submitted", "manager", MANAGER, PARTNER, null),
    false,
  );
});

test("D2: admin approves self-managed manager's sheet", () => {
  // Managers are self-managed in seed, so admin is their approver.
  assert.equal(
    canApprove("submitted", "admin", ADMIN, MANAGER, MANAGER),
    true,
  );
});

test("D3: admin approves unmanaged partner's sheet", () => {
  assert.equal(
    canApprove("submitted", "admin", ADMIN, PARTNER, null),
    true,
  );
});

test("canApprove: admin cannot approve an employee sheet with a real manager", () => {
  // Employee sheets belong to their manager, not admin.
  assert.equal(
    canApprove("submitted", "admin", ADMIN, PARTNER, MANAGER),
    false,
  );
});

test("canApprove: employees can never approve", () => {
  assert.equal(
    canApprove("submitted", "employee", PARTNER, PARTNER, MANAGER),
    false,
  );
  assert.equal(
    canApprove("submitted", "employee", "partner-2", PARTNER, MANAGER),
    false,
  );
});

test("state transitions: approve → approved, reject → in_correction", () => {
  assert.equal(nextStateOnApprove(), "approved");
  assert.equal(nextStateOnReject(), "in_correction");
});

test("re-approve after correction: reject → in_correction → resubmit → approve", () => {
  // Manager rejects: sheet goes back to the partner (D4).
  const rejected = nextStateOnReject();
  assert.equal(rejected, "in_correction");
  // While in correction there is nothing to approve yet.
  assert.equal(
    canApprove(rejected, "manager", MANAGER, PARTNER, MANAGER),
    false,
  );
  // Partner fixes and resubmits → back to submitted → approvable again.
  const resubmitted = "submitted" as const;
  assert.equal(
    canApprove(resubmitted, "manager", MANAGER, PARTNER, MANAGER),
    true,
  );
  assert.equal(nextStateOnApprove(), "approved");
  assert.equal(isApprovalComplete("approved"), true);
});

test("isApprovalComplete: true for approved/locked, false otherwise", () => {
  assert.equal(isApprovalComplete("approved"), true);
  assert.equal(isApprovalComplete("locked"), true);
  for (const state of [
    "not_started",
    "in_progress",
    "submitted",
    "in_correction",
  ] as const) {
    assert.equal(isApprovalComplete(state), false, state);
  }
});

test("effectiveApprover: null manager → admin (D3), otherwise manager id", () => {
  assert.equal(effectiveApprover(null), "admin");
  assert.equal(effectiveApprover(MANAGER), MANAGER);
});
