"use client";

/**
 * RentReviewDecisionModal — admin confirmation gate for approving or
 * rejecting a landlord rent-review request. Sibling to MarkPaidModal but a
 * DIFFERENT callable contract: these CFs take { requestId } (+ decisionReason
 * for reject) and return { success, requestId } — not the payment shape.
 *
 * Approve picks the callable by change type:
 *   - scheduled  → approveRentReview({ requestId })
 *   - immediate  → approveImmediateRentChange({ requestId })
 * Reject (both types) → rejectRentReview({ requestId, decisionReason }) with a
 * required reason.
 *
 * The CFs throw HttpsError with meaningful messages (6-month notice auto-reject,
 * "property now has a tenant" refusal). We catch as plain Error and surface
 * err.message verbatim so the admin sees exactly why a decision was blocked.
 *
 * Modal style mirrors MarkPaidModal (centered overlay, max-w-md, rounded surface).
 */

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { X, AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { functions } from "@/lib/firebase";
import { cn } from "@/lib/utils";

type CallableName =
  | "approveRentReview"
  | "rejectRentReview"
  | "approveImmediateRentChange";

interface RentReviewDecisionModalProps {
  /** Request doc id, passed straight through to the CF. */
  requestId: string;
  /** "approve" shows a plain confirm; "reject" requires a reason. */
  mode: "approve" | "reject";
  /** Which CF to invoke. Parent picks this from changeType / mode. */
  callable: CallableName;
  /** Short label of what's being decided (e.g. property title). */
  description: string;
  /** Called when the CF returns success. Parent clears local state. */
  onSuccess: () => void;
  /** Called when the user dismisses without confirming. */
  onClose: () => void;
}

export function RentReviewDecisionModal({
  requestId,
  mode,
  callable,
  description,
  onSuccess,
  onClose,
}: RentReviewDecisionModalProps) {
  const [decisionReason, setDecisionReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReject = mode === "reject";
  const trimmedReason = decisionReason.trim();
  // Reject requires a reason; approve has nothing to fill in.
  const canSubmit = (!isReject || trimmedReason.length > 0) && !submitting;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      // Request shape varies by action: reject carries decisionReason, the two
      // approve CFs take requestId only. Response is uniform.
      const data: { requestId: string; decisionReason?: string } = isReject
        ? { requestId, decisionReason: trimmedReason }
        : { requestId };

      const fn = httpsCallable<typeof data, { success: boolean; requestId: string }>(
        functions,
        callable
      );
      await fn(data);

      onSuccess();
    } catch (err) {
      // Callable errors arrive as Error subclasses carrying the HttpsError
      // message. v10 SDK has no runtime FunctionsError class, so we use the
      // instanceof Error check (same as MarkPaidModal).
      const message =
        err instanceof Error ? err.message : "Something went wrong. Try again.";
      setError(message);
      setSubmitting(false);
    }
  };

  const accent = isReject ? "text-red-500" : "text-emerald-500";

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={submitting ? undefined : onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[rgb(var(--surface))] rounded-2xl shadow-2xl border border-[rgb(var(--border))] overflow-hidden max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 border-b border-[rgb(var(--border))] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              {isReject ? (
                <XCircle size={18} className={accent} />
              ) : (
                <CheckCircle2 size={18} className={accent} />
              )}
              <h2 className="font-display font-semibold text-[rgb(var(--text-primary))]">
                {isReject ? "Reject Rent Review" : "Approve Rent Review"}
              </h2>
            </div>
            <button
              onClick={onClose}
              disabled={submitting}
              className="p-2 rounded-lg hover:bg-[rgb(var(--background))] transition-colors disabled:opacity-40"
            >
              <X size={16} className="text-[rgb(var(--text-secondary))]" />
            </button>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1 p-6 space-y-5">
            {/* Summary */}
            <div className="bg-[rgb(var(--background))] rounded-xl p-4 space-y-1">
              <p className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
                {isReject ? "Rejecting request" : "Approving request"}
              </p>
              <p className="text-sm text-[rgb(var(--text-primary))]">
                {description}
              </p>
            </div>

            {/* Decision reason (reject only, required) */}
            {isReject && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
                  Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={decisionReason}
                  onChange={(e) => setDecisionReason(e.target.value)}
                  disabled={submitting}
                  rows={3}
                  placeholder="Why is this request being rejected? Shown to the landlord."
                  className="w-full px-3 py-2.5 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background))] text-[rgb(var(--text-primary))] text-sm focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand))]/30 focus:border-[rgb(var(--brand))] disabled:opacity-40 resize-none"
                />
                <p className="text-xs text-[rgb(var(--text-hint))]">
                  Recorded on the request and sent to the landlord and tenant.
                </p>
              </div>
            )}

            {/* Approve note */}
            {!isReject && (
              <p className="text-sm text-[rgb(var(--text-secondary))]">
                {callable === "approveImmediateRentChange"
                  ? "This applies the new rent to the property immediately. The server re-checks that the property is still vacant before approving."
                  : "This stages the new rent for the tenant's next renewal with the chosen effective date."}
              </p>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-500">{error}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-[rgb(var(--border))] flex items-center gap-3 shrink-0">
            <button
              onClick={onClose}
              disabled={submitting}
              className="flex-1 py-2.5 rounded-xl border border-[rgb(var(--border))] text-[rgb(var(--text-primary))] text-sm font-medium hover:bg-[rgb(var(--background))] transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canSubmit}
              className={cn(
                "flex-1 py-2.5 rounded-xl text-white text-sm font-semibold transition-opacity",
                isReject ? "bg-red-500 hover:opacity-90" : "bg-emerald-500 hover:opacity-90",
                !canSubmit && "opacity-40 cursor-not-allowed"
              )}
            >
              {submitting
                ? "Processing..."
                : isReject
                  ? "Confirm Rejection"
                  : "Confirm Approval"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
