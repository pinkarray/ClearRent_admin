"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { cn, timeAgo } from "@/lib/utils";
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
  Loader2,
  UserPlus,
  ShieldCheck,
  HeartHandshake,
  FileSignature,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AdminAlert {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  targetCollection?: string;
  targetId?: string;
  actors?: { tenantId?: string; agentId?: string; landlordId?: string };
  createdAt: Date | null;
}

function toDate(v: unknown): Date | null {
  if (v instanceof Timestamp) return v.toDate();
  return null;
}

// Icon + landing route per alert type. A null route means there's no dedicated
// page to act on it — the admin just reviews + resolves it here.
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
  issue_reported: { icon: AlertTriangle, route: () => "/dashboard/issues" },
  issue_fix_disputed: { icon: AlertTriangle, route: () => "/dashboard/issues" },
  profile_identity_change: {
    icon: UserCog,
    route: (a) => (a.targetId ? `/dashboard/users/${a.targetId}` : null),
  },
  agreement_disputed: { icon: FileWarning, route: () => null },
  rental_end_contested: { icon: DoorOpen, route: () => null },

  // Pipeline events. Previously these had no producer at all, so an admin
  // learned about a waiting verification only by opening the users queue.
  user_signed_up: {
    icon: UserPlus,
    route: (a) => (a.targetId ? `/dashboard/users/${a.targetId}` : "/dashboard/users"),
  },
  verification_submitted: {
    icon: ShieldCheck,
    route: (a) =>
      a.targetId ? `/dashboard/users/${a.targetId}` : "/dashboard/users",
  },
  rental_interest: { icon: HeartHandshake, route: () => "/dashboard/rent-attention" },
  agreement_ready: { icon: FileSignature, route: () => null },
};

// Alert types whose case is resolved by a real action on a dedicated page —
// that action (via its Cloud Function) closes the alert automatically. These
// must NOT be dismissible here, or the notice would clear while the underlying
// dispute/request stays open. Everything else is oversight/FYI: seeing it is
// the whole job, so a manual "Dismiss" is honest.
const RESOLVE_ON_PAGE: Record<string, string> = {
  inspection_dispute: "Inspection Reviews",
  rent_change_request: "Rent Reviews",
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

  // Dismiss = acknowledge an oversight/FYI alert. Only offered for alerts that
  // have no case to resolve elsewhere (see RESOLVE_ON_PAGE).
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

  return (
    <div className="space-y-6">
      {/* Header */}
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
            // Actionable cases are resolved on their page (which closes this
            // alert); FYI alerts are dismissible here.
            const resolvePage = RESOLVE_ON_PAGE[item.type];
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
                      {resolvePage && (
                        <p className="text-[11px] text-[rgb(var(--text-hint))] mt-1 italic">
                          Resolve this from {resolvePage} — it clears here
                          automatically.
                        </p>
                      )}
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
                            View
                            <ArrowRight size={14} />
                          </button>
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
