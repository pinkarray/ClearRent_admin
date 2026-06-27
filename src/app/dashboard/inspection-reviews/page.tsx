"use client";

import { useEffect, useState, useMemo } from "react";
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
import { cn, timeAgo } from "@/lib/utils";
import {
  ClipboardCheck,
  Search,
  X,
  Loader2,
  CheckCircle2,
  Undo2,
  Home,
  User,
  CalendarClock,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AwaitingInspection {
  id: string;
  propertyTitle: string;
  tenantName: string;
  agentId: string | null;
  agentName: string | null;
  landlordName: string | null;
  requestedDate: Date | null;
  requestedTimeSlot: string;
  tenantArrived: boolean;
  handlerArrived: boolean;
  totalFee: number;
  updatedAt: Date | null;
}

function toDate(v: unknown): Date | null {
  if (v instanceof Timestamp) return v.toDate();
  return null;
}

function formatNaira(amount: number) {
  return `₦${(amount ?? 0).toLocaleString("en-NG")}`;
}

function formatDate(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleDateString("en-NG", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function InspectionReviewsPage() {
  const [items, setItems] = useState<AwaitingInspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "inspection_requests"),
      where("status", "==", "awaitingOutcome")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            propertyTitle: (x.propertyTitle as string) ?? "Property",
            tenantName: (x.tenantName as string) ?? "Tenant",
            agentId: (x.agentId as string) ?? null,
            agentName: (x.agentName as string) ?? null,
            landlordName: (x.landlordName as string) ?? null,
            requestedDate: toDate(x.requestedDate),
            requestedTimeSlot: (x.requestedTimeSlot as string) ?? "",
            tenantArrived: x.tenantArrived === true,
            handlerArrived: x.handlerArrived === true,
            totalFee: (x.totalFee as number) ?? 0,
            updatedAt: toDate(x.updatedAt),
          } as AwaitingInspection;
        });
        rows.sort((a, b) =>
          (a.requestedDate?.getTime() ?? 0) - (b.requestedDate?.getTime() ?? 0)
        );
        setItems(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.propertyTitle.toLowerCase().includes(q) ||
        i.tenantName.toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  async function refundTenant(item: AwaitingInspection) {
    if (
      !confirm(
        `Refund ${item.tenantName} ${formatNaira(item.totalFee)} for "${item.propertyTitle}"?`
      )
    )
      return;
    setBusyId(item.id);
    try {
      await updateDoc(doc(db, "inspection_requests", item.id), {
        status: "refunded",
        paymentStatus: "refunded",
        refundReason: "Resolved by admin — inspection not completed",
        refundedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } finally {
      setBusyId(null);
    }
  }

  async function markCompleted(item: AwaitingInspection) {
    if (
      !confirm(
        `Mark "${item.propertyTitle}" as completed? The handler's fee stands (no refund).`
      )
    )
      return;
    setBusyId(item.id);
    try {
      await updateDoc(doc(db, "inspection_requests", item.id), {
        status: "completed",
        completedAt: serverTimestamp(),
        resolvedByAdmin: true,
        updatedAt: serverTimestamp(),
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl lg:text-3xl font-display font-bold text-[rgb(var(--text-primary))]">
            Inspection Reviews
          </h1>
          <p className="text-sm text-[rgb(var(--text-secondary))] mt-1">
            Past inspections with no clear outcome — decide refund or completed.
          </p>
        </div>
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgb(var(--text-hint))]"
          />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search property or tenant"
            className="pl-9 pr-8 py-2 rounded-xl bg-[rgb(var(--surface))] border border-[rgb(var(--border))] text-sm w-64 focus:outline-none focus:border-[rgb(var(--brand))]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgb(var(--text-hint))]"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-[rgb(var(--brand))]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16">
          <ClipboardCheck
            size={36}
            className="mx-auto text-[rgb(var(--text-hint))]"
          />
          <p className="mt-3 text-sm text-[rgb(var(--text-secondary))]">
            Nothing to review — no inspections are awaiting an outcome.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const handler = item.agentId
              ? item.agentName ?? "Agent"
              : item.landlordName ?? "Landlord";
            const busy = busyId === item.id;
            return (
              <div key={item.id} className="card">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Home size={15} className="text-[rgb(var(--brand))]" />
                      <span className="font-semibold text-sm text-[rgb(var(--text-primary))]">
                        {item.propertyTitle}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[rgb(var(--text-secondary))]">
                      <span className="flex items-center gap-1">
                        <User size={12} /> {item.tenantName} (tenant)
                      </span>
                      <span className="flex items-center gap-1">
                        <User size={12} /> {handler} (handler)
                      </span>
                      <span className="flex items-center gap-1">
                        <CalendarClock size={12} />
                        {formatDate(item.requestedDate)}{" "}
                        {item.requestedTimeSlot}
                      </span>
                      <span>{formatNaira(item.totalFee)}</span>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <span
                        className={cn(
                          "text-[11px] px-2 py-0.5 rounded-full",
                          item.tenantArrived
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-red-500/10 text-red-600 dark:text-red-400"
                        )}
                      >
                        Tenant {item.tenantArrived ? "arrived" : "no-show"}
                      </span>
                      <span
                        className={cn(
                          "text-[11px] px-2 py-0.5 rounded-full",
                          item.handlerArrived
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-red-500/10 text-red-600 dark:text-red-400"
                        )}
                      >
                        Handler {item.handlerArrived ? "arrived" : "no-show"}
                      </span>
                      {item.updatedAt && (
                        <span className="text-[11px] text-[rgb(var(--text-hint))]">
                          flagged {timeAgo(item.updatedAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      disabled={busy}
                      onClick={() => refundTenant(item)}
                      className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))] disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Undo2 size={14} />
                      )}
                      Refund tenant
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => markCompleted(item)}
                      className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl bg-[rgb(var(--brand))] text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={14} />
                      )}
                      Mark completed
                    </button>
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
