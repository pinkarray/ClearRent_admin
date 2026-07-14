"use client";

import { useDashboardStats } from "@/hooks/use-stats";
import {
  AlertTriangle,
  ShieldCheck,
  CreditCard,
  FileCheck,
  ClipboardCheck,
  RotateCcw,
  TrendingUp,
  ArrowRight,
  Bell,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * "Items needing your attention" banner. Mounted in the dashboard shell so it
 * appears on every admin screen (not just the dashboard) and surfaces pending
 * property-doc reviews, identity verifications, payments, and open issues.
 * Hides itself when there's nothing pending.
 */
export function AttentionBanner() {
  const stats = useDashboardStats();
  const router = useRouter();

  // Pending property ownership docs (C of O / deed) awaiting admin review.
  const [pendingPropertyDocs, setPendingPropertyDocs] = useState(0);
  // Past inspections with no clear outcome (sweep flagged for admin).
  const [inspectionReviews, setInspectionReviews] = useState(0);
  // Refund records awaiting payout (inspection refunds → refunds collection).
  const [pendingRefunds, setPendingRefunds] = useState(0);
  // Landlord rent-review / rent-change requests awaiting an admin decision.
  const [pendingRentReviews, setPendingRentReviews] = useState(0);
  // Open cross-domain admin alerts (disputes, agreement issues, identity
  // changes, …) — the unified feed on /dashboard/alerts.
  const [openAlerts, setOpenAlerts] = useState(0);

  useEffect(() => {
    const q = query(
      collection(db, "properties"),
      where("ownershipDocStatus", "==", "pending")
    );
    const unsub = onSnapshot(q, (snap) => {
      setPendingPropertyDocs(snap.size);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, "inspection_requests"),
      where("status", "==", "awaitingOutcome")
    );
    const unsub = onSnapshot(q, (snap) => {
      setInspectionReviews(snap.size);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, "refunds"),
      where("status", "==", "pending")
    );
    const unsub = onSnapshot(q, (snap) => {
      setPendingRefunds(snap.size);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, "rent_review_requests"),
      where("status", "==", "pending")
    );
    const unsub = onSnapshot(q, (snap) => {
      setPendingRentReviews(snap.size);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, "admin_alerts"),
      where("status", "==", "open")
    );
    const unsub = onSnapshot(q, (snap) => {
      // Only actionable alerts belong in the attention banner. Info-level
      // items (inspection lifecycle, rent payments, the daily digest) live in
      // the Alerts feed but shouldn't inflate "needs your attention".
      const actionable = snap.docs.filter(
        (d) => d.data().severity !== "info"
      ).length;
      setOpenAlerts(actionable);
    });
    return () => unsub();
  }, []);

  const hasItems =
    !stats.loading &&
    (stats.pendingVerifications > 0 ||
      stats.openIssues > 0 ||
      stats.pendingPayments > 0 ||
      pendingPropertyDocs > 0 ||
      inspectionReviews > 0 ||
      pendingRefunds > 0 ||
      pendingRentReviews > 0 ||
      openAlerts > 0);

  if (!hasItems) return null;

  return (
    <div className="card border-amber-500/30 bg-amber-500/5 mb-6">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
          <AlertTriangle size={20} className="text-amber-500" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-sm text-[rgb(var(--text-primary))]">
            Items needing your attention
          </h3>
          <div className="flex flex-wrap gap-4 mt-2">
            {openAlerts > 0 && (
              <button
                onClick={() => router.push("/dashboard/alerts")}
                className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 hover:underline"
              >
                <Bell size={14} />
                {openAlerts} new alert{openAlerts !== 1 ? "s" : ""}
                <ArrowRight size={12} />
              </button>
            )}
            {pendingPropertyDocs > 0 && (
              <button
                onClick={() => router.push("/dashboard/properties")}
                className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 hover:underline"
              >
                <FileCheck size={14} />
                {pendingPropertyDocs} propert{pendingPropertyDocs !== 1 ? "ies" : "y"} awaiting review
                <ArrowRight size={12} />
              </button>
            )}
            {inspectionReviews > 0 && (
              <button
                onClick={() => router.push("/dashboard/inspection-reviews")}
                className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 hover:underline"
              >
                <ClipboardCheck size={14} />
                {inspectionReviews} inspection{inspectionReviews !== 1 ? "s" : ""} to review
                <ArrowRight size={12} />
              </button>
            )}
            {stats.pendingVerifications > 0 && (
              <button
                onClick={() => router.push("/dashboard/verifications")}
                className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 hover:underline"
              >
                <ShieldCheck size={14} />
                {stats.pendingVerifications} pending verification{stats.pendingVerifications !== 1 ? "s" : ""}
                <ArrowRight size={12} />
              </button>
            )}
            {stats.pendingPayments > 0 && (
              <button
                onClick={() => router.push("/dashboard/payments")}
                className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 hover:underline"
              >
                <CreditCard size={14} />
                {stats.pendingPayments} pending payment{stats.pendingPayments !== 1 ? "s" : ""}
                <ArrowRight size={12} />
              </button>
            )}
            {pendingRefunds > 0 && (
              <button
                onClick={() => router.push("/dashboard/refunds")}
                className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 hover:underline"
              >
                <RotateCcw size={14} />
                {pendingRefunds} pending refund{pendingRefunds !== 1 ? "s" : ""}
                <ArrowRight size={12} />
              </button>
            )}
            {pendingRentReviews > 0 && (
              <button
                onClick={() => router.push("/dashboard/rent-reviews")}
                className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 hover:underline"
              >
                <TrendingUp size={14} />
                {pendingRentReviews} rent review{pendingRentReviews !== 1 ? "s" : ""}
                <ArrowRight size={12} />
              </button>
            )}
            {stats.openIssues > 0 && (
              <button
                onClick={() => router.push("/dashboard/issues")}
                className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 hover:underline"
              >
                <AlertTriangle size={14} />
                {stats.openIssues} open issue{stats.openIssues !== 1 ? "s" : ""}
                <ArrowRight size={12} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
