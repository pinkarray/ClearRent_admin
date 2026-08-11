"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, query, where, orderBy, onSnapshot, doc, getDoc,} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { fetchBankDetails } from "@/lib/bank";
import { parseTimestamp } from "@/types";
import { cn, timeAgo } from "@/lib/utils";
import { Banknote, Search, X, Loader2, CheckCircle2, Clock, Copy, Phone, User, Building2, AlertTriangle, Landmark, UserCheck, History, ExternalLink,} from "lucide-react";
import { MarkPaidModal } from "@/components/MarkPaidModal";
import { ResolvePayoutDisputeModal } from "@/components/ResolvePayoutDisputeModal";
import { useAuth } from "@/lib/auth-context";
// ─── Types ────────────────────────────────────────────────────────────────────

type TabFilter = "landlord" | "agent" | "paid";

/**
 * Beneficiary's answer to "did it arrive?". `awaiting` is stamped when the
 * payout is marked paid; absent means the same on anything paid before the
 * receipt flow shipped.
 */
type ReceiptState = "awaiting" | "confirmed" | "disputed" | "resolved";

interface BankDetails {
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
}

interface RentPayout {
  id: string;
  propertyId: string;
  propertyTitle: string;
  propertyAddress: string;
  propertyImage?: string;

  landlordId: string;
  landlordName: string;
  agentId?: string;
  agentName?: string;
  tenantId: string;
  tenantName: string;

  rentAmount: number;
  agentFee: number;
  totalPaid: number;
  landlordPayout: number;
  agentPayout: number;
  clearrentEarnings: number;

  landlordPayoutStatus: string;
  agentPayoutStatus: string;
  landlordPaidAt?: Date;
  agentPaidAt?: Date;

  // Did the money actually land? "Paid" only ever meant we sent it. Undefined
  // means the beneficiary hasn't answered yet.
  landlordPayoutReceipt?: ReceiptState;
  agentPayoutReceipt?: ReceiptState;
  landlordPayoutDisputeReason?: string;
  agentPayoutDisputeReason?: string;
  landlordPayoutConfirmedAt?: Date;
  agentPayoutConfirmedAt?: Date;
  landlordPayoutDisputeResolutionNote?: string;
  agentPayoutDisputeResolutionNote?: string;
  landlordPayoutProofPath?: string;
  agentPayoutProofPath?: string;

  createdAt: Date;

  // Loaded separately
  landlordBank?: BankDetails;
  agentBank?: BankDetails;
  landlordPhone?: string;
  agentPhone?: string;
  bankLoading: boolean;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatNaira(amount: number) {
  if (!amount) return "₦0";
  return `₦${amount.toLocaleString("en-NG")}`;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RentPayoutsPage() {
  const [payouts, setPayouts] = useState<RentPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabFilter, setTabFilter] = useState<TabFilter>("landlord");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPayout, setSelectedPayout] = useState<RentPayout | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [payoutToMark, setPayoutToMark] = useState<{
    payout: RentPayout;
    branch: "landlord" | "agent";
  } | null>(null);
  const [disputeToResolve, setDisputeToResolve] = useState<{
    payout: RentPayout;
    role: "landlord" | "agent";
  } | null>(null);

  // ── Listener ───────────────────────────────────────────────────────────────

  useEffect(() => {
    // Query all active_rentals that have payout data
    const q = query(
      collection(db, "active_rentals"),
      where("landlordPayoutStatus", "in", ["pending", "paid"]),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(q, async (snap) => {
      const base: RentPayout[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          propertyId: data.propertyId || "",
          propertyTitle: data.propertyTitle || "Unknown Property",
          propertyAddress: data.propertyAddress || "",
          propertyImage: data.propertyImage,
          landlordId: data.landlordId || "",
          landlordName: data.landlordName || "Landlord",
          agentId: data.agentId || undefined,
          agentName: data.agentName || undefined,
          tenantId: data.tenantId || "",
          tenantName: data.tenantName || "Tenant",
          rentAmount: (data.rentAmount || 0) as number,
          agentFee: (data.agentFee || 0) as number,
          totalPaid: (data.totalPaid || 0) as number,
          landlordPayout: (data.landlordPayout || 0) as number,
          agentPayout: (data.agentPayout || 0) as number,
          clearrentEarnings: (data.clearrentEarnings || 0) as number,
          landlordPayoutStatus: data.landlordPayoutStatus || "pending",
          agentPayoutStatus: data.agentPayoutStatus || "not_applicable",
          landlordPaidAt: parseTimestamp(data.landlordPaidAt),
          agentPaidAt: parseTimestamp(data.agentPaidAt),
          landlordPayoutReceipt: data.landlordPayoutReceipt,
          agentPayoutReceipt: data.agentPayoutReceipt,
          landlordPayoutDisputeReason: data.landlordPayoutDisputeReason,
          agentPayoutDisputeReason: data.agentPayoutDisputeReason,
          landlordPayoutConfirmedAt: parseTimestamp(
            data.landlordPayoutConfirmedAt
          ),
          agentPayoutConfirmedAt: parseTimestamp(data.agentPayoutConfirmedAt),
          landlordPayoutDisputeResolutionNote:
            data.landlordPayoutDisputeResolutionNote,
          agentPayoutDisputeResolutionNote:
            data.agentPayoutDisputeResolutionNote,
          landlordPayoutProofPath: data.landlordPayoutProofPath,
          agentPayoutProofPath: data.agentPayoutProofPath,
          createdAt: parseTimestamp(data.createdAt) || new Date(),
          bankLoading: true,
        };
      });

      setPayouts(base);
      setLoading(false);

      // Load bank details in background
      base.forEach(async (payout) => {
        try {
          // Load landlord bank (C1: locked private/bank subcollection, with
          // legacy fallback — see src/lib/bank.ts). Phone still comes from the
          // user doc.
          let landlordBank: BankDetails | undefined;
          let landlordPhone: string | undefined;
          if (payout.landlordId) {
            landlordBank =
              (await fetchBankDetails(payout.landlordId)) ?? undefined;
            const lDoc = await getDoc(doc(db, "users", payout.landlordId));
            if (lDoc.exists()) landlordPhone = lDoc.data().phone;
          }

          // Load agent bank if applicable
          let agentBank: BankDetails | undefined;
          let agentPhone: string | undefined;
          if (payout.agentId) {
            agentBank = (await fetchBankDetails(payout.agentId)) ?? undefined;
            const aDoc = await getDoc(doc(db, "users", payout.agentId));
            if (aDoc.exists()) agentPhone = aDoc.data().phone;
          }

          setPayouts((prev) =>
            prev.map((p) =>
              p.id === payout.id
                ? {
                    ...p,
                    landlordBank,
                    landlordPhone,
                    agentBank,
                    agentPhone,
                    bankLoading: false,
                  }
                : p
            )
          );
        } catch {
          setPayouts((prev) =>
            prev.map((p) =>
              p.id === payout.id ? { ...p, bankLoading: false } : p
            )
          );
        }
      });
    });

    return () => unsub();
  }, []);

  // ── Counts ─────────────────────────────────────────────────────────────────

  const landlordPendingCount = payouts.filter(
    (p) => p.landlordPayoutStatus === "pending"
  ).length;
  const agentPendingCount = payouts.filter(
    (p) => p.agentPayoutStatus === "pending"
  ).length;
  const paidCount = payouts.filter(
    (p) => p.landlordPayoutStatus === "paid"
  ).length;

  const totalLandlordPending = payouts
    .filter((p) => p.landlordPayoutStatus === "pending")
    .reduce((sum, p) => sum + p.landlordPayout, 0);

  const totalAgentPending = payouts
    .filter((p) => p.agentPayoutStatus === "pending")
    .reduce((sum, p) => sum + p.agentPayout, 0);

  // ── Filtering ──────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return payouts.filter((p) => {
      let matchTab = false;
      if (tabFilter === "landlord") matchTab = p.landlordPayoutStatus === "pending";
      else if (tabFilter === "agent") matchTab = p.agentPayoutStatus === "pending";
      else matchTab = p.landlordPayoutStatus === "paid";

      const q = searchQuery.toLowerCase();
      const matchSearch =
        !searchQuery ||
        p.landlordName.toLowerCase().includes(q) ||
        (p.agentName || "").toLowerCase().includes(q) ||
        p.propertyTitle.toLowerCase().includes(q) ||
        p.tenantName.toLowerCase().includes(q);

      return matchTab && matchSearch;
    });
  }, [payouts, tabFilter, searchQuery]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const markLandlordPaid = (payout: RentPayout) => {
    setPayoutToMark({ payout, branch: "landlord" });
  };

  const markAgentPaid = (payout: RentPayout) => {
    setPayoutToMark({ payout, branch: "agent" });
  };

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
          Rent Payouts
        </h1>
        <p className="text-sm text-[rgb(var(--text-secondary))] mt-1">
          <span className="text-amber-500 font-medium">
            {landlordPendingCount} landlord
          </span>{" "}
          ·{" "}
          <span className="text-blue-500 font-medium">
            {agentPendingCount} agent
          </span>{" "}
          pending · {paidCount} paid
        </p>
      </div>

      {/* Pending summary */}
      {(landlordPendingCount > 0 || agentPendingCount > 0) && (
        <div className="card border-amber-500/30 bg-amber-500/5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-start gap-3 flex-1">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle size={18} className="text-amber-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">
                Outstanding rent payouts
              </p>
              <p className="text-xs text-[rgb(var(--text-secondary))] mt-0.5">
                Landlords:{" "}
                <span className="font-semibold text-amber-500">
                  {formatNaira(totalLandlordPending)}
                </span>
                {totalAgentPending > 0 && (
                  <>
                    {" "}· Agents:{" "}
                    <span className="font-semibold text-blue-500">
                      {formatNaira(totalAgentPending)}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        {(
          [
            ["Landlord", landlordPendingCount, "landlord"],
            ["Agent", agentPendingCount, "agent"],
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
          placeholder="Search by name, property, or tenant..."
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
              <p className="text-[rgb(var(--text-secondary))] font-medium">No payment history</p>
              <p className="text-sm text-[rgb(var(--text-hint))] mt-1">
                {searchQuery ? "Try a different search term" : "Completed payouts will appear here."}
              </p>
            </>
          ) : (
            <>
              <CheckCircle2 size={40} className="mx-auto text-emerald-500 mb-4" />
              <p className="text-[rgb(var(--text-secondary))] font-medium">All caught up!</p>
              <p className="text-sm text-[rgb(var(--text-hint))] mt-1">
                No pending {tabFilter} payouts right now.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((payout) => (
            <RentPayoutCard
              key={payout.id}
              payout={payout}
              tabFilter={tabFilter}
              copied={copied}
              onView={() => setSelectedPayout(payout)}
              onMarkLandlordPaid={() => markLandlordPaid(payout)}
              onMarkAgentPaid={() => markAgentPaid(payout)}
              onCopy={copyToClipboard}
            />
          ))}
        </div>
      )}

      {/* Detail panel */}
      {selectedPayout && (
        <RentPayoutDetailPanel
          payout={selectedPayout}
          tabFilter={tabFilter}
          copied={copied}
          onClose={() => setSelectedPayout(null)}
          onMarkLandlordPaid={() => markLandlordPaid(selectedPayout)}
          onMarkAgentPaid={() => markAgentPaid(selectedPayout)}
          onResolveDispute={(role) =>
            setDisputeToResolve({ payout: selectedPayout, role })
          }
          onCopy={copyToClipboard}
        />
      )}
      {disputeToResolve && (
        <ResolvePayoutDisputeModal
          rentalId={disputeToResolve.payout.id}
          role={disputeToResolve.role}
          amount={
            disputeToResolve.role === "landlord"
              ? disputeToResolve.payout.landlordPayout
              : disputeToResolve.payout.agentPayout
          }
          beneficiaryName={
            disputeToResolve.role === "landlord"
              ? disputeToResolve.payout.landlordName
              : disputeToResolve.payout.agentName || "The agent"
          }
          disputeReason={
            disputeToResolve.role === "landlord"
              ? disputeToResolve.payout.landlordPayoutDisputeReason
              : disputeToResolve.payout.agentPayoutDisputeReason
          }
          onSuccess={() => setDisputeToResolve(null)}
          onClose={() => setDisputeToResolve(null)}
        />
      )}
            {payoutToMark && (
        <MarkPaidModal
          docId={payoutToMark.payout.id}
          callable={
            payoutToMark.branch === "landlord"
              ? "markRentLandlordPayoutPaid"
              : "markRentAgentCommissionPaid"
          }
          amount={
            payoutToMark.branch === "landlord"
              ? payoutToMark.payout.landlordPayout
              : payoutToMark.payout.agentPayout
          }
          description={
            payoutToMark.branch === "landlord"
              ? `Landlord rent payout for ${payoutToMark.payout.propertyTitle}`
              : `Agent commission for ${payoutToMark.payout.propertyTitle}`
          }
          bank={
            payoutToMark.branch === "landlord"
              ? payoutToMark.payout.landlordBank
              : payoutToMark.payout.agentBank
          }
          onSuccess={() => {
            // Firestore listener picks up the status flip; just clear local state.
            if (selectedPayout?.id === payoutToMark.payout.id) {
              setSelectedPayout(null);
            }
            setPayoutToMark(null);
          }}
          onClose={() => setPayoutToMark(null)}
        />
      )}
    </div>
  );
}

// ─── Payout Card ──────────────────────────────────────────────────────────────

function RentPayoutCard({
  payout,
  tabFilter,
  copied,
  onView,
  onMarkLandlordPaid,
  onMarkAgentPaid,
  onCopy,
}: {
  payout: RentPayout;
  tabFilter: TabFilter;
  copied: string | null;
  onView: () => void;
  onMarkLandlordPaid: () => void;
  onMarkAgentPaid: () => void;
  onCopy: (text: string, key: string) => void;
}) {
  const isLandlordTab = tabFilter === "landlord";
  const recipientName = isLandlordTab ? payout.landlordName : (payout.agentName || "Agent");
  const amount = isLandlordTab ? payout.landlordPayout : payout.agentPayout;
  const { canWrite } = useAuth();
  const bank = isLandlordTab ? payout.landlordBank : payout.agentBank;
  const isPending = isLandlordTab
    ? payout.landlordPayoutStatus === "pending"
    : payout.agentPayoutStatus === "pending";
  const copyKey = `${payout.id}-${tabFilter}-acct`;

  return (
    <div
      className={cn(
        "card hover:border-[rgb(var(--text-hint))]/40 transition-all cursor-pointer",
        isPending && "border-amber-500/20"
      )}
      onClick={onView}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className={cn(
          "w-11 h-11 rounded-xl flex items-center justify-center shrink-0",
          isLandlordTab ? "bg-[rgb(var(--brand))]/10" : "bg-blue-500/10"
        )}>
          {isLandlordTab ? (
            <User size={20} className="text-[rgb(var(--brand))]" />
          ) : (
            <UserCheck size={20} className="text-blue-500" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">
              {recipientName}
            </p>
            <span className={cn(
              "badge",
              isLandlordTab
                ? "bg-[rgb(var(--brand))]/10 text-[rgb(var(--brand))]"
                : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
            )}>
              {isLandlordTab ? "Landlord" : "Agent"}
            </span>
            {isPending ? (
              <span className="badge-warning gap-1"><Clock size={11} />Pending</span>
            ) : (
              <span className="badge-success gap-1"><CheckCircle2 size={11} />Paid</span>
            )}
          </div>
          <p className="text-xs text-[rgb(var(--text-hint))] mt-0.5 truncate">
            {payout.propertyTitle} · Tenant: {payout.tenantName}
          </p>
          {payout.bankLoading ? (
            <p className="text-xs text-[rgb(var(--text-hint))] mt-0.5 flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" /> Loading bank details...
            </p>
          ) : bank?.accountNumber ? (
            <div className="flex items-center gap-1.5 mt-0.5" onClick={(e) => e.stopPropagation()}>
              <p className="text-xs text-[rgb(var(--text-secondary))] font-mono">
                {bank.bankName} · {bank.accountNumber}
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
            <p className="text-xs text-amber-500 mt-0.5">No bank details saved</p>
          )}
        </div>

        {/* Amount */}
        <div className="text-right shrink-0">
          <p className="text-base font-bold text-[rgb(var(--text-primary))] font-mono">
            {formatNaira(amount)}
          </p>
          <p className="text-[10px] text-[rgb(var(--text-hint))] mt-0.5">
            {payout.createdAt ? timeAgo(payout.createdAt) : ""}
          </p>
        </div>

        {/* Quick action */}
        {canWrite && isPending && (
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={isLandlordTab ? onMarkLandlordPaid : onMarkAgentPaid}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
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

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function RentPayoutDetailPanel({
  payout,
  tabFilter,
  copied,
  onClose,
  onMarkLandlordPaid,
  onMarkAgentPaid,
  onResolveDispute,
  onCopy,
}: {
  payout: RentPayout;
  tabFilter: TabFilter;
  copied: string | null;
  onClose: () => void;
  onMarkLandlordPaid: () => void;
  onMarkAgentPaid: () => void;
  onResolveDispute: (role: "landlord" | "agent") => void;
  onCopy: (text: string, key: string) => void;
}) {
  const whatsappHref = (phone: string | undefined, name: string, amount: number) =>
    phone
      ? `https://wa.me/234${phone.replace(/^0/, "")}?text=${encodeURIComponent(
          `Hi ${name}, your payout of ${formatNaira(amount)} for ${payout.propertyTitle} has been sent. Please confirm when received.`
        )}`
      : null;

  const landlordWa = whatsappHref(payout.landlordPhone, payout.landlordName, payout.landlordPayout);
  const agentWa = payout.agentId
    ? whatsappHref(payout.agentPhone, payout.agentName || "Agent", payout.agentPayout)
    : null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-full max-w-md z-50 bg-[rgb(var(--surface))] border-l border-[rgb(var(--border))] shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[rgb(var(--surface))] border-b border-[rgb(var(--border))] px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-display font-semibold text-[rgb(var(--text-primary))]">
            Rent Payout Details
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[rgb(var(--background))] transition-colors">
            <X size={18} className="text-[rgb(var(--text-secondary))]" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Deal breakdown */}
          <div className="p-4 rounded-xl bg-[rgb(var(--background))] border border-[rgb(var(--border))] space-y-2">
            <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
              Deal Breakdown
            </h4>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-[rgb(var(--text-secondary))]">Tenant paid</span>
                <span className="font-mono font-semibold">{formatNaira(payout.totalPaid)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[rgb(var(--text-secondary))]">Rent amount</span>
                <span className="font-mono">{formatNaira(payout.rentAmount)}</span>
              </div>
              {payout.agentFee > 0 && (
                <div className="flex justify-between">
                  <span className="text-[rgb(var(--text-secondary))]">Agent fee</span>
                  <span className="font-mono">{formatNaira(payout.agentFee)}</span>
                </div>
              )}
              <hr className="border-[rgb(var(--border))]" />

              {/* What ClearRent SENDS OUT */}
              <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
                <span>→ Landlord{payout.landlordName ? ` · ${payout.landlordName}` : ""}</span>
                <span className="font-mono">{formatNaira(payout.landlordPayout)}</span>
              </div>

              {/* Shown whenever an agent is ON the deal, not only when the
                  payout is positive. The old `agentPayout > 0` gate hid
                  negative splits entirely, which is what made the breakdown
                  look impossible: ClearRent appeared to keep the whole
                  payment while still paying the landlord, because a negative
                  agent row was silently missing from the arithmetic. */}
              {payout.agentId && (
                <div className="flex justify-between text-blue-600 dark:text-blue-400 font-semibold">
                  <span>→ Agent{payout.agentName ? ` · ${payout.agentName}` : ""}</span>
                  <span className="font-mono">{formatNaira(payout.agentPayout)}</span>
                </div>
              )}
              {!payout.agentId && (
                <div className="flex justify-between text-[rgb(var(--text-hint))]">
                  <span>Agent</span>
                  <span>None on this deal</span>
                </div>
              )}

              <div className="flex justify-between border-t border-[rgb(var(--border))] pt-1.5 font-semibold">
                <span className="text-[rgb(var(--text-secondary))]">
                  ClearRent sends out
                </span>
                <span className="font-mono">
                  {formatNaira(payout.landlordPayout + payout.agentPayout)}
                </span>
              </div>
              <div className="flex justify-between text-[rgb(var(--brand))] font-semibold">
                <span>ClearRent keeps</span>
                <span className="font-mono">{formatNaira(payout.clearrentEarnings)}</span>
              </div>

              <BreakdownCheck payout={payout} />
            </div>
          </div>

          {/* Landlord section */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
              Landlord — {payout.landlordPayoutStatus === "paid" ? "✅ Paid" : "⏳ Pending"}
            </h4>
            <DetailRow icon={User} label="Name" value={payout.landlordName} />
            {payout.landlordPhone && (
              <DetailRow icon={Phone} label="Phone" value={payout.landlordPhone} />
            )}
            {landlordWa && (
              <a href={landlordWa} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 hover:underline">
                <ExternalLink size={12} /> WhatsApp landlord
              </a>
            )}
            <BankSection
              bank={payout.landlordBank}
              loading={payout.bankLoading}
              label="landlord"
              payoutId={payout.id}
              copied={copied}
              onCopy={onCopy}
            />
            {payout.landlordPayoutStatus === "pending" && (
              <button
                onClick={onMarkLandlordPaid}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 transition-colors disabled:opacity-50 mt-2"
              >
                <CheckCircle2 size={16} />
                Mark Landlord Paid ({formatNaira(payout.landlordPayout)})
              </button>
            )}
            {payout.landlordPayoutStatus === "paid" && payout.landlordPaidAt && (
              <ReceiptBlock
                paidAt={payout.landlordPaidAt}
                state={payout.landlordPayoutReceipt}
                disputeReason={payout.landlordPayoutDisputeReason}
                resolutionNote={payout.landlordPayoutDisputeResolutionNote}
                proofPath={payout.landlordPayoutProofPath}
                accent="emerald"
                onResolve={() => onResolveDispute("landlord")}
              />
            )}
          </div>

          {/* Agent section (if applicable) */}
          {payout.agentId && payout.agentPayout > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
                Agent — {payout.agentPayoutStatus === "paid" ? "✅ Paid" : "⏳ Pending"}
              </h4>
              <DetailRow icon={UserCheck} label="Name" value={payout.agentName || "Agent"} />
              {payout.agentPhone && (
                <DetailRow icon={Phone} label="Phone" value={payout.agentPhone} />
              )}
              {agentWa && (
                <a href={agentWa} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 hover:underline">
                  <ExternalLink size={12} /> WhatsApp agent
                </a>
              )}
              <BankSection
                bank={payout.agentBank}
                loading={payout.bankLoading}
                label="agent"
                payoutId={payout.id}
                copied={copied}
                onCopy={onCopy}
              />
              {payout.agentPayoutStatus === "pending" && (
                <button
                  onClick={onMarkAgentPaid}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors disabled:opacity-50 mt-2"
                >
                  <CheckCircle2 size={16} />
                  Mark Agent Paid ({formatNaira(payout.agentPayout)})
                </button>
              )}
              {payout.agentPayoutStatus === "paid" && payout.agentPaidAt && (
                <ReceiptBlock
                  paidAt={payout.agentPaidAt}
                  state={payout.agentPayoutReceipt}
                  disputeReason={payout.agentPayoutDisputeReason}
                  resolutionNote={payout.agentPayoutDisputeResolutionNote}
                  proofPath={payout.agentPayoutProofPath}
                  accent="blue"
                  onResolve={() => onResolveDispute("agent")}
                />
              )}
            </div>
          )}

          {/* Property + tenant */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
              Rental Details
            </h4>
            <DetailRow icon={Building2} label="Property" value={payout.propertyTitle} />
            <DetailRow icon={Building2} label="Address" value={payout.propertyAddress} />
            <DetailRow icon={User} label="Tenant" value={payout.tenantName} />
            {payout.createdAt && (
              <DetailRow icon={Clock} label="Rental created" value={payout.createdAt.toLocaleString("en-NG")} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Shared Components ────────────────────────────────────────────────────────

/**
 * What happened AFTER we marked the payout sent. "Paid" is our side of the
 * story; this is the beneficiary's. Awaiting means they haven't answered — not
 * that anything is wrong — so it reads neutral, and only a live dispute is
 * styled as a problem.
 */
function ReceiptBlock({
  paidAt,
  state,
  disputeReason,
  resolutionNote,
  proofPath,
  accent,
  onResolve,
}: {
  paidAt: Date;
  state?: ReceiptState;
  disputeReason?: string;
  resolutionNote?: string;
  proofPath?: string;
  accent: "emerald" | "blue";
  onResolve: () => void;
}) {
  const sentLine = `Sent ${paidAt.toLocaleString("en-NG")}`;

  if (state === "disputed") {
    return (
      <div className="mt-2 space-y-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0 text-red-500" />
          <p className="text-xs font-semibold text-red-600 dark:text-red-400">
            Reported not received
          </p>
        </div>
        <p className="text-xs text-[rgb(var(--text-secondary))]">{sentLine}</p>
        {disputeReason && <p className="text-xs">{disputeReason}</p>}
        <button
          onClick={onResolve}
          className="mt-1 w-full rounded-xl bg-red-500 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-red-600"
        >
          Attach evidence & resolve
        </button>
      </div>
    );
  }

  if (state === "resolved") {
    return (
      <div className="mt-2 space-y-2 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface-hover))] p-3">
        <div className="flex items-center gap-2">
          <History size={16} className="shrink-0 text-[rgb(var(--text-hint))]" />
          <p className="text-xs font-semibold">Dispute resolved</p>
        </div>
        <p className="text-xs text-[rgb(var(--text-secondary))]">{sentLine}</p>
        {resolutionNote && <p className="text-xs">{resolutionNote}</p>}
        {proofPath && (
          <a
            href={`/api/verification-image?path=${encodeURIComponent(proofPath)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-[rgb(var(--brand))] hover:underline"
          >
            <ExternalLink size={12} /> View proof of transfer
          </a>
        )}
      </div>
    );
  }

  const confirmed = state === "confirmed";
  return (
    <div
      className={cn(
        "mt-2 flex items-center gap-3 rounded-xl p-3 border",
        accent === "emerald"
          ? "bg-emerald-500/5 border-emerald-500/20"
          : "bg-blue-500/5 border-blue-500/20"
      )}
    >
      {confirmed ? (
        <CheckCircle2
          size={16}
          className={cn(
            "shrink-0",
            accent === "emerald" ? "text-emerald-500" : "text-blue-500"
          )}
        />
      ) : (
        <Clock size={16} className="shrink-0 text-[rgb(var(--text-hint))]" />
      )}
      <p className="text-xs text-[rgb(var(--text-secondary))]">
        {sentLine}
        {" · "}
        {confirmed ? "confirmed received" : "awaiting confirmation"}
      </p>
    </div>
  );
}

function BankSection({
  bank,
  loading,
  label,
  payoutId,
  copied,
  onCopy,
}: {
  bank?: BankDetails;
  loading: boolean;
  label: string;
  payoutId: string;
  copied: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  const copyKey = `${payoutId}-${label}-panel`;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[rgb(var(--text-hint))]">
        <Loader2 size={14} className="animate-spin" /> Loading...
      </div>
    );
  }

  if (!bank?.accountNumber) {
    return (
      <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 flex items-center gap-3">
        <AlertTriangle size={14} className="text-amber-500 shrink-0" />
        <p className="text-xs text-[rgb(var(--text-secondary))]">
          No bank details saved. Contact the {label} to get their bank info.
        </p>
      </div>
    );
  }

  return (
    <div className="p-3 rounded-xl bg-[rgb(var(--background))] border border-[rgb(var(--border))] space-y-2">
      {bank.bankName && <DetailRow icon={Landmark} label="Bank" value={bank.bankName} />}
      {bank.accountName && <DetailRow icon={User} label="Account" value={bank.accountName} />}
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-[rgb(var(--surface))] flex items-center justify-center shrink-0">
          <Banknote size={13} className="text-[rgb(var(--text-hint))]" />
        </div>
        <div className="flex-1">
          <p className="text-[10px] text-[rgb(var(--text-hint))]">Account Number</p>
          <div className="flex items-center gap-2">
            <p className="text-sm font-mono font-semibold text-[rgb(var(--text-primary))] tracking-widest">
              {bank.accountNumber}
            </p>
            <button
              onClick={() => onCopy(bank.accountNumber!, copyKey)}
              className="p-1 rounded hover:bg-[rgb(var(--border))] transition-colors"
            >
              {copied === copyKey ? (
                <CheckCircle2 size={12} className="text-emerald-500" />
              ) : (
                <Copy size={12} className="text-[rgb(var(--text-hint))]" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-7 h-7 rounded-lg bg-[rgb(var(--background))] flex items-center justify-center shrink-0">
        <Icon size={13} className="text-[rgb(var(--text-hint))]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-[rgb(var(--text-hint))]">{label}</p>
        <p className="text-sm text-[rgb(var(--text-primary))] truncate">{value}</p>
      </div>
    </div>
  );
}
/**
 * Says out loud when a split does not make sense.
 *
 * The three lines above are read as a statement of fact, so a split that
 * cannot be paid has to announce itself rather than sit there looking like a
 * rendering quirk. Two things go wrong in practice:
 *
 *  - a NEGATIVE payout, when the deal fees taken out of the rent exceed the
 *    rent itself. Nothing clamps this at interest creation, and the figure is
 *    stored as-is;
 *  - parts that do not add up to what the tenant actually paid, which means
 *    the stored figures cannot all be true.
 *
 * A zero landlord payout is legal arithmetic but still unpayable, so it is
 * called out separately — the landlord is owed nothing and no transfer can be
 * made.
 */
function BreakdownCheck({ payout }: { payout: RentPayout }) {
  const parts =
    payout.landlordPayout + payout.agentPayout + payout.clearrentEarnings;
  const reconciles = Math.abs(parts - payout.totalPaid) < 1;
  const negative = payout.landlordPayout < 0 || payout.agentPayout < 0;
  const zeroLandlord = payout.landlordPayout === 0;

  if (reconciles && !negative && !zeroLandlord) return null;

  return (
    <div className="mt-2 p-3 rounded-xl bg-red-500/5 border border-red-500/20 space-y-1">
      <div className="flex items-center gap-2">
        <AlertTriangle size={14} className="text-red-500 shrink-0" />
        <p className="text-xs font-semibold text-[rgb(var(--text-primary))]">
          This split cannot be paid as it stands
        </p>
      </div>
      {negative && (
        <p className="text-xs text-[rgb(var(--text-secondary))]">
          A payout is negative — the fees deducted exceed the rent of{" "}
          {formatNaira(payout.rentAmount)}. Settle manually; do not transfer.
        </p>
      )}
      {!negative && zeroLandlord && (
        <p className="text-xs text-[rgb(var(--text-secondary))]">
          The landlord is owed nothing: the rent of{" "}
          {formatNaira(payout.rentAmount)} was fully consumed by fees.
        </p>
      )}
      {!reconciles && (
        <p className="text-xs text-[rgb(var(--text-secondary))]">
          Payouts plus earnings come to {formatNaira(parts)}, but the tenant
          paid {formatNaira(payout.totalPaid)}.
        </p>
      )}
    </div>
  );
}
