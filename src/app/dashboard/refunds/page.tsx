"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, query, where, onSnapshot, doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { fetchBankDetails } from "@/lib/bank";
import { parseTimestamp } from "@/types";
import { cn, timeAgo } from "@/lib/utils";
import { RotateCcw, Search, X, Loader2, CheckCircle2, Clock, Copy, AlertTriangle, Landmark, History } from "lucide-react";
import { MarkPaidModal } from "@/components/MarkPaidModal";
import { useAuth } from "@/lib/auth-context";

// ─── Types ────────────────────────────────────────────────────────────────────

type TabFilter = "pending" | "paid";

interface BankDetails {
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
}

interface Refund {
  id: string;
  amount: number;
  beneficiaryId: string;
  beneficiaryRole: string;
  reason: string;
  source: string;
  sourceCollection: string;
  propertyTitle: string;
  status: string; // pending | paid
  createdAt: Date;
  paidAt?: Date;
  paymentReference?: string;

  // Loaded separately from the beneficiary's user doc.
  beneficiaryName?: string;
  beneficiaryPhone?: string;
  beneficiaryBank?: BankDetails;
  bankLoading: boolean;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatNaira(amount: number) {
  if (!amount) return "₦0";
  return `₦${amount.toLocaleString("en-NG")}`;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RefundsPage() {
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabFilter, setTabFilter] = useState<TabFilter>("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [refundToMark, setRefundToMark] = useState<Refund | null>(null);

  // ── Listener ───────────────────────────────────────────────────────────────

  useEffect(() => {
    // No orderBy: an `in` filter + orderBy on another field needs a composite
    // index this fresh collection has none for (would silently return empty).
    // Sort client-side instead — the pattern used elsewhere in the app.
    const q = query(
      collection(db, "refunds"),
      where("status", "in", ["pending", "paid"])
    );

    const unsub = onSnapshot(q, (snap) => {
      const base: Refund[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          amount: (data.amount || 0) as number,
          beneficiaryId: data.beneficiaryId || "",
          beneficiaryRole: data.beneficiaryRole || "tenant",
          reason: data.reason || "Refund",
          source: data.source || "",
          sourceCollection: data.sourceCollection || "",
          propertyTitle: data.propertyTitle || "Unknown Property",
          status: data.status || "pending",
          createdAt: parseTimestamp(data.createdAt) || new Date(),
          paidAt: parseTimestamp(data.paidAt),
          paymentReference: data.paymentReference || undefined,
          bankLoading: true,
        };
      });

      base.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setRefunds(base);
      setLoading(false);

      // Load beneficiary name + bank details in background.
      base.forEach(async (refund) => {
        if (!refund.beneficiaryId) {
          setRefunds((prev) =>
            prev.map((r) => (r.id === refund.id ? { ...r, bankLoading: false } : r))
          );
          return;
        }
        try {
          // C1: bank from the locked private/bank subcollection (legacy
          // fallback in src/lib/bank.ts). Name/phone still from the user doc.
          const uDoc = await getDoc(doc(db, "users", refund.beneficiaryId));
          let beneficiaryName: string | undefined;
          let beneficiaryPhone: string | undefined;
          if (uDoc.exists()) {
            const d = uDoc.data();
            beneficiaryName = d.fullName;
            beneficiaryPhone = d.phone;
          }
          const beneficiaryBank: BankDetails | undefined =
            (await fetchBankDetails(refund.beneficiaryId)) ?? undefined;
          setRefunds((prev) =>
            prev.map((r) =>
              r.id === refund.id
                ? { ...r, beneficiaryName, beneficiaryPhone, beneficiaryBank, bankLoading: false }
                : r
            )
          );
        } catch {
          setRefunds((prev) =>
            prev.map((r) => (r.id === refund.id ? { ...r, bankLoading: false } : r))
          );
        }
      });
    });

    return () => unsub();
  }, []);

  // ── Counts ─────────────────────────────────────────────────────────────────

  const pendingCount = refunds.filter((r) => r.status === "pending").length;
  const paidCount = refunds.filter((r) => r.status === "paid").length;
  const totalPending = refunds
    .filter((r) => r.status === "pending")
    .reduce((sum, r) => sum + r.amount, 0);

  // ── Filtering ──────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return refunds.filter((r) => {
      const matchTab = r.status === tabFilter;
      const q = searchQuery.toLowerCase();
      const matchSearch =
        !searchQuery ||
        (r.beneficiaryName || "").toLowerCase().includes(q) ||
        r.propertyTitle.toLowerCase().includes(q) ||
        r.reason.toLowerCase().includes(q);
      return matchTab && matchSearch;
    });
  }, [refunds, tabFilter, searchQuery]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-display font-bold text-[rgb(var(--text-primary))]">
          Refunds
        </h1>
        <p className="text-sm text-[rgb(var(--text-secondary))] mt-1">
          <span className="text-amber-500 font-medium">{pendingCount} pending</span> ·{" "}
          {paidCount} paid
        </p>
      </div>

      {/* Pending summary */}
      {pendingCount > 0 && (
        <div className="card border-amber-500/30 bg-amber-500/5 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle size={18} className="text-amber-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">
              {pendingCount} refund{pendingCount !== 1 ? "s" : ""} awaiting payout —{" "}
              <span className="text-amber-500">{formatNaira(totalPending)}</span>
            </p>
            <p className="text-xs text-[rgb(var(--text-secondary))] mt-0.5">
              Transfer the amount to the beneficiary&apos;s bank account, then mark it paid.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        {(
          [
            ["Pending", pendingCount, "pending"],
            ["Paid", paidCount, "paid"],
          ] as [string, number, TabFilter][]
        ).map(([label, count, value]) => (
          <button
            key={value}
            onClick={() => setTabFilter(value)}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-medium transition-all border",
              tabFilter === value
                ? "bg-[rgb(var(--brand))]/10 text-[rgb(var(--brand))] border-[rgb(var(--brand))]/30"
                : "bg-[rgb(var(--surface))] text-[rgb(var(--text-secondary))] border-[rgb(var(--border))] hover:border-[rgb(var(--text-hint))]"
            )}
          >
            {label}
            <span className="ml-2 text-xs opacity-70">{count}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search
          size={16}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[rgb(var(--text-hint))]"
        />
        <input
          type="text"
          placeholder="Search by beneficiary, property, or reason..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input pl-10"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgb(var(--text-hint))] hover:text-[rgb(var(--text-secondary))]"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-[rgb(var(--brand))]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16">
          {tabFilter === "paid" ? (
            <>
              <History size={40} className="mx-auto text-[rgb(var(--text-hint))] mb-4" />
              <p className="text-[rgb(var(--text-secondary))] font-medium">No refund history</p>
              <p className="text-sm text-[rgb(var(--text-hint))] mt-1">
                {searchQuery ? "Try a different search term" : "Completed refunds will appear here."}
              </p>
            </>
          ) : (
            <>
              <CheckCircle2 size={40} className="mx-auto text-emerald-500 mb-4" />
              <p className="text-[rgb(var(--text-secondary))] font-medium">All caught up!</p>
              <p className="text-sm text-[rgb(var(--text-hint))] mt-1">
                No pending refunds right now.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((refund) => (
            <RefundCard
              key={refund.id}
              refund={refund}
              copied={copied}
              onMarkPaid={() => setRefundToMark(refund)}
              onCopy={copyToClipboard}
            />
          ))}
        </div>
      )}

      {/* Mark-paid modal */}
      {refundToMark && (
        <MarkPaidModal
          docId={refundToMark.id}
          callable="markRefundPaid"
          amount={refundToMark.amount}
          description={`Refund to ${refundToMark.beneficiaryName || "beneficiary"} for ${refundToMark.propertyTitle}`}
          bank={refundToMark.beneficiaryBank}
          onSuccess={() => {
            // Firestore listener picks up the status flip; just clear local state.
            setRefundToMark(null);
          }}
          onClose={() => setRefundToMark(null)}
        />
      )}
    </div>
  );
}

// ─── Refund Card ──────────────────────────────────────────────────────────────

function RefundCard({
  refund,
  copied,
  onMarkPaid,
  onCopy,
}: {
  refund: Refund;
  copied: string | null;
  onMarkPaid: () => void;
  onCopy: (text: string, key: string) => void;
}) {
  const { canWrite } = useAuth();
  const isPending = refund.status === "pending";
  const bank = refund.beneficiaryBank;
  const copyKey = `${refund.id}-acct`;

  return (
    <div
      className={cn(
        "card transition-all",
        isPending && "border-amber-500/20"
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-11 h-11 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
          <RotateCcw size={20} className="text-red-500" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">
              {refund.bankLoading ? "Loading…" : refund.beneficiaryName || "Unknown"}
            </p>
            <span className="badge bg-[rgb(var(--text-hint))]/10 text-[rgb(var(--text-secondary))] capitalize">
              {refund.beneficiaryRole}
            </span>
            {isPending ? (
              <span className="badge-warning gap-1"><Clock size={11} />Pending</span>
            ) : (
              <span className="badge-success gap-1"><CheckCircle2 size={11} />Paid</span>
            )}
          </div>
          <p className="text-xs text-[rgb(var(--text-hint))] mt-0.5 truncate">
            {refund.propertyTitle}
          </p>
          <p className="text-xs text-[rgb(var(--text-secondary))] mt-0.5">
            {refund.reason}
          </p>
          {refund.bankLoading ? (
            <p className="text-xs text-[rgb(var(--text-hint))] mt-1 flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" /> Loading bank details...
            </p>
          ) : bank?.accountNumber ? (
            <div className="flex items-center gap-1.5 mt-1">
              <Landmark size={11} className="text-[rgb(var(--text-hint))] shrink-0" />
              <p className="text-xs text-[rgb(var(--text-secondary))] font-mono">
                {bank.bankName} · {bank.accountNumber}
                {bank.accountName ? ` · ${bank.accountName}` : ""}
              </p>
              <button
                onClick={() => onCopy(bank.accountNumber!, copyKey)}
                className="text-[rgb(var(--text-hint))] hover:text-[rgb(var(--brand))] transition-colors"
              >
                {copied === copyKey ? (
                  <CheckCircle2 size={11} className="text-emerald-500" />
                ) : (
                  <Copy size={11} />
                )}
              </button>
            </div>
          ) : (
            <p className="text-xs text-amber-500 mt-1">No bank details saved — contact the beneficiary.</p>
          )}
        </div>

        {/* Amount */}
        <div className="text-right shrink-0">
          <p className="text-base font-bold text-[rgb(var(--text-primary))] font-mono">
            {formatNaira(refund.amount)}
          </p>
          <p className="text-[10px] text-[rgb(var(--text-hint))] mt-0.5">
            {isPending
              ? refund.createdAt
                ? timeAgo(refund.createdAt)
                : ""
              : refund.paidAt
              ? `Paid ${refund.paidAt.toLocaleDateString("en-NG")}`
              : ""}
          </p>
        </div>

        {/* Quick action */}
        {canWrite && isPending && (
          <div className="shrink-0">
            <button
              onClick={onMarkPaid}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold hover:bg-emerald-500/20 transition-colors"
            >
              <CheckCircle2 size={13} />
              Mark Paid
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
