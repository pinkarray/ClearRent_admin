"use client";

import { useEffect, useState, useMemo } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { parseTimestamp } from "@/types";
import { cn, timeAgo } from "@/lib/utils";
import {
  Wallet,
  Search,
  X,
  Loader2,
  CheckCircle2,
  Clock,
  Copy,
  Phone,
  User,
  Building2,
  AlertTriangle,
  Landmark,
  UserCheck,
  History,
  ExternalLink,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type TabFilter = "pending" | "paid";

interface BankDetails {
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
}

interface Payout {
  id: string;

  // Property
  propertyId: string;
  propertyTitle: string;
  propertyAddress: string;
  propertyImage?: string;

  // Handler — agent or self-handled landlord
  handlerType: "agent" | "landlord";
  handlerId: string;
  handlerName: string;
  handlerPhone?: string;

  // Tenant (who paid for the inspection)
  tenantName: string;

  // Amounts
  agentEarnings: number;
  totalFee: number;

  // Payout status
  agentPayoutStatus: string; // pending | paid
  agentPaidAt?: Date;
  agentPaidBy?: string;

  // Inspection completion
  completedAt?: Date;
  createdAt: Date;

  // Bank details (loaded separately)
  bankDetails?: BankDetails;
  bankLoading: boolean;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatNaira(amount: number) {
  if (amount >= 1_000_000) return `₦${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `₦${(amount / 1_000).toFixed(0)}K`;
  return `₦${amount.toLocaleString()}`;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PayoutsPage() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabFilter, setTabFilter] = useState<TabFilter>("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPayout, setSelectedPayout] = useState<Payout | null>(null);
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);

  // ── Listener ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const q = query(
      collection(db, "inspection_requests"),
      where("agentPayoutStatus", "in", ["pending", "paid"]),
      where("status", "==", "completed"),
      orderBy("completedAt", "desc")
    );

    const unsub = onSnapshot(q, async (snap) => {
      const base: Payout[] = snap.docs.map((d) => {
        const data = d.data();
        const isAgentHandled =
          data.completedByType === "agent" ||
          (!data.completedByType && !!data.agentId);

        return {
          id: d.id,
          propertyId: data.propertyId || "",
          propertyTitle: data.propertyTitle || "Unknown Property",
          propertyAddress: data.propertyAddress || "",
          propertyImage: data.propertyImage,
          handlerType: isAgentHandled ? "agent" : "landlord",
          handlerId: isAgentHandled
            ? data.agentId || ""
            : data.landlordId || "",
          handlerName: isAgentHandled
            ? data.agentName || "Agent"
            : data.landlordName || "Landlord",
          handlerPhone: isAgentHandled ? data.agentPhone : data.landlordPhone,
          tenantName: data.tenantName || "Unknown",
          agentEarnings: (data.agentEarnings || 0) as number,
          totalFee: (data.totalFee || 0) as number,
          agentPayoutStatus: data.agentPayoutStatus || "pending",
          agentPaidAt: parseTimestamp(data.agentPaidAt),
          agentPaidBy: data.agentPaidBy,
          completedAt: parseTimestamp(data.completedAt),
          createdAt: parseTimestamp(data.createdAt) || new Date(),
          bankLoading: true,
        };
      });

      setPayouts(base);
      setLoading(false);

      // Load bank details for each handler in background
      base.forEach(async (payout) => {
        if (!payout.handlerId) return;
        try {
          const userDoc = await getDoc(doc(db, "users", payout.handlerId));
          if (userDoc.exists()) {
            const d = userDoc.data();
            const bank: BankDetails = {
              bankName: d.bankName || d.bankDetails?.bankName,
              accountName: d.accountName || d.bankDetails?.accountName,
              accountNumber: d.accountNumber || d.bankDetails?.accountNumber,
            };
            setPayouts((prev) =>
              prev.map((p) =>
                p.id === payout.id
                  ? { ...p, bankDetails: bank, bankLoading: false }
                  : p
              )
            );
          } else {
            setPayouts((prev) =>
              prev.map((p) =>
                p.id === payout.id ? { ...p, bankLoading: false } : p
              )
            );
          }
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

  const pendingCount = payouts.filter(
    (p) => p.agentPayoutStatus === "pending"
  ).length;
  const paidCount = payouts.filter((p) => p.agentPayoutStatus === "paid").length;

  const totalPendingAmount = payouts
    .filter((p) => p.agentPayoutStatus === "pending")
    .reduce((sum, p) => sum + p.agentEarnings, 0);

  // ── Filtering ──────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return payouts.filter((p) => {
      const matchTab =
        tabFilter === "pending"
          ? p.agentPayoutStatus === "pending"
          : p.agentPayoutStatus === "paid";

      const q = searchQuery.toLowerCase();
      const matchSearch =
        !searchQuery ||
        p.handlerName.toLowerCase().includes(q) ||
        p.propertyTitle.toLowerCase().includes(q) ||
        p.tenantName.toLowerCase().includes(q);

      return matchTab && matchSearch;
    });
  }, [payouts, tabFilter, searchQuery]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const markAsPaid = async (payout: Payout) => {
    if (processing.has(payout.id)) return;
    setProcessing((s) => new Set(s).add(payout.id));
    try {
      await updateDoc(doc(db, "inspection_requests", payout.id), {
        agentPayoutStatus: "paid",
        agentPaidAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (selectedPayout?.id === payout.id) setSelectedPayout(null);
    } finally {
      setProcessing((s) => {
        const n = new Set(s);
        n.delete(payout.id);
        return n;
      });
    }
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
          Agent Payouts
        </h1>
        <p className="text-sm text-[rgb(var(--text-secondary))] mt-1">
          {payouts.length} total ·{" "}
          <span className="text-amber-500 font-medium">
            {pendingCount} pending
          </span>{" "}
          · {paidCount} paid
        </p>
      </div>

      {/* Pending summary banner */}
      {pendingCount > 0 && (
        <div className="card border-amber-500/30 bg-amber-500/5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-start gap-3 flex-1">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle size={18} className="text-amber-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">
                {pendingCount} handler{pendingCount !== 1 ? "s" : ""} awaiting
                payment
              </p>
              <p className="text-xs text-[rgb(var(--text-secondary))] mt-0.5">
                Total outstanding:{" "}
                <span className="font-semibold text-amber-500">
                  {formatNaira(totalPendingAmount)}
                </span>
              </p>
            </div>
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
          placeholder="Search by handler, property, or tenant..."
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
          {tabFilter === "pending" ? (
            <>
              <CheckCircle2
                size={40}
                className="mx-auto text-emerald-500 mb-4"
              />
              <p className="text-[rgb(var(--text-secondary))] font-medium">
                All caught up!
              </p>
              <p className="text-sm text-[rgb(var(--text-hint))] mt-1">
                No pending payouts right now.
              </p>
            </>
          ) : (
            <>
              <History
                size={40}
                className="mx-auto text-[rgb(var(--text-hint))] mb-4"
              />
              <p className="text-[rgb(var(--text-secondary))] font-medium">
                No payment history
              </p>
              <p className="text-sm text-[rgb(var(--text-hint))] mt-1">
                {searchQuery
                  ? "Try a different search term"
                  : "Completed payouts will appear here."}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((payout) => (
            <PayoutCard
              key={payout.id}
              payout={payout}
              processing={processing.has(payout.id)}
              copied={copied}
              onView={() => setSelectedPayout(payout)}
              onMarkPaid={() => markAsPaid(payout)}
              onCopy={copyToClipboard}
            />
          ))}
        </div>
      )}

      {/* Detail panel */}
      {selectedPayout && (
        <PayoutDetailPanel
          payout={selectedPayout}
          processing={processing.has(selectedPayout.id)}
          copied={copied}
          onClose={() => setSelectedPayout(null)}
          onMarkPaid={() => markAsPaid(selectedPayout)}
          onCopy={copyToClipboard}
        />
      )}
    </div>
  );
}

// ─── Payout Card ──────────────────────────────────────────────────────────────

function PayoutCard({
  payout,
  processing,
  copied,
  onView,
  onMarkPaid,
  onCopy,
}: {
  payout: Payout;
  processing: boolean;
  copied: string | null;
  onView: () => void;
  onMarkPaid: () => void;
  onCopy: (text: string, key: string) => void;
}) {
  const isPending = payout.agentPayoutStatus === "pending";
  const accountNumber = payout.bankDetails?.accountNumber;
  const copyKey = `${payout.id}-acct`;

  return (
    <div
      className={cn(
        "card hover:border-[rgb(var(--text-hint))]/40 transition-all cursor-pointer",
        isPending && "border-amber-500/20"
      )}
      onClick={onView}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        {/* Handler icon */}
        <div
          className={cn(
            "w-11 h-11 rounded-xl flex items-center justify-center shrink-0",
            payout.handlerType === "agent"
              ? "bg-blue-500/10"
              : "bg-[rgb(var(--brand))]/10"
          )}
        >
          {payout.handlerType === "agent" ? (
            <UserCheck size={20} className="text-blue-500" />
          ) : (
            <User size={20} className="text-[rgb(var(--brand))]" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">
              {payout.handlerName}
            </p>
            <HandlerBadge type={payout.handlerType} />
            <StatusBadge status={payout.agentPayoutStatus} />
          </div>
          <p className="text-xs text-[rgb(var(--text-hint))] mt-0.5 truncate">
            {payout.propertyTitle}
          </p>
          {/* Bank account preview */}
          {payout.bankLoading ? (
            <p className="text-xs text-[rgb(var(--text-hint))] mt-0.5 flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" /> Loading bank
              details...
            </p>
          ) : payout.bankDetails?.accountNumber ? (
            <div
              className="flex items-center gap-1.5 mt-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-xs text-[rgb(var(--text-secondary))] font-mono">
                {payout.bankDetails.bankName} ·{" "}
                {payout.bankDetails.accountNumber}
              </p>
              <button
                onClick={() =>
                  onCopy(payout.bankDetails!.accountNumber!, copyKey)
                }
                className="text-[rgb(var(--text-hint))] hover:text-[rgb(var(--brand))] transition-colors"
                title="Copy account number"
              >
                {copied === copyKey ? (
                  <CheckCircle2 size={11} className="text-emerald-500" />
                ) : (
                  <Copy size={11} />
                )}
              </button>
            </div>
          ) : (
            <p className="text-xs text-amber-500 mt-0.5">
              No bank details saved
            </p>
          )}
        </div>

        {/* Amount */}
        <div className="text-right shrink-0">
          <p className="text-base font-bold text-[rgb(var(--text-primary))] font-mono">
            {formatNaira(payout.agentEarnings)}
          </p>
          <p className="text-[10px] text-[rgb(var(--text-hint))] mt-0.5">
            {payout.completedAt ? timeAgo(payout.completedAt) : ""}
          </p>
        </div>

        {/* Actions */}
        {isPending && (
          <div
            className="shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={onMarkPaid}
              disabled={processing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
            >
              {processing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <CheckCircle2 size={13} />
              )}
              Mark Paid
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function PayoutDetailPanel({
  payout,
  processing,
  copied,
  onClose,
  onMarkPaid,
  onCopy,
}: {
  payout: Payout;
  processing: boolean;
  copied: string | null;
  onClose: () => void;
  onMarkPaid: () => void;
  onCopy: (text: string, key: string) => void;
}) {
  const isPending = payout.agentPayoutStatus === "pending";

  const whatsappHref = payout.handlerPhone
    ? `https://wa.me/234${payout.handlerPhone.replace(/^0/, "")}?text=${encodeURIComponent(
        `Hi ${payout.handlerName}, your inspection payout of ${formatNaira(payout.agentEarnings)} for the property at ${payout.propertyTitle} has been sent. Please confirm when received.`
      )}`
    : null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-full max-w-md z-50 bg-[rgb(var(--surface))] border-l border-[rgb(var(--border))] shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[rgb(var(--surface))] border-b border-[rgb(var(--border))] px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-display font-semibold text-[rgb(var(--text-primary))]">
            Payout Details
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-[rgb(var(--background))] transition-colors"
          >
            <X size={18} className="text-[rgb(var(--text-secondary))]" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Amount + status */}
          <div className="flex items-center gap-4">
            <div
              className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center",
                payout.handlerType === "agent"
                  ? "bg-blue-500/10"
                  : "bg-[rgb(var(--brand))]/10"
              )}
            >
              {payout.handlerType === "agent" ? (
                <UserCheck size={22} className="text-blue-500" />
              ) : (
                <User size={22} className="text-[rgb(var(--brand))]" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <HandlerBadge type={payout.handlerType} />
                <StatusBadge status={payout.agentPayoutStatus} />
              </div>
              <p className="text-2xl font-bold text-[rgb(var(--text-primary))] font-mono mt-1">
                {formatNaira(payout.agentEarnings)}
              </p>
            </div>
          </div>

          {/* Handler info */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
              Handler
            </h4>
            <DetailRow icon={User} label="Name" value={payout.handlerName} />
            {payout.handlerPhone && (
              <DetailRow
                icon={Phone}
                label="Phone"
                value={payout.handlerPhone}
              />
            )}
            {payout.handlerPhone && whatsappHref && (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
              >
                <ExternalLink size={12} />
                Message on WhatsApp
              </a>
            )}
          </div>

          {/* Bank details */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
              Bank Details
            </h4>
            {payout.bankLoading ? (
              <div className="flex items-center gap-2 text-sm text-[rgb(var(--text-hint))]">
                <Loader2 size={14} className="animate-spin" />
                Loading...
              </div>
            ) : payout.bankDetails?.accountNumber ? (
              <div className="p-4 rounded-xl bg-[rgb(var(--background))] border border-[rgb(var(--border))] space-y-3">
                {payout.bankDetails.bankName && (
                  <DetailRow
                    icon={Landmark}
                    label="Bank"
                    value={payout.bankDetails.bankName}
                  />
                )}
                {payout.bankDetails.accountName && (
                  <DetailRow
                    icon={User}
                    label="Account Name"
                    value={payout.bankDetails.accountName}
                  />
                )}
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[rgb(var(--surface))] flex items-center justify-center shrink-0">
                    <Copy
                      size={14}
                      className="text-[rgb(var(--text-hint))]"
                    />
                  </div>
                  <div className="flex-1">
                    <p className="text-[11px] text-[rgb(var(--text-hint))]">
                      Account Number
                    </p>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-mono font-semibold text-[rgb(var(--text-primary))] tracking-widest">
                        {payout.bankDetails.accountNumber}
                      </p>
                      <button
                        onClick={() =>
                          onCopy(
                            payout.bankDetails!.accountNumber!,
                            `${payout.id}-panel`
                          )
                        }
                        className="p-1 rounded hover:bg-[rgb(var(--border))] transition-colors"
                        title="Copy"
                      >
                        {copied === `${payout.id}-panel` ? (
                          <CheckCircle2
                            size={13}
                            className="text-emerald-500"
                          />
                        ) : (
                          <Copy
                            size={13}
                            className="text-[rgb(var(--text-hint))]"
                          />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 flex items-center gap-3">
                <AlertTriangle size={16} className="text-amber-500 shrink-0" />
                <p className="text-sm text-[rgb(var(--text-secondary))]">
                  No bank details saved. Contact the{" "}
                  {payout.handlerType === "agent" ? "agent" : "landlord"} to
                  get their bank info before paying.
                </p>
              </div>
            )}
          </div>

          {/* Property */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
              Inspection
            </h4>
            <DetailRow
              icon={Building2}
              label="Property"
              value={payout.propertyTitle}
            />
            <DetailRow
              icon={Building2}
              label="Address"
              value={payout.propertyAddress}
            />
            <DetailRow icon={User} label="Tenant" value={payout.tenantName} />
            {payout.completedAt && (
              <DetailRow
                icon={Clock}
                label="Completed"
                value={payout.completedAt.toLocaleString("en-NG")}
              />
            )}
          </div>

          {/* Paid info */}
          {payout.agentPayoutStatus === "paid" && payout.agentPaidAt && (
            <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 flex items-center gap-3">
              <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
              <div>
                <p className="text-sm font-medium text-[rgb(var(--text-primary))]">
                  Payment sent
                </p>
                <p className="text-xs text-[rgb(var(--text-secondary))] mt-0.5">
                  {payout.agentPaidAt.toLocaleString("en-NG")}
                </p>
              </div>
            </div>
          )}

          {/* Mark paid action */}
          {isPending && (
            <div className="pt-2">
              <button
                onClick={onMarkPaid}
                disabled={processing}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 transition-colors disabled:opacity-50"
              >
                {processing ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={16} />
                )}
                Mark as Paid
              </button>
              <p className="text-xs text-center text-[rgb(var(--text-hint))] mt-2">
                Only mark as paid after you have transferred the funds.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Shared Components ────────────────────────────────────────────────────────

function HandlerBadge({ type }: { type: "agent" | "landlord" }) {
  return type === "agent" ? (
    <span className="badge bg-blue-500/10 text-blue-600 dark:text-blue-400">
      Agent
    </span>
  ) : (
    <span className="badge bg-[rgb(var(--brand))]/10 text-[rgb(var(--brand))]">
      Self-handled
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return status === "paid" ? (
    <span className="badge-success gap-1">
      <CheckCircle2 size={11} />
      Paid
    </span>
  ) : (
    <span className="badge-warning gap-1">
      <Clock size={11} />
      Pending
    </span>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-[rgb(var(--background))] flex items-center justify-center shrink-0">
        <Icon size={14} className="text-[rgb(var(--text-hint))]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-[rgb(var(--text-hint))]">{label}</p>
        <p className="text-sm text-[rgb(var(--text-primary))] truncate">
          {value}
        </p>
      </div>
    </div>
  );
}