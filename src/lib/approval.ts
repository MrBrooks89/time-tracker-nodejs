// Pure approval-workflow domain rules (Phase 4). Mirrors plan decisions:
// D2 — no self-approval; admin approves manager (self-managed) sheets.
// D3 — unmanaged partners (null managerId) are approved by admin.
// D4 — rejection sends the sheet back to the partner (in_correction).
// Server actions compose these helpers; this module stays side-effect free.

export type SheetState =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "in_correction"
  | "approved"
  | "locked";

// Section 1.4: all roles fit the viewer type, but isApproverRole keeps the
// decision rights limited to admin/manager (new roles never approve).
export type ViewerRole =
  | "admin"
  | "manager"
  | "employee"
  | "finance_viewer"
  | "leadership"
  | "project_manager";

function isApproverRole(role: ViewerRole): boolean {
  return role === "manager" || role === "admin";
}

// Admin owns approval when the sheet belongs to a self-managed manager (D2)
// or to an unmanaged partner (D3). Employee sheets with a real manager stay
// with that manager.
function isAdminApproverFor(
  sheetUserId: string,
  sheetManagerId: string | null,
): boolean {
  return sheetManagerId === null || sheetManagerId === sheetUserId;
}

export function canApprove(
  sheetState: SheetState,
  viewerRole: ViewerRole,
  viewerId: string,
  sheetUserId: string,
  sheetManagerId: string | null,
): boolean {
  if (!isApproverRole(viewerRole)) return false;
  // Only submitted sheets await a decision; in_correction sheets must be
  // resubmitted first, and approved/locked sheets are already settled.
  if (sheetState !== "submitted") return false;
  // D2: nobody approves their own sheet, admin included.
  if (viewerId === sheetUserId) return false;
  if (viewerRole === "manager") {
    return sheetManagerId === viewerId;
  }
  return isAdminApproverFor(sheetUserId, sheetManagerId);
}

export function nextStateOnApprove(): SheetState {
  return "approved";
}

// D4: rejection returns the sheet to the partner for fixes.
export function nextStateOnReject(): SheetState {
  return "in_correction";
}

export function isApprovalComplete(state: SheetState): boolean {
  return state === "approved" || state === "locked";
}

// D3: sheets without a manager fall back to admin as effective approver.
export function effectiveApprover(managerId: string | null): string {
  return managerId ?? "admin";
}
