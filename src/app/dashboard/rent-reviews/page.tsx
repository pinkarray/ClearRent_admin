"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, query, where, onSnapshot, getDocs } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { parseTimestamp } from "@/types";
import { cn, timeAgo } from "@/lib/utils";
import {
  TrendingUp,
  Search,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Calendar,
  ArrowRight,
  Home,
  Bolt,
  CalendarClock,
  HeartPulse,
  Wrench,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { RentReviewDecisionModal } from "@/components/RentReviewDecisionModal";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RentReview {
  id: string;
  landlordId: string;
  tenantId: string;
  rentalId: string;
  propertyId: string;
  propertyTitle: string;
  currentRent: number;
  proposedRent: number;
  effectiveDate?: Date;
  reasonType: "improvements" | "market" | "both";
  justification: string;
  revisedAgreementUrl: string;
  changeType: "scheduled" | "immediate";
  status: string;
  createdAt: Date;
}

// Which approve CF to call, keyed by change type. Reject is always
// rejectRentReview regardless of type.
type DecisionTarget = {
  review: RentReview;
  mode: "approve" | "reject";
};

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString("en-NG")}`;
}

const REASON_LABELS: Record<RentReview["reasonType"], string> = {
  improvements: "Improvements",
  market: "Market rate",
  both: "Improvements + market",
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RentReviewsPage() {
  const [reviews, setReviews] = useState<RentReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [decision, setDecision] = useState<DecisionTarget | null>(null);

  // ── Listener ───────────────────────────────────────────────────────────────
  // Query by status only (single-field equality, no composite index needed),
  // then sort newest-first client-side. The pending set is small. Once a CF
  // flips status off "pending", the listener drops the row automatically.
  useEffect(() => {
    const q = query(
      collection(db, "rent_review_requests"),
      where("status", "==", "pending")
    );

    const unsub = onSnapshot(q, (snap) => {
      const rows: RentReview[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          landlordId: data.landlordId || "",
          tenantId: data.tenantId || "",
          rentalId: data.rentalId || "",
          propertyId: data.propertyId || "",
          propertyTitle: data.propertyTitle || "Unknown Property",
          currentRent: (data.currentRent || 0) as number,
          proposedRent: (data.proposedRent || 0) as number,
          effectiveDate: parseTimestamp(data.effectiveDate),
          reasonType: (data.reasonType || "market") as RentReview["reasonType"],
          justification: data.justification || "",
          revisedAgreementUrl: data.revisedAgreementUrl || "",
          changeType: (data.changeType || "scheduled") as RentReview["changeType"],
          status: data.status || "pending",
          createdAt: parseTimestamp(data.createdAt) || new Date(),
        };
      });

      rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setReviews(rows);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  // ── Counts ───────────────────────────────────────────────────────────────
  const scheduledCount = reviews.filter((r) => r.changeType === "scheduled").length;
  const immediateCount = reviews.filter((r) => r.changeType === "immediate").length;

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return reviews.filter(
      (r) => !searchQuery || r.propertyTitle.toLowerCase().includes(q)
    );
  }, [reviews, searchQuery]);

  // The approve callable depends on the change type; reject is uniform.
  const decisionCallable = (() => {
    if (!decision) return null;
    if (decision.mode === "reject") return "rejectRentReview" as const;
    return decision.review.changeType === "immediate"
      ? ("approveImmediateRentChange" as const)
      : ("approveRentReview" as const);
  })();

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-display font-bold text-[rgb(var(--text-primary))]">
          Rent Reviews
        </h1>
        <p className="text-sm text-[rgb(var(--text-secondary))] mt-1">
          {reviews.length} pending ·{" "}
          <span className="text-blue-500 font-medium">{scheduledCount} scheduled</span>{" "}
          · <span className="text-amber-500 font-medium">{immediateCount} immediate</span>
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search
          size={16}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[rgb(var(--text-hint))]"
        />
        <input
          type="text"
          placeholder="Search by property..."
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
          <CheckCircle2 size={40} className="mx-auto text-emerald-500 mb-4" />
          <p className="text-[rgb(var(--text-secondary))] font-medium">
            All caught up!
          </p>
          <p className="text-sm text-[rgb(var(--text-hint))] mt-1">
            {searchQuery
              ? "No pending reviews match your search."
              : "No pending rent reviews right now."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((review) => (
            <RentReviewCard
              key={review.id}
              review={review}
              onApprove={() => setDecision({ review, mode: "approve" })}
              onReject={() => setDecision({ review, mode: "reject" })}
            />
          ))}
        </div>
      )}

      {/* Decision modal */}
      {decision && decisionCallable && (
        <RentReviewDecisionModal
          requestId={decision.review.id}
          mode={decision.mode}
          callable={decisionCallable}
          description={`${decision.review.propertyTitle} · ${formatNaira(
            decision.review.currentRent
          )} → ${formatNaira(decision.review.proposedRent)}`}
          onSuccess={() => {
            // Firestore listener drops the row once status flips; just clear.
            setDecision(null);
          }}
          onClose={() => setDecision(null)}
        />
      )}
    </div>
  );
}

// ─── Rent Review Card ─────────────────────────────────────────────────────────

function RentReviewCard({
  review,
  onApprove,
  onReject,
}: {
  review: RentReview;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { canWrite } = useAuth();
  const isRaise = review.proposedRent > review.currentRent;
  const [loadingDoc, setLoadingDoc] = useState(false);

  // The revised agreement is now a private Storage path — stream it through the
  // admin-token-gated route. Legacy Cloudinary docs are public http URLs.
  const openAgreement = async (urlOrPath: string) => {
    if (/^https?:\/\//i.test(urlOrPath)) {
      window.open(urlOrPath, "_blank", "noopener,noreferrer");
      return;
    }
    setLoadingDoc(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) return;
      const res = await fetch(
        `/api/verification-image?path=${encodeURIComponent(urlOrPath)}`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      if (!res.ok) {
        console.error("Failed to load agreement:", res.status);
        return;
      }
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("Error loading agreement:", err);
    } finally {
      setLoadingDoc(false);
    }
  };

  return (
    <div className="card border-[rgb(var(--border))]">
      <div className="flex flex-col gap-4">
        {/* Top row: property + change type badge */}
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-[rgb(var(--brand))]/10 flex items-center justify-center shrink-0">
            <Home size={20} className="text-[rgb(var(--brand))]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-[rgb(var(--text-primary))] truncate">
                {review.propertyTitle}
              </p>
              <ChangeTypeBadge type={review.changeType} />
            </div>
            <p className="text-[10px] text-[rgb(var(--text-hint))] mt-0.5 flex items-center gap-1">
              <Clock size={10} /> Filed {timeAgo(review.createdAt)}
            </p>
          </div>
        </div>

        {/* Rent change */}
        <div className="flex items-center gap-3 flex-wrap">
          <div
            className="flex items-center gap-2 font-mono"
            style={{ fontFamily: "Roboto, monospace" }}
          >
            <span className="text-sm text-[rgb(var(--text-secondary))] line-through">
              {formatNaira(review.currentRent)}
            </span>
            <ArrowRight size={14} className="text-[rgb(var(--text-hint))]" />
            <span className="text-base font-bold text-[rgb(var(--text-primary))]">
              {formatNaira(review.proposedRent)}
            </span>
          </div>
          <span
            className={cn(
              "badge gap-1",
              isRaise
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            )}
          >
            <TrendingUp
              size={11}
              className={cn(!isRaise && "rotate-180")}
            />
            {isRaise ? "Increase" : "Reduction"}
          </span>
        </div>

        {/* Meta: reason + effective date (scheduled only) */}
        <div className="flex flex-col gap-2 text-xs">
          <div className="flex items-center gap-2 text-[rgb(var(--text-secondary))]">
            <span className="text-[rgb(var(--text-hint))]">Reason:</span>
            <span className="font-medium text-[rgb(var(--text-primary))]">
              {REASON_LABELS[review.reasonType]}
            </span>
          </div>
          {review.changeType === "scheduled" && review.effectiveDate && (
            <div className="flex items-center gap-2 text-[rgb(var(--text-secondary))]">
              <Calendar size={12} className="text-[rgb(var(--text-hint))]" />
              <span className="text-[rgb(var(--text-hint))]">Effective:</span>
              <span className="font-medium text-[rgb(var(--text-primary))]">
                {review.effectiveDate.toLocaleDateString("en-NG", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>
          )}
        </div>

        {/* Justification */}
        {review.justification && (
          <div className="p-3 rounded-xl bg-[rgb(var(--background))] border border-[rgb(var(--border))]">
            <p className="text-[11px] text-[rgb(var(--text-hint))] uppercase tracking-wider mb-1">
              Justification
            </p>
            <p className="text-sm text-[rgb(var(--text-secondary))] whitespace-pre-wrap">
              {review.justification}
            </p>
          </div>
        )}

        {/* Revised agreement (scheduled) */}
        {review.revisedAgreementUrl && (
          <button
            onClick={() => openAgreement(review.revisedAgreementUrl)}
            disabled={loadingDoc}
            className="flex items-center gap-2 p-3 rounded-xl border border-[rgb(var(--border))] hover:border-[rgb(var(--brand))]/40 hover:bg-[rgb(var(--brand))]/5 transition-colors disabled:opacity-50 text-left w-full"
          >
            {loadingDoc ? (
              <Loader2 size={16} className="text-[rgb(var(--brand))] shrink-0 animate-spin" />
            ) : (
              <FileText size={16} className="text-[rgb(var(--brand))] shrink-0" />
            )}
            <span className="text-sm font-medium text-[rgb(var(--text-primary))] flex-1">
              View revised tenancy agreement
            </span>
            <ArrowRight size={14} className="text-[rgb(var(--text-hint))]" />
          </button>
        )}

        {/* Fairness context — live read of the property's issues / maintenance */}
        <FairnessPanel propertyId={review.propertyId} />

        {/* Actions */}
        {canWrite && (
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={onReject}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-red-500/30 text-red-500 text-sm font-semibold hover:bg-red-500/10 transition-colors"
            >
              <XCircle size={15} />
              Reject
            </button>
            <button
              onClick={onApprove}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 transition-colors"
            >
              <CheckCircle2 size={15} />
              Approve
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Fairness Panel (live read) ──────────────────────────────────────────────
// Queries the property's issues + maintenance logs live when the card mounts,
// so the admin sees the current maintenance picture next to the increase. No
// snapshot is stored — this reflects state at review time (E-2).

interface FairnessIssue {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
}

// Mirrors PropertyHealthScreen._computeHealthScore in the mobile app so the
// admin sees the same number the landlord/tenant see.
function healthScore(issues: FairnessIssue[]): number {
  if (issues.length === 0) return 100;
  const penalty = issues.reduce((acc, i) => {
    if (i.status === "open") return acc + 15;
    if (i.status === "in_progress") return acc + 8;
    if (i.status === "pending_confirmation") return acc + 5;
    return acc;
  }, 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

function scoreTone(score: number): string {
  if (score >= 80)
    return "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
  if (score >= 50)
    return "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30";
  return "text-red-500 bg-red-500/10 border-red-500/30";
}

function FairnessPanel({ propertyId }: { propertyId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [issues, setIssues] = useState<FairnessIssue[]>([]);
  const [maintenanceCount, setMaintenanceCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const [issuesSnap, maintSnap] = await Promise.all([
          getDocs(
            query(collection(db, "issues"), where("propertyId", "==", propertyId))
          ),
          getDocs(
            query(
              collection(db, "maintenance_logs"),
              where("propertyId", "==", propertyId)
            )
          ),
        ]);
        if (cancelled) return;
        setIssues(
          issuesSnap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              title: data.title || "Untitled issue",
              status: data.status || "open",
              createdAt: parseTimestamp(data.createdAt) || new Date(),
            };
          })
        );
        setMaintenanceCount(maintSnap.size);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  const open = issues.filter((i) => i.status === "open").length;
  const inProgress = issues.filter((i) => i.status === "in_progress").length;
  const pending = issues.filter(
    (i) => i.status === "pending_confirmation"
  ).length;
  const resolved = issues.filter((i) => i.status === "resolved").length;
  const score = healthScore(issues);
  const recentUnresolved = issues
    .filter((i) => i.status === "open" || i.status === "in_progress")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 4);

  return (
    <div className="p-3 rounded-xl bg-[rgb(var(--background))] border border-[rgb(var(--border))] space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <HeartPulse size={14} className="text-[rgb(var(--text-hint))]" />
          <p className="text-[11px] text-[rgb(var(--text-hint))] uppercase tracking-wider">
            Property fairness context
          </p>
        </div>
        {!loading && !error && (
          <span className={cn("badge border gap-1", scoreTone(score))}>
            {score}% health
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-[rgb(var(--text-hint))]">
          <Loader2 size={12} className="animate-spin" /> Loading property
          history…
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-xs text-red-500">
          <AlertTriangle size={12} /> Couldn&apos;t load property history.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <FairnessStat label="Open" value={open} tone="bad" icon={AlertTriangle} />
            <FairnessStat label="In progress" value={inProgress} tone="warn" icon={Clock} />
            <FairnessStat label="Pending" value={pending} tone="warn" icon={Clock} />
            <FairnessStat label="Resolved" value={resolved} tone="ok" icon={CheckCircle2} />
            <FairnessStat label="Maintenance logs" value={maintenanceCount} tone="ok" icon={Wrench} />
          </div>

          {recentUnresolved.length > 0 && (
            <div className="space-y-1.5 pt-1">
              {recentUnresolved.map((i) => (
                <div key={i.id} className="flex items-center gap-2 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                  <span className="text-[rgb(var(--text-secondary))] truncate flex-1">
                    {i.title}
                  </span>
                  <span className="text-[rgb(var(--text-hint))] shrink-0">
                    {timeAgo(i.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {issues.length === 0 && maintenanceCount === 0 && (
            <p className="text-xs text-[rgb(var(--text-hint))]">
              No issues or maintenance logged for this property.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function FairnessStat({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "bad";
  icon: any;
}) {
  // Tone only "lights up" when the count is non-zero; zero stays neutral.
  const toneCls =
    value === 0
      ? "text-[rgb(var(--text-secondary))]"
      : tone === "bad"
        ? "text-red-500"
        : tone === "warn"
          ? "text-amber-500"
          : "text-[rgb(var(--text-secondary))]";
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[rgb(var(--surface))] border border-[rgb(var(--border))]">
      <Icon size={12} className={toneCls} />
      <span className={cn("text-xs font-semibold", toneCls)}>{value}</span>
      <span className="text-[11px] text-[rgb(var(--text-hint))]">{label}</span>
    </div>
  );
}

// ─── Shared Components ────────────────────────────────────────────────────────

function ChangeTypeBadge({ type }: { type: "scheduled" | "immediate" }) {
  return type === "immediate" ? (
    <span className="badge bg-amber-500/10 text-amber-600 dark:text-amber-400 gap-1">
      <Bolt size={11} />
      Immediate
    </span>
  ) : (
    <span className="badge bg-blue-500/10 text-blue-600 dark:text-blue-400 gap-1">
      <CalendarClock size={11} />
      Scheduled
    </span>
  );
}
