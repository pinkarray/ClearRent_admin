// Alert taxonomy — shared by the Alerts feed and the attention banner.
//
// Severity is NOT a proxy for "is there work here". Several `info` alerts carry
// outstanding work (an inspection awaiting the handler's approval, a rental
// interest, an agreement waiting on the tenant), and several `warning` ones are
// pure oversight. Both readers classify by type + meta.state instead, so that
// nothing with an open case can be swept away in bulk.

export interface AdminAlert {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  targetCollection?: string;
  targetId?: string;
  actors?: { tenantId?: string; agentId?: string; landlordId?: string };
  meta?: Record<string, unknown>;
  createdAt: Date | null;
}

// Types a Cloud Function closes for us (resolveAdminAlertsForTarget) once the
// admin acts on the dedicated page. Dismissing these by hand would clear the
// notice while the case stays open, so the feed offers no Dismiss at all.
export const RESOLVE_ON_PAGE: Record<string, string> = {
  inspection_dispute: "Inspection Reviews",
  rent_change_request: "Rent Reviews",
  // resolvePayoutDispute closes this alert itself once evidence is attached,
  // so it must not be dismissable from the feed — dismissing would hide money
  // someone says they never received while the dispute is still open.
  payout_disputed: "Rent Payouts",
};

// `inspection_lifecycle` is a single upserted doc per inspection that walks
// through meta.state, re-opening on every transition. Only these two states owe
// a handler decision — and neither re-opens on its own, because the approval
// *is* the next transition. The rest (requested_unpaid waits on the tenant;
// approved/declined/cancelled/completed are just the record) are safe to clear:
// if anything more happens, the upsert brings the alert back.
const LIFECYCLE_PENDING = new Set(["requested", "paid"]);

// Types that carry open work but have no auto-close — a human decides when
// they're done. They keep a manual Dismiss (nothing else can ever close them)
// but stay out of "Dismiss all", and the card says so.
const PENDING_WORK = new Set([
  "rental_interest",
  "agreement_ready",
  "agreement_disputed",
  "verification_submitted",
  "issue_reported",
  "issue_fix_disputed",
  "issue_pending_stale",
]);

/** True when the alert stands for an unresolved case, not just a record of one. */
export function hasOpenWork(a: AdminAlert): boolean {
  if (RESOLVE_ON_PAGE[a.type]) return true;
  if (a.type === "inspection_lifecycle") {
    return LIFECYCLE_PENDING.has(String(a.meta?.state ?? ""));
  }
  return PENDING_WORK.has(a.type);
}

/**
 * Routine info — nothing to act on, so it's safe to clear in bulk. The
 * attention banner counts the exact inverse: everything that isn't this needs
 * a human, whatever its severity says.
 */
export function isRoutineInfo(a: AdminAlert): boolean {
  return a.severity === "info" && !hasOpenWork(a);
}
