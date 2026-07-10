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
import { fetchBankDetails, type BankDetails } from "@/lib/bank";
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
  tenantId: string;
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

// ClearRent's flat, non-refundable cut of the inspection fee — retained on an
// ambiguous outcome. A confirmed handler no-show still refunds the full fee.
const CLEARRENT_CUT = 3000;

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
  const [refundItem, setRefundItem] = useState<AwaitingInspection | null>(null);
  const [refundInput, setRefundInput] = useState<string>("");
  const [refundBank, setRefundBank] = useState<BankDetails | null>(null);
  const [refundBankLoading, setRefundBankLoading] = useState(false);

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
            tenantId: (x.tenantId as string) ?? "",
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

  function openRefund(item: AwaitingInspection) {
    setRefundItem(item);
    setRefundInput(String(item.totalFee));
    setRefundBank(null);
    if (item.tenantId) {
      setRefundBankLoading(true);
      fetchBankDetails(item.tenantId)
        .then((b) => setRefundBank(b))
        .finally(() => setRefundBankLoading(false));
    }
  }

  async function submitRefund() {
    if (!refundItem) return;
    const full = refundItem.totalFee;
    const amount = Number(refundInput);
    if (!Number.isFinite(amount) || amount <= 0 || amount > full) {
      alert(`Enter a refund amount between ₦1 and ${formatNaira(full)}.`);
      return;
    }
    setBusyId(refundItem.id);
    try {
      await updateDoc(doc(db, "inspection_requests", refundItem.id), {
        status: "refunded",
        paymentStatus: "refunded",
        refundAmount: amount,
        refundReason:
          amount < full
            ? "Resolved by admin — partial refund (non-refundable cut retained)"
            : "Resolved by admin — inspection not completed",
        resolvedByAdmin: true,
        refundedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setRefundItem(null);
    } finally {
      setBusyId(null);
    }
  }

  async function markCompleted(item: AwaitingInspection) {
    if (
      !confirm(
        `Mark "${item.propertyTitle}" as completed? The handler is paid their ₦7,000 fee; the tenant is not refunded.`
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
                      onClick={() => openRefund(item)}
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

      {refundItem && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => {
              if (!busyId) setRefundItem(null);
            }}
          />
          <div className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-6 shadow-2xl space-y-4">
            <div>
              <h3 className="font-display font-semibold text-[rgb(var(--text-primary))]">
                Refund tenant
              </h3>
              <p className="mt-1 text-sm text-[rgb(var(--text-secondary))]">
                {refundItem.tenantName} · {refundItem.propertyTitle}
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[rgb(var(--text-hint))]">
                Refund amount (fee paid: {formatNaira(refundItem.totalFee)})
              </label>
              <input
                type="number"
                min={1}
                max={refundItem.totalFee}
                value={refundInput}
                onChange={(e) => setRefundInput(e.target.value)}
                className="w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] px-3 py-2 text-sm focus:border-[rgb(var(--brand))] focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRefundInput(String(refundItem.totalFee))}
                  className="rounded-lg border border-[rgb(var(--border))] px-2.5 py-1 text-xs text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))]"
                >
                  Full refund
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setRefundInput(
                      String(Math.max(refundItem.totalFee - CLEARRENT_CUT, 0))
                    )
                  }
                  className="rounded-lg border border-[rgb(var(--border))] px-2.5 py-1 text-xs text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))]"
                >
                  Minus ₦{CLEARRENT_CUT.toLocaleString("en-NG")} cut
                </button>
              </div>
              <p className="text-xs text-[rgb(var(--text-hint))]">
                Full fee for a confirmed handler no-show. For an unclear outcome,
                use &quot;Minus ₦{CLEARRENT_CUT.toLocaleString("en-NG")} cut&quot;
                — ClearRent keeps its {formatNaira(CLEARRENT_CUT)} share.
              </p>
            </div>
            <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] p-3 space-y-1.5">
              <p className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
                Refund goes to
              </p>
              {refundBankLoading ? (
                <p className="flex items-center gap-1.5 text-xs text-[rgb(var(--text-hint))]">
                  <Loader2 size={12} className="animate-spin" /> Loading bank
                  details…
                </p>
              ) : refundBank &&
                (refundBank.accountNumber || refundBank.accountName) ? (
                <>
                  {refundBank.accountName && (
                    <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">
                      {refundBank.accountName}
                    </p>
                  )}
                  <p className="text-sm text-[rgb(var(--text-secondary))]">
                    {refundBank.bankName || "Bank —"}
                    {refundBank.accountNumber
                      ? ` · ${refundBank.accountNumber}`
                      : ""}
                  </p>
                </>
              ) : (
                <p className="text-xs text-amber-500">
                  No bank details on file — the tenant must add them before you
                  can pay.
                </p>
              )}
              <p className="pt-1 text-[11px] text-[rgb(var(--text-hint))]">
                Confirming queues a pending refund in the{" "}
                <span className="font-medium">Refunds</span> tab, where you
                complete the transfer and mark it paid.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                disabled={!!busyId}
                onClick={() => setRefundItem(null)}
                className="rounded-xl border border-[rgb(var(--border))] px-3 py-2 text-sm text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                disabled={!!busyId}
                onClick={submitRefund}
                className="flex items-center gap-1.5 rounded-xl bg-[rgb(var(--brand))] px-3 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
              >
                {busyId ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Undo2 size={14} />
                )}
                Confirm refund
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
