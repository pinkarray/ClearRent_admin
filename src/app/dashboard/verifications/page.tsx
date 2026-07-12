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
  getDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { parseTimestamp } from "@/types";
import { cn, capitalize, timeAgo } from "@/lib/utils";
import {
  ShieldCheck,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  XCircle,
  Loader2,
  X,
  User,
  Phone,
  Mail,
  CreditCard,
  AlertTriangle,
  Search,
  Eye,
  Users,
  ChevronRight,
} from "lucide-react";

interface PendingVerification {
  uid: string;
  requestId?: string;
  fullName: string;
  email: string;
  phone: string;
  accountType: string;
  verificationStatus: string;
  submittedAt?: Date;
  // Documents
  ninUrl?: string;
  propertyDocUrl?: string;
  utilityBillUrl?: string;
  proofOfIncomeUrl?: string;
  proofOfAddressUrl?: string;
  guarantorIdUrl?: string;
  experienceProofUrl?: string;
  // Agent guarantor
  guarantorName?: string;
  guarantorPhone?: string;
  guarantorAddress?: string;
  // Payment
  paymentProofUrl?: string;
  paymentAmount?: number;
  paymentStatus?: string;
  // Rejection
  rejectionReason?: string;
  profileImageUrl?: string;
}

type TabFilter = "pending" | "verified" | "rejected" | "all";

export default function VerificationsPage() {
  const { canWrite } = useAuth();
  const [verifications, setVerifications] = useState<PendingVerification[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabFilter, setTabFilter] = useState<TabFilter>("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedVerification, setSelectedVerification] = useState<PendingVerification | null>(null);
  const [processing, setProcessing] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Listen to all users who have submitted verification
    const q = query(
      collection(db, "users"),
      where("verificationStatus", "in", ["pending", "verified", "rejected"]),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const parsed: PendingVerification[] = snap.docs.map((d) => {
        const data = d.data();
        const docs = data.verificationDocs || {};
        return {
          uid: d.id,
          fullName: data.fullName || "Unknown",
          email: data.email || "",
          phone: data.phone || "",
          accountType: data.accountType || "unknown",
          verificationStatus: data.verificationStatus || "none",
          submittedAt: parseTimestamp(data.verificationSubmittedAt),
          profileImageUrl: data.profileImageUrl,
          // Documents
          ninUrl: docs.nin || docs.ninUrl,
          propertyDocUrl: docs.propertyDoc || docs.propertyDocUrl,
          utilityBillUrl: docs.utilityBill || docs.utilityBillUrl,
          proofOfIncomeUrl: docs.proofOfIncome || docs.proofOfIncomeUrl,
          proofOfAddressUrl: docs.proofOfAddress || docs.proofOfAddressUrl,
          guarantorIdUrl: docs.guarantorId || docs.guarantorIdUrl,
          experienceProofUrl: docs.experienceProof || docs.experienceProofUrl,
          // Agent guarantor
          guarantorName: data.guarantorName,
          guarantorPhone: data.guarantorPhone,
          guarantorAddress: data.guarantorAddress,
          // Payment
          paymentProofUrl: data.verificationPaymentProofUrl,
          paymentAmount: data.verificationPaymentAmount,
          paymentStatus: data.verificationPaymentStatus,
          rejectionReason: data.rejectionReason,
        };
      });
      setVerifications(parsed);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    return verifications.filter((v) => {
      if (tabFilter !== "all" && v.verificationStatus !== tabFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return v.fullName.toLowerCase().includes(q) || v.email.toLowerCase().includes(q);
      }
      return true;
    });
  }, [verifications, tabFilter, searchQuery]);

  const pendingCount = verifications.filter((v) => v.verificationStatus === "pending").length;
  const verifiedCount = verifications.filter((v) => v.verificationStatus === "verified").length;
  const rejectedCount = verifications.filter((v) => v.verificationStatus === "rejected").length;

  // ── Actions ──

  const handleApprove = async (uid: string) => {
    if (!canWrite) return;
    setProcessing((prev) => new Set(prev).add(uid));
    try {
      await updateDoc(doc(db, "users", uid), {
        verificationStatus: "verified",
        isVerified: true,
        verificationReviewedAt: serverTimestamp(),
        verificationPaymentStatus: "verified",
        updatedAt: serverTimestamp(),
      });
      // Close panel if this was the selected one
      if (selectedVerification?.uid === uid) setSelectedVerification(null);
    } catch (err) {
      console.error("Error approving:", err);
    } finally {
      setProcessing((prev) => {
        const next = new Set(prev);
        next.delete(uid);
        return next;
      });
    }
  };

  const handleReject = async (uid: string, reason: string) => {
    if (!canWrite || !reason.trim()) return;
    setProcessing((prev) => new Set(prev).add(uid));
    try {
      await updateDoc(doc(db, "users", uid), {
        verificationStatus: "rejected",
        isVerified: false,
        rejectionReason: reason,
        verificationReviewedAt: serverTimestamp(),
        verificationPaymentStatus: "rejected",
        updatedAt: serverTimestamp(),
      });
      if (selectedVerification?.uid === uid) setSelectedVerification(null);
    } catch (err) {
      console.error("Error rejecting:", err);
    } finally {
      setProcessing((prev) => {
        const next = new Set(prev);
        next.delete(uid);
        return next;
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-display font-bold text-[rgb(var(--text-primary))]">
          Verification Center
        </h1>
        <p className="text-sm text-[rgb(var(--text-secondary))] mt-1">
          Review identity documents and approve or reject user verifications.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {([
          ["Pending", pendingCount, "pending"] as const,
          ["Verified", verifiedCount, "verified"] as const,
          ["Rejected", rejectedCount, "rejected"] as const,
          ["All", verifications.length, "all"] as const,
        ]).map(([label, count, filter]) => (
          <button
            key={filter}
            onClick={() => setTabFilter(filter)}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-medium transition-all relative",
              tabFilter === filter
                ? "bg-[rgb(var(--brand))]/10 text-[rgb(var(--brand))] border border-[rgb(var(--brand))]/30"
                : "bg-[rgb(var(--surface))] text-[rgb(var(--text-secondary))] border border-[rgb(var(--border))] hover:border-[rgb(var(--text-hint))]"
            )}
          >
            {label}
            <span className="ml-2 text-xs opacity-70">{count}</span>
            {filter === "pending" && count > 0 && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-500 rounded-full animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[rgb(var(--text-hint))]" />
        <input
          type="text"
          placeholder="Search by name or email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input pl-10"
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-[rgb(var(--brand))]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16">
          <ShieldCheck size={40} className="mx-auto text-[rgb(var(--text-hint))] mb-4" />
          <p className="text-[rgb(var(--text-secondary))] font-medium">
            {tabFilter === "pending" ? "No pending verifications" : "No verifications found"}
          </p>
          <p className="text-sm text-[rgb(var(--text-hint))] mt-1">
            {tabFilter === "pending" ? "All caught up!" : "Adjust your search or filters"}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((v) => (
            <VerificationCard
              key={v.uid}
              verification={v}
              canWrite={canWrite}
              isProcessing={processing.has(v.uid)}
              onSelect={() => setSelectedVerification(v)}
              onApprove={() => handleApprove(v.uid)}
              onReject={(reason) => handleReject(v.uid, reason)}
            />
          ))}
        </div>
      )}

      {/* Document Viewer Panel */}
      {selectedVerification && (
        <DocumentViewerPanel
          verification={selectedVerification}
          canWrite={canWrite}
          isProcessing={processing.has(selectedVerification.uid)}
          onClose={() => setSelectedVerification(null)}
          onApprove={() => handleApprove(selectedVerification.uid)}
          onReject={(reason) => handleReject(selectedVerification.uid, reason)}
        />
      )}
    </div>
  );
}

// ── Verification Card ───────────────────────────────────────────────────────

function VerificationCard({
  verification: v,
  canWrite,
  isProcessing,
  onSelect,
  onApprove,
  onReject,
}: {
  verification: PendingVerification;
  canWrite: boolean;
  isProcessing: boolean;
  onSelect: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
}) {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const typeColor: Record<string, string> = {
    landlord: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
    tenant: "text-blue-600 dark:text-blue-400 bg-blue-500/10",
    agent: "text-purple-600 dark:text-purple-400 bg-purple-500/10",
  };

  const statusConfig: Record<string, { cls: string; label: string }> = {
    pending: { cls: "badge-warning", label: "Pending Review" },
    verified: { cls: "badge-success", label: "Approved" },
    rejected: { cls: "badge-error", label: "Rejected" },
  };
  const status = statusConfig[v.verificationStatus] || statusConfig.pending;

  const docCount = [v.ninUrl, v.propertyDocUrl, v.utilityBillUrl, v.proofOfIncomeUrl, v.proofOfAddressUrl, v.guarantorIdUrl, v.experienceProofUrl].filter(Boolean).length;

  return (
    <div className={cn("card", v.verificationStatus === "pending" && "border-amber-500/30")}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        {/* User info */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={cn("w-11 h-11 rounded-full flex items-center justify-center font-semibold shrink-0", typeColor[v.accountType] || typeColor.tenant)}>
            {v.fullName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-[rgb(var(--text-primary))] truncate">{v.fullName}</p>
              <span className={cn("badge text-[10px]", typeColor[v.accountType] || typeColor.tenant)}>
                {capitalize(v.accountType)}
              </span>
              <span className={cn(status.cls, "text-[10px]")}>{status.label}</span>
            </div>
            <p className="text-xs text-[rgb(var(--text-hint))] truncate">{v.email}</p>
            {v.submittedAt && (
              <p className="text-[11px] text-[rgb(var(--text-hint))] mt-0.5">
                Submitted {timeAgo(v.submittedAt)}
              </p>
            )}
          </div>
        </div>

        {/* Quick info + actions */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Document count */}
          <button
            onClick={onSelect}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[rgb(var(--background))] hover:bg-[rgb(var(--border))] transition-colors text-sm"
          >
            <FileText size={14} className="text-[rgb(var(--text-hint))]" />
            <span className="text-[rgb(var(--text-secondary))]">{docCount} docs</span>
            <ChevronRight size={12} className="text-[rgb(var(--text-hint))]" />
          </button>

          {/* Payment badge */}
          {v.paymentAmount && v.paymentAmount > 0 && (
            <span className="badge-info text-[10px] gap-1">
              <CreditCard size={10} />
              ₦{v.paymentAmount.toLocaleString()}
            </span>
          )}

          {/* Action buttons (only for pending) */}
          {canWrite && v.verificationStatus === "pending" && !showRejectInput && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowRejectInput(true)}
                disabled={isProcessing}
                className="p-2 rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                title="Reject"
              >
                <XCircle size={16} />
              </button>
              <button
                onClick={onApprove}
                disabled={isProcessing}
                className="p-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
                title="Approve"
              >
                {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Reject reason input */}
      {showRejectInput && (
        <div className="mt-4 pt-4 border-t border-[rgb(var(--border))]">
          <p className="text-xs font-medium text-red-500 mb-2">Rejection Reason</p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="e.g. Documents unclear, NIN doesn't match..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="input flex-1 text-sm"
              autoFocus
            />
            <button
              onClick={() => { setShowRejectInput(false); setRejectReason(""); }}
              className="btn-secondary py-2 px-3 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() => { onReject(rejectReason); setShowRejectInput(false); }}
              disabled={!rejectReason.trim() || isProcessing}
              className="px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 disabled:opacity-50 transition-colors"
            >
              {isProcessing ? <Loader2 size={14} className="animate-spin" /> : "Reject"}
            </button>
          </div>
        </div>
      )}

      {/* Show rejection reason for rejected verifications */}
      {v.verificationStatus === "rejected" && v.rejectionReason && (
        <div className="mt-4 pt-4 border-t border-[rgb(var(--border))]">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={12} className="text-red-500" />
            <span className="text-xs font-medium text-red-500">Rejected</span>
          </div>
          <p className="text-sm text-[rgb(var(--text-secondary))]">{v.rejectionReason}</p>
        </div>
      )}
    </div>
  );
}

// ── Document Viewer Panel ───────────────────────────────────────────────────

function DocumentViewerPanel({
  verification: v,
  canWrite,
  isProcessing,
  onClose,
  onApprove,
  onReject,
}: {
  verification: PendingVerification;
  canWrite: boolean;
  isProcessing: boolean;
  onClose: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
}) {
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);

  // Fetch a private Storage doc through the admin-guarded route, with the
  // admin's ID token in the Authorization header, then show it as a blob URL.
  // The token never rides in a URL.
  const openDoc = async (path: string) => {
    try {
      setLoadingDoc(true);
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) return;
      const res = await fetch(
        `/api/verification-image?path=${encodeURIComponent(path)}`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      if (!res.ok) {
        console.error("Failed to load document:", res.status);
        return;
      }
      const blob = await res.blob();
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      console.error("Error loading document:", err);
    } finally {
      setLoadingDoc(false);
    }
  };

  // Build document list based on account type. Values are Storage PATHS now,
  // not URLs — resolved to bytes at view time via openDoc.
  const documents: { label: string; path?: string }[] = [];
  documents.push({ label: "NIN / Government ID", path: v.ninUrl });

  if (v.accountType === "landlord") {
    documents.push({ label: "Property Document", path: v.propertyDocUrl });
    documents.push({ label: "Utility Bill", path: v.utilityBillUrl });
  } else if (v.accountType === "tenant") {
    documents.push({ label: "Proof of Income", path: v.proofOfIncomeUrl });
  } else if (v.accountType === "agent") {
    documents.push({ label: "Proof of Address", path: v.proofOfAddressUrl });
    documents.push({ label: "Guarantor ID", path: v.guarantorIdUrl });
    if (v.experienceProofUrl) {
      documents.push({ label: "Experience Proof", path: v.experienceProofUrl });
    }
  }

  if (v.paymentProofUrl) {
    documents.push({ label: "Payment Proof", path: v.paymentProofUrl });
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Image preview overlay */}
      {previewUrl && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4" onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }}>
          <button className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors" onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }}>
            <X size={20} className="text-white" />
          </button>
          <img src={previewUrl} alt="Document preview" className="max-w-full max-h-[85vh] rounded-lg object-contain" />
        </div>
      )}

      <div className="fixed top-0 right-0 h-full w-full max-w-lg z-50 bg-[rgb(var(--surface))] border-l border-[rgb(var(--border))] shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[rgb(var(--surface))] border-b border-[rgb(var(--border))] px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-display font-semibold text-[rgb(var(--text-primary))]">Review Documents</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[rgb(var(--background))] transition-colors">
            <X size={18} className="text-[rgb(var(--text-secondary))]" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* User header */}
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-[rgb(var(--brand))]/10 flex items-center justify-center text-[rgb(var(--brand))] font-semibold">
              {v.fullName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
            </div>
            <div>
              <h3 className="font-semibold text-[rgb(var(--text-primary))]">{v.fullName}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-[rgb(var(--text-hint))]">{v.email}</span>
                <span className="badge text-[10px] bg-[rgb(var(--brand))]/10 text-[rgb(var(--brand))]">
                  {capitalize(v.accountType)}
                </span>
              </div>
            </div>
          </div>

          {/* Contact */}
          {v.phone && (
            <div className="flex items-center gap-2 text-sm text-[rgb(var(--text-secondary))]">
              <Phone size={14} />
              {v.phone}
            </div>
          )}

          {/* Payment info */}
          {v.paymentAmount && v.paymentAmount > 0 && (
            <div className="p-4 rounded-xl bg-[rgb(var(--brand))]/5 border border-[rgb(var(--brand))]/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CreditCard size={16} className="text-[rgb(var(--brand))]" />
                  <span className="text-sm font-medium text-[rgb(var(--text-primary))]">Verification Fee</span>
                </div>
                <span className="font-semibold text-[rgb(var(--brand))]">₦{v.paymentAmount.toLocaleString()}</span>
              </div>
              <p className="text-xs text-[rgb(var(--text-hint))] mt-1">
                Status: {capitalize(v.paymentStatus?.replace(/_/g, " ") || "unknown")}
              </p>
            </div>
          )}

          {/* Agent guarantor info */}
          {v.accountType === "agent" && v.guarantorName && (
            <div className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/20">
              <p className="text-xs font-medium text-purple-600 dark:text-purple-400 mb-2">Guarantor Information</p>
              <div className="space-y-1 text-sm text-[rgb(var(--text-secondary))]">
                <p><span className="text-[rgb(var(--text-hint))]">Name:</span> {v.guarantorName}</p>
                {v.guarantorPhone && <p><span className="text-[rgb(var(--text-hint))]">Phone:</span> {v.guarantorPhone}</p>}
                {v.guarantorAddress && <p><span className="text-[rgb(var(--text-hint))]">Address:</span> {v.guarantorAddress}</p>}
              </div>
            </div>
          )}

          {/* Documents */}
          <div>
            <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider mb-3">Submitted Documents</h4>
            <div className="space-y-2">
              {documents.map((d, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-xl border transition-colors",
                    d.path
                      ? "border-[rgb(var(--border))] hover:bg-[rgb(var(--background))] cursor-pointer"
                      : "border-dashed border-[rgb(var(--border))] opacity-50"
                  )}
                  onClick={() => d.path && !loadingDoc && openDoc(d.path)}
                >
                  <div className={cn(
                    "w-9 h-9 rounded-lg flex items-center justify-center",
                    d.path ? "bg-[rgb(var(--brand))]/10" : "bg-[rgb(var(--background))]"
                  )}>
                    {d.path ? <ImageIcon size={16} className="text-[rgb(var(--brand))]" /> : <FileText size={16} className="text-[rgb(var(--text-hint))]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[rgb(var(--text-primary))]">{d.label}</p>
                    <p className="text-[11px] text-[rgb(var(--text-hint))]">{d.path ? "Tap to preview" : "Not uploaded"}</p>
                  </div>
                  {loadingDoc && <Loader2 size={14} className="animate-spin text-[rgb(var(--text-hint))]" />}
                </div>
              ))}
            </div>
          </div>

          {/* Action buttons (only for pending) */}
          {canWrite && v.verificationStatus === "pending" && (
            <div className="pt-4 border-t border-[rgb(var(--border))] space-y-3">
              {!showReject ? (
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowReject(true)}
                    disabled={isProcessing}
                    className="flex-1 py-3 rounded-xl border border-red-500/30 text-red-500 font-semibold hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    onClick={onApprove}
                    disabled={isProcessing}
                    className="flex-1 py-3 rounded-xl bg-emerald-500 text-white font-semibold hover:bg-emerald-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                    Approve
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs font-medium text-red-500">Why are you rejecting this?</p>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="e.g. NIN photo is blurry, property document name doesn't match..."
                    className="input min-h-[80px] text-sm"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowReject(false); setRejectReason(""); }}
                      className="btn-secondary flex-1 text-sm py-2.5"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => onReject(rejectReason)}
                      disabled={!rejectReason.trim() || isProcessing}
                      className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                    >
                      {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                      Reject Verification
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}