"use client";

import { useEffect, useState, useMemo } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { parseTimestamp } from "@/types";
import { cn, timeAgo } from "@/lib/utils";
import {
  CreditCard,
  Search,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  ExternalLink,
  Building2,
  User,
  Phone,
  AlertTriangle,
  Clock,
  RotateCcw,
  Banknote,
  Home,
  ShieldCheck,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type PaymentType = "inspection" | "rent" | "listing_fee";
type TabFilter = "pending" | "confirmed" | "refunded" | "all";

interface Payment {
  id: string;
  type: PaymentType;

  // Who paid
  tenantId: string;
  tenantName: string;
  tenantPhone?: string;

  // What they paid for
  propertyId: string;
  propertyTitle: string;
  propertyAddress: string;

  // Landlord
  landlordId?: string;
  landlordName?: string;
  landlordPhone?: string;

  // Amount
  amount: number;

  // Payment evidence
  paymentProofUrl?: string;
  paymentReference?: string;

  // Status
  paymentStatus: string; // pending_verification | paid | refunded | not_required
  refundReason?: string;

  // Timestamps
  paidAt?: Date;
  verifiedAt?: Date;
  refundedAt?: Date;
  createdAt: Date;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatNaira(amount: number) {
  if (amount >= 1_000_000) return `₦${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `₦${(amount / 1_000).toFixed(0)}K`;
  return `₦${amount.toLocaleString()}`;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const { canWrite } = useAuth();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabFilter, setTabFilter] = useState<TabFilter>("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [processing, setProcessing] = useState<Set<string>>(new Set());

  // ── Listeners ──────────────────────────────────────────────────────────────

  useEffect(() => {
    let loaded = { inspection: false, rent: false, listingFee: false };
    let inspectionPayments: Payment[] = [];
    let rentPayments: Payment[] = [];
    let listingFeePayments: Payment[] = [];

    const merge = () => {
      if (loaded.inspection && loaded.rent && loaded.listingFee) {
        const all = [...inspectionPayments, ...rentPayments, ...listingFeePayments].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
        );
        setPayments(all);
        setLoading(false);
      }
    };

    // Inspection payments — paymentStatus in [pending_verification, paid, refunded]
    const inspQ = query(
      collection(db, "inspection_requests"),
      where("paymentStatus", "in", ["pending_verification", "paid", "refunded"]),
      orderBy("createdAt", "desc")
    );

    const unsubInsp = onSnapshot(inspQ, (snap) => {
      inspectionPayments = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          type: "inspection" as PaymentType,
          tenantId: data.tenantId || "",
          tenantName: data.tenantName || "Unknown",
          tenantPhone: data.tenantPhone,
          propertyId: data.propertyId || "",
          propertyTitle: data.propertyTitle || "Unknown Property",
          propertyAddress: data.propertyAddress || "",
          landlordId: data.landlordId,
          landlordName: data.landlordName,
          landlordPhone: data.landlordPhone,
          amount: (data.totalFee || 0) as number,
          paymentProofUrl: data.paymentProofUrl,
          paymentReference: data.paymentReference,
          paymentStatus: data.paymentStatus || "pending_verification",
          refundReason: data.refundReason,
          paidAt: parseTimestamp(data.paidAt),
          verifiedAt: parseTimestamp(data.paymentVerifiedAt),
          refundedAt: parseTimestamp(data.refundedAt),
          createdAt: parseTimestamp(data.createdAt) || new Date(),
        };
      });
      loaded.inspection = true;
      merge();
    });

    // Rent payments — rental_interests with status paymentUploaded or paymentVerified
    const rentQ = query(
      collection(db, "rental_interests"),
      where("status", "in",
        ["payment_uploaded", "payment_verified", "rejected", "lost_to_other"]),
      orderBy("createdAt", "desc")
    );

    const unsubRent = onSnapshot(rentQ, (snap) => {
      rentPayments = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          type: "rent" as PaymentType,
          tenantId: data.tenantId || "",
          tenantName: data.tenantName || "Unknown",
          tenantPhone: data.tenantPhone,
          propertyId: data.propertyId || "",
          propertyTitle: data.propertyTitle || "Unknown Property",
          propertyAddress: data.propertyAddress || "",
          landlordId: data.landlordId,
          landlordName: data.landlordName,
          landlordPhone: data.landlordPhone,
          amount: (data.paymentAmount || 0) as number,
          paymentProofUrl: data.paymentProofUrl,
          paymentReference: data.paymentReference,
          paymentStatus:
            data.status === "payment_uploaded"
              ? "pending_verification"
              : data.status === "payment_verified"
              ? "paid"
              : "refunded",
          refundReason: data.refundReason,
          paidAt: parseTimestamp(data.paidAt),
          verifiedAt: parseTimestamp(data.paymentVerifiedAt),
          refundedAt: parseTimestamp(data.refundedAt),
          createdAt: parseTimestamp(data.createdAt) || new Date(),
        };
      });
      loaded.rent = true;
      merge();
    });

    // Listing fee payments — properties with listingFeeStatus in [pending, approved, rejected]
    // Note: no orderBy to avoid composite index requirement — sorted client-side in merge()
    const listingQ = query(
      collection(db, "properties"),
      where("listingFeeStatus", "in", ["pending", "approved", "rejected"])
    );

    const unsubListing = onSnapshot(
      listingQ,
      (snap) => {
        listingFeePayments = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            type: "listing_fee" as PaymentType,
            tenantId: data.landlordId || "",
            tenantName: data.landlordName || "Unknown Landlord",
            tenantPhone: data.landlordPhone,
            propertyId: d.id,
            propertyTitle: data.title || "Unknown Property",
            // Exact street address is in the gated subdoc now — show area-level.
            propertyAddress:
              [data.city, data.state].filter(Boolean).join(", ") ||
              data.address ||
              "",
            landlordId: data.landlordId,
            landlordName: data.landlordName,
            landlordPhone: data.landlordPhone,
            amount: 10000,
            paymentProofUrl: data.listingFeeProofUrl,
            paymentReference: undefined,
            paymentStatus:
              data.listingFeeStatus === "pending"
                ? "pending_verification"
                : data.listingFeeStatus === "approved"
                ? "paid"
                : "refunded",
            refundReason: data.listingFeeRejectionReason,
            paidAt: parseTimestamp(data.createdAt),
            verifiedAt: parseTimestamp(data.listingFeeVerifiedAt),
            refundedAt: parseTimestamp(data.listingFeeRejectedAt),
            createdAt: parseTimestamp(data.createdAt) || new Date(),
          };
        });
        loaded.listingFee = true;
        merge();
      },
      (error) => {
        console.error("❌ Listing fee query failed:", error);
        // Don't block the page — just mark as loaded with empty results
        listingFeePayments = [];
        loaded.listingFee = true;
        merge();
      }
    );

    return () => {
      unsubInsp();
      unsubRent();
      unsubListing();
    };
  }, []);

  // ── Counts ─────────────────────────────────────────────────────────────────

  const pendingCount = payments.filter(
    (p) => p.paymentStatus === "pending_verification"
  ).length;
  const confirmedCount = payments.filter(
    (p) => p.paymentStatus === "paid"
  ).length;
  const refundedCount = payments.filter(
    (p) => p.paymentStatus === "refunded"
  ).length;

  // ── Filtering ──────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return payments.filter((p) => {
      const matchTab =
        tabFilter === "all" ||
        (tabFilter === "pending" && p.paymentStatus === "pending_verification") ||
        (tabFilter === "confirmed" && p.paymentStatus === "paid") ||
        (tabFilter === "refunded" && p.paymentStatus === "refunded");

      const q = searchQuery.toLowerCase();
      const matchSearch =
        !searchQuery ||
        p.tenantName.toLowerCase().includes(q) ||
        p.propertyTitle.toLowerCase().includes(q) ||
        (p.tenantPhone && p.tenantPhone.includes(q)) ||
        (p.paymentReference && p.paymentReference.toLowerCase().includes(q));

      return matchTab && matchSearch;
    });
  }, [payments, tabFilter, searchQuery]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const confirmPayment = async (payment: Payment) => {
    if (!canWrite || processing.has(payment.id)) return;
    setProcessing((s) => new Set(s).add(payment.id));
    try {
      if (payment.type === "inspection") {
        await updateDoc(doc(db, "inspection_requests", payment.id), {
          paymentStatus: "paid",
          paymentVerifiedAt: serverTimestamp(),
          status: "pending",
          updatedAt: serverTimestamp(),
        });
      } else if (payment.type === "listing_fee") {
        await updateDoc(doc(db, "properties", payment.id), {
          listingFeeStatus: "approved",
          listingFeeVerifiedAt: serverTimestamp(),
          isAvailable: true,
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, "rental_interests", payment.id), {
          status: "payment_verified",
          isPaymentVerified: true,
          paymentVerifiedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      if (selectedPayment?.id === payment.id) setSelectedPayment(null);
    } finally {
      setProcessing((s) => {
        const n = new Set(s);
        n.delete(payment.id);
        return n;
      });
    }
  };

  const refundPayment = async (payment: Payment, reason: string) => {
    if (!canWrite || processing.has(payment.id)) return;
    setProcessing((s) => new Set(s).add(payment.id));
    try {
      if (payment.type === "inspection") {
        await updateDoc(doc(db, "inspection_requests", payment.id), {
          paymentStatus: "refunded",
          refundReason: reason,
          refundedAt: serverTimestamp(),
          status: "refunded",
          updatedAt: serverTimestamp(),
        });
      } else if (payment.type === "listing_fee") {
        await updateDoc(doc(db, "properties", payment.id), {
          listingFeeStatus: "rejected",
          listingFeeRejectionReason: reason,
          listingFeeRejectedAt: serverTimestamp(),
          isAvailable: false,
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, "rental_interests", payment.id), {
          status: "rejected",
          refundReason: reason,
          refundedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      if (selectedPayment?.id === payment.id) setSelectedPayment(null);
    } finally {
      setProcessing((s) => {
        const n = new Set(s);
        n.delete(payment.id);
        return n;
      });
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-[rgb(var(--text-primary))]">
            Payments
          </h1>
          <p className="text-sm text-[rgb(var(--text-secondary))] mt-1">
            {payments.length} total ·{" "}
            <span className="text-amber-500 font-medium">
              {pendingCount} pending
            </span>{" "}
            · {confirmedCount} confirmed · {refundedCount} refunded
          </p>
        </div>
      </div>

      {/* Pending alert banner */}
      {pendingCount > 0 && (
        <div className="card border-amber-500/30 bg-amber-500/5 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle size={18} className="text-amber-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">
              {pendingCount} payment{pendingCount !== 1 ? "s" : ""} awaiting
              confirmation
            </p>
            <p className="text-xs text-[rgb(var(--text-secondary))] mt-0.5">
              Review the payment proof and confirm or refund each one. Tenants
              are waiting.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["Pending", pendingCount, "pending"],
            ["Confirmed", confirmedCount, "confirmed"],
            ["Refunded", refundedCount, "refunded"],
            ["All", payments.length, "all"],
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
          placeholder="Search by tenant, property, or reference..."
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
          <CreditCard
            size={40}
            className="mx-auto text-[rgb(var(--text-hint))] mb-4"
          />
          <p className="text-[rgb(var(--text-secondary))] font-medium">
            No payments found
          </p>
          <p className="text-sm text-[rgb(var(--text-hint))] mt-1">
            {searchQuery ? "Try a different search term" : "Adjust your filters"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((payment) => (
            <PaymentCard
              key={`${payment.type}-${payment.id}`}
              payment={payment}
              canWrite={canWrite}
              processing={processing.has(payment.id)}
              onView={() => setSelectedPayment(payment)}
              onConfirm={() => confirmPayment(payment)}
            />
          ))}
        </div>
      )}

      {/* Detail panel */}
      {selectedPayment && (
        <PaymentDetailPanel
          payment={selectedPayment}
          canWrite={canWrite}
          processing={processing.has(selectedPayment.id)}
          onClose={() => setSelectedPayment(null)}
          onConfirm={() => confirmPayment(selectedPayment)}
          onRefund={(reason) => refundPayment(selectedPayment, reason)}
        />
      )}
    </div>
  );
}

// ─── Payment Card ─────────────────────────────────────────────────────────────

function PaymentCard({
  payment,
  canWrite,
  processing,
  onView,
  onConfirm,
}: {
  payment: Payment;
  canWrite: boolean;
  processing: boolean;
  onView: () => void;
  onConfirm: () => void;
}) {
  const isPending = payment.paymentStatus === "pending_verification";

  return (
    <div
      className={cn(
        "card flex flex-col sm:flex-row sm:items-center gap-4 cursor-pointer hover:border-[rgb(var(--text-hint))]/40 transition-all",
        isPending && "border-amber-500/30"
      )}
      onClick={onView}
    >
      {/* Type icon */}
      <div
        className={cn(
          "w-11 h-11 rounded-xl flex items-center justify-center shrink-0",
          payment.type === "inspection"
            ? "bg-purple-500/10"
            : "bg-emerald-500/10"
        )}
      >
        {payment.type === "inspection" ? (
          <ShieldCheck size={20} className="text-purple-500" />
        ) : (
          <Home size={20} className="text-emerald-500" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">
            {payment.tenantName}
          </p>
          <TypeBadge type={payment.type} />
          <StatusBadge status={payment.paymentStatus} />
        </div>
        <p className="text-xs text-[rgb(var(--text-hint))] mt-0.5 truncate">
          {payment.propertyTitle} · {payment.propertyAddress}
        </p>
        <p className="text-xs text-[rgb(var(--text-hint))] mt-0.5">
          {payment.createdAt ? timeAgo(payment.createdAt) : "—"}
          {payment.paymentReference && (
            <span className="ml-2 font-mono opacity-60">
              #{payment.paymentReference.slice(-8)}
            </span>
          )}
        </p>
      </div>

      {/* Amount */}
      <div className="text-right shrink-0">
        <p className="text-base font-bold text-[rgb(var(--text-primary))] font-mono">
          {formatNaira(payment.amount)}
        </p>
        {isPending && payment.paymentProofUrl && (
          <p className="text-[10px] text-amber-500 mt-0.5">Proof attached</p>
        )}
      </div>

      {/* Actions */}
      <div
        className="flex items-center gap-2 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onView}
          className="p-2 rounded-lg hover:bg-[rgb(var(--background))] text-[rgb(var(--text-hint))] transition-colors"
          title="View details"
        >
          <Eye size={16} />
        </button>
        {canWrite && isPending && (
          <button
            onClick={onConfirm}
            disabled={processing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
          >
            {processing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <CheckCircle2 size={13} />
            )}
            Confirm
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function PaymentDetailPanel({
  payment,
  canWrite,
  processing,
  onClose,
  onConfirm,
  onRefund,
}: {
  payment: Payment;
  canWrite: boolean;
  processing: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onRefund: (reason: string) => void;
}) {
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [refundReason, setRefundReason] = useState("");

  const isPending = payment.paymentStatus === "pending_verification";
  const isConfirmed = payment.paymentStatus === "paid";

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-full max-w-md z-50 bg-[rgb(var(--surface))] border-l border-[rgb(var(--border))] shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[rgb(var(--surface))] border-b border-[rgb(var(--border))] px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-display font-semibold text-[rgb(var(--text-primary))]">
            Payment Details
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-[rgb(var(--background))] transition-colors"
          >
            <X size={18} className="text-[rgb(var(--text-secondary))]" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Type + Status */}
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center",
                payment.type === "inspection"
                  ? "bg-purple-500/10"
                  : "bg-emerald-500/10"
              )}
            >
              {payment.type === "inspection" ? (
                <ShieldCheck size={22} className="text-purple-500" />
              ) : (
                <Home size={22} className="text-emerald-500" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <TypeBadge type={payment.type} />
                <StatusBadge status={payment.paymentStatus} />
              </div>
              <p className="text-2xl font-bold text-[rgb(var(--text-primary))] font-mono mt-1">
                {formatNaira(payment.amount)}
              </p>
            </div>
          </div>

          {/* Tenant */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
              Tenant
            </h4>
            <DetailRow icon={User} label="Name" value={payment.tenantName} />
            {payment.tenantPhone && (
              <DetailRow
                icon={Phone}
                label="Phone"
                value={payment.tenantPhone}
              />
            )}
          </div>

          {/* Property */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
              Property
            </h4>
            <DetailRow
              icon={Building2}
              label="Title"
              value={payment.propertyTitle}
            />
            <DetailRow
              icon={Building2}
              label="Address"
              value={payment.propertyAddress}
            />
            {payment.landlordName && (
              <DetailRow
                icon={User}
                label="Landlord"
                value={payment.landlordName}
              />
            )}
            {payment.landlordPhone && (
              <DetailRow
                icon={Phone}
                label="Landlord Phone"
                value={payment.landlordPhone}
              />
            )}
          </div>

          {/* Payment info */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
              Payment Info
            </h4>
            {payment.paymentReference && (
              <DetailRow
                icon={Banknote}
                label="Reference"
                value={payment.paymentReference}
              />
            )}
            {payment.paidAt && (
              <DetailRow
                icon={Clock}
                label="Paid At"
                value={payment.paidAt.toLocaleString("en-NG")}
              />
            )}
            {payment.verifiedAt && (
              <DetailRow
                icon={CheckCircle2}
                label="Confirmed At"
                value={payment.verifiedAt.toLocaleString("en-NG")}
              />
            )}
            {payment.refundedAt && (
              <DetailRow
                icon={RotateCcw}
                label="Refunded At"
                value={payment.refundedAt.toLocaleString("en-NG")}
              />
            )}
          </div>

          {/* Payment proof */}
          {payment.paymentProofUrl && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
                Payment Proof
              </h4>
              <div className="rounded-xl overflow-hidden border border-[rgb(var(--border))] bg-[rgb(var(--background))]">
                <img
                  src={payment.paymentProofUrl}
                  alt="Payment proof"
                  className="w-full object-contain max-h-64"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
              <a
                href={payment.paymentProofUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-[rgb(var(--brand))] hover:underline"
              >
                <ExternalLink size={12} />
                Open full image
              </a>
            </div>
          )}

          {/* Refund reason (if refunded) */}
          {payment.paymentStatus === "refunded" && payment.refundReason && (
            <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/20">
              <div className="flex items-center gap-2 mb-1">
                <RotateCcw size={13} className="text-red-500" />
                <span className="text-xs font-semibold text-red-500">
                  Refund Reason
                </span>
              </div>
              <p className="text-sm text-[rgb(var(--text-secondary))]">
                {payment.refundReason}
              </p>
            </div>
          )}

          {/* Actions — only for pending */}
          {canWrite && isPending && (
            <div className="space-y-3 pt-2">
              {!showRefundForm ? (
                <>
                  <button
                    onClick={onConfirm}
                    disabled={processing}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 transition-colors disabled:opacity-50"
                  >
                    {processing ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={16} />
                    )}
                    Confirm Payment
                  </button>
                  <button
                    onClick={() => setShowRefundForm(true)}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-red-500/30 text-red-500 text-sm font-semibold hover:bg-red-500/5 transition-colors"
                  >
                    <RotateCcw size={16} />
                    Mark for Refund
                  </button>
                </>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-[rgb(var(--text-primary))]">
                    Reason for refund
                  </p>
                  <textarea
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    placeholder="Explain why this payment is being refunded..."
                    rows={3}
                    className="input w-full resize-none text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setShowRefundForm(false);
                        setRefundReason("");
                      }}
                      className="flex-1 py-2.5 rounded-xl border border-[rgb(var(--border))] text-sm text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        if (refundReason.trim()) onRefund(refundReason.trim());
                      }}
                      disabled={!refundReason.trim() || processing}
                      className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-50"
                    >
                      {processing ? (
                        <Loader2
                          size={14}
                          className="animate-spin mx-auto"
                        />
                      ) : (
                        "Confirm Refund"
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Confirmed state note */}
          {isConfirmed && (
            <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 flex items-center gap-3">
              <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
              <p className="text-sm text-[rgb(var(--text-secondary))]">
                This payment has been confirmed.{" "}
                {payment.type === "rent"
                  ? "The landlord can now accept or reject this tenant."
                  : payment.type === "listing_fee"
                  ? "The property is now live and visible to tenants."
                  : "The inspection can proceed."}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Shared Components ────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: PaymentType }) {
  if (type === "inspection") {
    return (
      <span className="badge bg-purple-500/10 text-purple-600 dark:text-purple-400">
        Inspection
      </span>
    );
  } else if (type === "listing_fee") {
    return (
      <span className="badge bg-blue-500/10 text-blue-600 dark:text-blue-400">
        Listing Fee
      </span>
    );
  } else {
    return (
      <span className="badge bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        Rent
      </span>
    );
  }
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: any; label: string }> = {
    pending_verification: {
      cls: "badge-warning",
      icon: Clock,
      label: "Pending",
    },
    paid: { cls: "badge-success", icon: CheckCircle2, label: "Confirmed" },
    refunded: { cls: "badge-error", icon: RotateCcw, label: "Refunded" },
  };
  const cfg = map[status] || map.pending_verification;
  return (
    <span className={cn(cfg.cls, "gap-1")}>
      <cfg.icon size={11} />
      {cfg.label}
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