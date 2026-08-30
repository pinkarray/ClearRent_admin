"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { cn, timeAgo } from "@/lib/utils";
import {
  AdminAlert,
  RESOLVE_ON_PAGE,
  hasOpenWork,
  isRoutineInfo,
} from "@/lib/alerts";
import {
  Bell,
  Flag,
  TrendingUp,
  Banknote,
  AlertTriangle,
  UserCog,
  FileWarning,
  DoorOpen,
  CalendarClock,
  ClipboardList,
  ArrowRight,
  Check,
  CheckCheck,
  Loader2,
  UserPlus,
  ShieldCheck,
  HeartHandshake,
  FileSignature,
  HandCoins,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

function toDate(v: unknown): Date | null {
  if (v instanceof Timestamp) return v.toDate();
  return null;
}

// Icon + landing route per alert type. A null route means there's no dedicated
// page to act on it — the admin just reviews + resolves it here.
// Alerts about a stalled move-out, where the useful action is chasing a party
// rather than acknowledging the alert.
const HANDOVER_ALERTS = new Set([
  "rental_end_contested",
  "handover_settlement_contested",
]);

const TYPE_META: Record<
  string,
  { icon: typeof Bell; route: (a: AdminAlert) => string | null }
> = {
  inspection_dispute: {
    icon: Flag,
    route: () => "/dashboard/inspection-reviews",
  },
  inspection_lifecycle: {
    icon: ClipboardList,
    route: () => "/dashboard/inspections",
  },
  inspection_today_digest: {
    icon: CalendarClock,
    route: () => "/dashboard/inspections",
  },
  rent_change_request: {
    icon: TrendingUp,
    route: () => "/dashboard/rent-reviews",
  },
  rent_payment: { icon: Banknote, route: () => "/dashboard/rent-payouts" },
  // A landlord or agent reporting that a payout we marked "sent" never landed.
  // Worked from Rent Payouts, which is where the evidence is attached and the
  // dispute resolved.
  payout_disputed: {
    icon: HandCoins,
    route: () => "/dashboard/rent-payouts",
  },
  // Nobody ever answered "did it arrive?". Not a dispute — but after 10 days
  // of silence the transfer is worth checking, because an unanswered payout
  // and a failed one look identical from here.
  payout_unconfirmed: {
    icon: HandCoins,
    route: () => "/dashboard/rent-payouts",
  },
  issue_reported: { icon: AlertTriangle, route: () => "/dashboard/issues" },
  issue_fix_disputed: { icon: AlertTriangle, route: () => "/dashboard/issues" },
  issue_pending_stale: { icon: AlertTriangle, route: () => "/dashboard/issues" },
  profile_identity_change: {
    icon: UserCog,
    route: (a) => (a.targetId ? `/dashboard/users/${a.targetId}` : null),
  },
  // Both agreement states are worked from Rent Attention: it lists disputed
  // agreements (with force-finalize) and the ones still waiting on the tenant.
  agreement_disputed: {
    icon: FileWarning,
    route: () => "/dashboard/rent-attention",
  },
  // A tenant contradicting a landlord's "terms only" declaration. Same
  // destination as agreement_disputed — the flag sets agreementStatus to
  // 'disputed', so that is exactly where the tenancy surfaces — but it needs
  // its own entry or the most serious alert the platform can raise renders
  // with a generic bell and no way to click through to it.
  agreement_rent_mismatch: {
    icon: TrendingUp,
    route: () => "/dashboard/rent-attention",
  },
  rental_end_contested: { icon: DoorOpen, route: () => null },
  // The tenant says the caution deposit never reached them. Distinct from
  // contesting the tenancy END: this one is about money, and the unit stays
  // off the market until it resolves — the silence sweep will not close a
  // contested handover, so nothing here times out on its own.
  handover_settlement_contested: { icon: DoorOpen, route: () => null },

  // Pipeline events. Previously these had no producer at all, so an admin
  // learned about a waiting verification only by opening the users queue.
  user_signed_up: {
    icon: UserPlus,
    route: (a) => (a.targetId ? `/dashboard/users/${a.targetId}` : "/dashboard/users"),
  },
  // The user page shows the verification state but cannot decide it — Approve /
  // Reject live only on Verifications, which opens on its pending queue.
  verification_submitted: {
    icon: ShieldCheck,
    route: () => "/dashboard/verifications",
  },
  rental_interest: { icon: HeartHandshake, route: () => "/dashboard/rent-attention" },
  agreement_ready: {
    icon: FileSignature,
    route: () => "/dashboard/rent-attention",
  },
};

const SEVERITY_STYLES: Record<AdminAlert["severity"], string> = {
  critical: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
  warning:
    "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  info: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const { user, canWrite } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<AdminAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    // Equality-only query (no composite index needed); sorted client-side.
    const q = query(
      collection(db, "admin_alerts"),
      where("status", "==", "open")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            type: (x.type as string) ?? "unknown",
            severity: (x.severity as AdminAlert["severity"]) ?? "info",
            title: (x.title as string) ?? "Alert",
            body: (x.body as string) ?? "",
            targetCollection: x.targetCollection as string | undefined,
            targetId: x.targetId as string | undefined,
            actors: x.actors as AdminAlert["actors"],
            meta: x.meta as AdminAlert["meta"],
            createdAt: toDate(x.createdAt),
          } as AdminAlert;
        });
        rows.sort(
          (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)
        );
        setItems(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  const criticalCount = useMemo(
    () => items.filter((i) => i.severity === "critical").length,
    [items]
  );

  // Only routine info can be cleared in bulk — see isRoutineInfo. Anything with
  // an open case is left for a human, however quiet its severity.
  const routine = useMemo(() => items.filter(isRoutineInfo), [items]);

  // `verification_submitted` has no Dismiss — the review on the Verifications
  // page closes it. But that page only offers Approve/Reject while a user is
  // still `pending`, so an alert whose review already happened can be cleared
  // by nobody: not the feed, not the page. That is every alert raised before
  // onVerificationDecided shipped, and afterwards anyone whose status left
  // `pending` by a route that trigger doesn't watch (expiry, account deleted).
  //
  // So ask the user doc who is genuinely still waiting. One read per alert of
  // this type, which is a handful.
  const reviewTargets = useMemo(
    () =>
      items
        .filter((i) => i.type === "verification_submitted" && i.targetId)
        .map((i) => i.targetId as string),
    [items]
  );
  const [reviewState, setReviewState] = useState<Record<string, string>>({});
  const reviewKey = reviewTargets.join(",");

  useEffect(() => {
    if (reviewTargets.length === 0) return;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        reviewTargets.map(async (uid) => {
          try {
            const snap = await getDoc(doc(db, "users", uid));
            // A deleted user is settled too — nobody can ever review them.
            const status = snap.exists()
              ? String(snap.data().verificationStatus ?? "none")
              : "deleted";
            return [uid, status] as const;
          } catch {
            // Unreadable: say nothing rather than wrongly offering Dismiss.
            return [uid, ""] as const;
          }
        })
      );
      if (cancelled) return;
      setReviewState(Object.fromEntries(entries.filter(([, v]) => v)));
    })();
    return () => {
      cancelled = true;
    };
    // reviewTargets is rebuilt on every snapshot; its contents are the input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewKey]);

  // A stalled handover is the one alert where dismissing achieves nothing: the
  // property stays off the market and the two parties are still disagreeing.
  // This is the lever — an on-demand push to whichever side can unblock it.
  async function nudgeHandover(item: AdminAlert, target: "landlord" | "tenant") {
    if (!canWrite || !item.targetId) return;
    const note = window.prompt(
      `Optional note to add to the ${target}'s reminder`,
      ""
    );
    if (note === null) return;
    setBusyId(item.id);
    try {
      const fn = httpsCallable(functions, "nudgeHandoverParty");
      await fn({ rentalId: item.targetId, target, note });
      window.alert(`Reminder sent to the ${target}.`);
    } catch (err) {
      // failed-precondition carries the real reason (already closed, or that
      // party is not the one holding it up), so show it rather than a generic.
      const message =
        err instanceof Error ? err.message : "Could not send the reminder.";
      window.alert(message);
    } finally {
      setBusyId(null);
    }
  }

  // Dismiss = acknowledge an alert. Offered for everything except the types a
  // Cloud Function closes for us (see RESOLVE_ON_PAGE).
  async function dismissAlert(item: AdminAlert) {
    if (!canWrite || !user) return;
    setBusyId(item.id);
    try {
      await updateDoc(doc(db, "admin_alerts", item.id), {
        status: "resolved",
        resolvedBy: user.uid,
        resolvedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Failed to dismiss alert", err);
      window.alert(
        err instanceof Error ? err.message : "Couldn't dismiss. Try again."
      );
    } finally {
      setBusyId(null);
    }
  }

  // Clear every routine-info alert at once. Batched (500-doc limit is far above
  // any realistic backlog of these).
  async function dismissRoutine() {
    if (!canWrite || !user || routine.length === 0) return;
    if (
      !window.confirm(
        `Dismiss ${routine.length} routine alert${
          routine.length === 1 ? "" : "s"
        }? Anything with open work is left alone.`
      )
    ) {
      return;
    }
    setClearing(true);
    try {
      const batch = writeBatch(db);
      for (const item of routine) {
        batch.update(doc(db, "admin_alerts", item.id), {
          status: "resolved",
          resolvedBy: user.uid,
          resolvedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    } catch (err) {
      console.error("Failed to dismiss routine alerts", err);
      window.alert(
        err instanceof Error ? err.message : "Couldn't dismiss. Try again."
      );
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl lg:text-3xl font-display font-bold text-[rgb(var(--text-primary))]">
            Alerts
          </h1>
          <p className="text-sm text-[rgb(var(--text-secondary))] mt-1">
            Live feed of things needing attention across the app — disputes, rent
            changes, agreement issues, identity changes and more.
            {criticalCount > 0 && (
              <span className="ml-1 font-medium text-red-500">
                {criticalCount} critical.
              </span>
            )}
          </p>
        </div>
        {canWrite && routine.length > 0 && (
          <button
            onClick={dismissRoutine}
            disabled={clearing}
            title="Clears sign-ups, rent payments, the daily digest and finished inspections. Alerts with open work stay."
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))] disabled:opacity-50 shrink-0"
          >
            {clearing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CheckCheck size={14} />
            )}
            Dismiss all routine ({routine.length})
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-[rgb(var(--brand))]" />
        </div>
      ) : items.length === 0 ? (
        <div className="card text-center py-16">
          <Bell size={36} className="mx-auto text-[rgb(var(--text-hint))]" />
          <p className="mt-3 text-sm text-[rgb(var(--text-secondary))]">
            All clear — no open alerts.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const meta = TYPE_META[item.type];
            const Icon = meta?.icon ?? Bell;
            const route = meta?.route(item) ?? null;
            const busy = busyId === item.id;
            // Two different reasons a card isn't just an FYI: `resolvePage`
            // types close themselves when the admin acts (so no Dismiss at
            // all), while `openWork` types need a human to decide they're done
            // (so Dismiss stays, but the card says it resolves nothing).
            // Already reviewed: drop back to a plain card with a Dismiss, so
            // the notice can be cleared by the human looking at it.
            const decided =
              item.targetId && item.type === "verification_submitted" ?
                reviewState[item.targetId] : undefined;
            const settled = Boolean(decided) && decided !== "pending";
            const resolvePage = settled ?
              undefined : RESOLVE_ON_PAGE[item.type];
            const openWork = !settled && hasOpenWork(item);
            return (
              <div key={item.id} className="card">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={cn(
                        "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border",
                        SEVERITY_STYLES[item.severity]
                      )}
                    >
                      <Icon size={17} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-[rgb(var(--text-primary))]">
                          {item.title}
                        </span>
                        <span
                          className={cn(
                            "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border",
                            SEVERITY_STYLES[item.severity]
                          )}
                        >
                          {item.severity}
                        </span>
                      </div>
                      <p className="text-xs text-[rgb(var(--text-secondary))] mt-1 break-words">
                        {item.body}
                      </p>
                      {item.createdAt && (
                        <p className="text-[11px] text-[rgb(var(--text-hint))] mt-1">
                          {timeAgo(item.createdAt)}
                        </p>
                      )}
                      {settled ? (
                        <p className="text-[11px] text-[rgb(var(--text-hint))] mt-1 italic">
                          Already reviewed — {decided}. Safe to dismiss.
                        </p>
                      ) : resolvePage ? (
                        <p className="text-[11px] text-[rgb(var(--text-hint))] mt-1 italic">
                          Resolve this from {resolvePage} — it clears here
                          automatically.
                        </p>
                      ) : openWork ? (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 italic">
                          Still open — dismissing this acknowledges it, it
                          doesn&apos;t resolve it.
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {resolvePage && route ? (
                      // Actionable: only a route to the resolution page. The
                      // real action there closes the alert.
                      <button
                        onClick={() => router.push(route)}
                        className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl bg-[rgb(var(--brand))] text-white hover:opacity-90"
                      >
                        Review
                        <ArrowRight size={14} />
                      </button>
                    ) : (
                      <>
                        {route && (
                          <button
                            onClick={() => router.push(route)}
                            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))]"
                          >
                            {openWork ? "Review" : "View"}
                            <ArrowRight size={14} />
                          </button>
                        )}
                        {canWrite && HANDOVER_ALERTS.has(item.type) && (
                          <>
                            <button
                              disabled={busy}
                              onClick={() => void nudgeHandover(item, "landlord")}
                              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))] disabled:opacity-50"
                            >
                              Nudge landlord
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => void nudgeHandover(item, "tenant")}
                              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))] disabled:opacity-50"
                            >
                              Nudge tenant
                            </button>
                          </>
                        )}
                        {canWrite && (
                          <button
                            disabled={busy}
                            onClick={() => dismissAlert(item)}
                            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))] disabled:opacity-50"
                          >
                            {busy ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Check size={14} />
                            )}
                            Dismiss
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
