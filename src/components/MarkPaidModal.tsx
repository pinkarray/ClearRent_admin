"use client";

/**
 * MarkPaidModal — admin confirmation gate before invoking any of the
 * mark*Paid Cloud Functions. Collects a required paymentReference and
 * an optional paymentNote, calls the provided CF, surfaces errors
 * inline, and reports success up so the parent can clear local state.
 *
 * Used by:
 *   - payoutspage.tsx          (markInspectionAgentPayoutPaid)
 *   - rent-payoutspage.tsx     (markRentLandlordPayoutPaid, markRentAgentCommissionPaid)
 *   - Workstream 5 Step 7 admin refund queue (markRefundPaid)
 *
 * Modal style mirrors the announcement modal pattern used elsewhere
 * in the dashboard (centered overlay, max-w-lg, rounded surface).
 */

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { X, AlertCircle, CheckCircle2, Copy, Eye } from "lucide-react";
import { functions } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

type CallableName =
  | "markInspectionAgentPayoutPaid"
  | "markRentLandlordPayoutPaid"
  | "markRentAgentCommissionPaid"
  | "markRefundPaid";

interface MarkPaidModalProps {
  /** Doc ID to mark paid. Passed straight through to the CF. */
  docId: string;
  /** Which CF to invoke. */
  callable: CallableName;
  /** Amount in naira, for display only. */
  amount: number;
  /** Short label of what's being paid (e.g. "Agent payout for 3 Bedroom Duplex"). */
  description: string;
  /** Beneficiary bank details, shown so the admin sees exactly who to pay. */
  bank?: { bankName?: string; accountName?: string; accountNumber?: string };
  /** Called when the CF returns success. Parent should refetch / clear state. */
  onSuccess: () => void;
  /** Called when the user dismisses without confirming. */
  onClose: () => void;
}

/**
 * Format a naira amount for display. Matches the project convention
 * (₦ glyph + comma-thousands, no decimal). Local helper to keep this
 * component drop-in — does not reuse a project-wide formatNaira because
 * different pages have different ones inline.
 */
function formatNaira(n: number): string {
  return `₦${n.toLocaleString("en-NG")}`;
}

export function MarkPaidModal({
  docId,
  callable,
  amount,
  description,
  bank,
  onSuccess,
  onClose,
}: MarkPaidModalProps) {
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { canWrite } = useAuth();

  const trimmedRef = paymentReference.trim();
  const canSubmit = trimmedRef.length > 0 && !submitting && canWrite;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const fn = httpsCallable<
        {
          docId: string;
          paymentReference: string;
          paymentNote: string | null;
        },
        { success: boolean; auditLogId: string }
      >(functions, callable);

      await fn({
        docId,
        paymentReference: trimmedRef,
        paymentNote: paymentNote.trim().length > 0 ? paymentNote.trim() : null,
      });

      onSuccess();
    } catch (err) {
        // Callable errors arrive as Error subclasses with a `code` field set
        // to the HttpsError code ("failed-precondition", "permission-denied",
        // etc). They satisfy `instanceof Error` so we use that — there's no
        // runtime `FunctionsError` class to check against in the v10 SDK.
        const message =
            err instanceof Error ? err.message : "Something went wrong. Try again.";
        setError(message);
        setSubmitting(false);
    }
  };

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
              <CheckCircle2 size={18} className="text-[rgb(var(--brand))]" />
              <h2 className="font-display font-semibold text-[rgb(var(--text-primary))]">
                Mark as Paid
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
                Confirming payment
              </p>
              <p className="text-sm text-[rgb(var(--text-primary))]">
                {description}
              </p>
              <p
                className="text-xl font-bold text-[rgb(var(--text-primary))] font-mono pt-1"
                style={{ fontFamily: "Roboto, monospace" }}
              >
                {formatNaira(amount)}
              </p>
            </div>

            {/* Beneficiary bank — exactly who this money goes to */}
            {bank && (bank.accountNumber || bank.accountName) ? (
              <div className="bg-[rgb(var(--background))] rounded-xl p-4 space-y-1.5">
                <p className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
                  Send to
                </p>
                {bank.accountName && (
                  <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">
                    {bank.accountName}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <p className="text-sm text-[rgb(var(--text-secondary))]">
                    {bank.bankName || "Bank —"}
                    {bank.accountNumber ? (
                      <span style={{ fontFamily: "Roboto, monospace" }}>
                        {" "}· {bank.accountNumber}
                      </span>
                    ) : null}
                  </p>
                  {bank.accountNumber && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(bank.accountNumber!);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="text-[rgb(var(--text-hint))] hover:text-[rgb(var(--brand))] transition-colors"
                    >
                      {copied ? (
                        <CheckCircle2 size={13} className="text-emerald-500" />
                      ) : (
                        <Copy size={13} />
                      )}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  No bank details on file — confirm with the recipient before sending.
                </p>
              </div>
            )}

            {/* Payment reference (required) */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
                Payment Reference <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                disabled={submitting}
                placeholder="Bank transfer ref / Paystack ref"
                className="w-full px-3 py-2.5 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background))] text-[rgb(var(--text-primary))] text-sm focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand))]/30 focus:border-[rgb(var(--brand))] disabled:opacity-40"
              />
              <p className="text-xs text-[rgb(var(--text-hint))]">
                Recorded on the audit log. Use a real reference where possible.
              </p>
            </div>

            {/* Payment note (optional) */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
                Note <span className="text-[rgb(var(--text-hint))] normal-case font-normal">(optional)</span>
              </label>
              <textarea
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
                disabled={submitting}
                rows={3}
                placeholder="Any additional context for the audit log"
                className="w-full px-3 py-2.5 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background))] text-[rgb(var(--text-primary))] text-sm focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand))]/30 focus:border-[rgb(var(--brand))] disabled:opacity-40 resize-none"
              />
            </div>

            {/* Read-only notice */}
            {!canWrite && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <Eye size={16} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  Read-only access — you can review this payment but not mark it paid.
                </p>
              </div>
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
                canSubmit
                  ? "bg-[rgb(var(--brand))] hover:opacity-90"
                  : "bg-[rgb(var(--brand))] opacity-40 cursor-not-allowed"
              )}
            >
              {submitting ? "Processing..." : "Confirm Payment"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}