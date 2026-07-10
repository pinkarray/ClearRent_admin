"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, query, where, orderBy, onSnapshot, doc, getDoc,} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { fetchBankDetails } from "@/lib/bank";
import { parseTimestamp } from "@/types";
import { cn, timeAgo } from "@/lib/utils";
import { Banknote, Search, X, Loader2, CheckCircle2, Clock, Copy, Phone, User, Building2, AlertTriangle, Landmark, UserCheck, History, ExternalLink,} from "lucide-react";
import { MarkPaidModal } from "@/components/MarkPaidModal";
// ─── Types ────────────────────────────────────────────────────────────────────

type TabFilter = "landlord" | "agent" | "paid";

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
          onCopy={copyToClipboard}
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
        {isPending && (
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
  onCopy,
}: {
  payout: RentPayout;
  tabFilter: TabFilter;
  copied: string | null;
  onClose: () => void;
  onMarkLandlordPaid: () => void;
  onMarkAgentPaid: () => void;
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
              <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
                <span>Landlord payout</span>
                <span className="font-mono">{formatNaira(payout.landlordPayout)}</span>
              </div>
              {payout.agentPayout > 0 && (
                <div className="flex justify-between text-blue-600 dark:text-blue-400 font-semibold">
                  <span>Agent payout</span>
                  <span className="font-mono">{formatNaira(payout.agentPayout)}</span>
                </div>
              )}
              <div className="flex justify-between text-[rgb(var(--brand))] font-semibold">
                <span>ClearRent keeps</span>
                <span className="font-mono">{formatNaira(payout.clearrentEarnings)}</span>
              </div>
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
              <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 flex items-center gap-3">
                <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                <p className="text-xs text-[rgb(var(--text-secondary))]">
                  Paid {payout.landlordPaidAt.toLocaleString("en-NG")}
                </p>
              </div>
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
                <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/20 flex items-center gap-3">
                  <CheckCircle2 size={16} className="text-blue-500 shrink-0" />
                  <p className="text-xs text-[rgb(var(--text-secondary))]">
                    Paid {payout.agentPaidAt.toLocaleString("en-NG")}
                  </p>
                </div>
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