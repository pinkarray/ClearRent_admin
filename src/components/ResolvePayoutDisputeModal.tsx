"use client";

/**
 * ResolvePayoutDisputeModal — the admin's answer to "I never got the money".
 *
 * A beneficiary (landlord or agent) can dispute a payout we already marked
 * sent. This closes that out: the admin attaches evidence of delivery —
 * normally a screenshot of the bank transfer — writes an explanation the
 * beneficiary will read, and calls resolvePayoutDispute.
 *
 * The proof is uploaded to `payout-proof/{rentalId}/…`, an admin-only,
 * write-once prefix. Only the object PATH goes to the CF (which rejects
 * anything outside that prefix); the bytes are served back to the dashboard
 * through /api/verification-image, never a public URL.
 */

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytes } from "firebase/storage";
import { X, AlertCircle, CheckCircle2, Upload, Loader2 } from "lucide-react";
import { functions, storage } from "@/lib/firebase";

interface ResolvePayoutDisputeModalProps {
  rentalId: string;
  role: "landlord" | "agent";
  /** Amount in naira, display only. */
  amount: number;
  beneficiaryName: string;
  /** What the beneficiary said when they disputed. */
  disputeReason?: string;
  onSuccess: () => void;
  onClose: () => void;
}

const MAX_PROOF_MB = 10;

export function ResolvePayoutDisputeModal({
  rentalId,
  role,
  amount,
  beneficiaryName,
  disputeReason,
  onSuccess,
  onClose,
}: ResolvePayoutDisputeModalProps) {
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setError(null);
    if (f && f.size > MAX_PROOF_MB * 1024 * 1024) {
      setError(`Proof must be under ${MAX_PROOF_MB}MB.`);
      return;
    }
    setFile(f);
  };

  const submit = async () => {
    if (!note.trim()) {
      setError("Explain what you found — the beneficiary reads this.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let proofPath: string | undefined;
      if (file) {
        // Write-once prefix, so the name must be unique per upload.
        const safeName = file.name.replace(/[^\w.\-]/g, "_");
        proofPath = `payout-proof/${rentalId}/${role}-${Date.now()}-${safeName}`;
        await uploadBytes(ref(storage, proofPath), file, {
          contentType: file.type || "application/octet-stream",
        });
      }
      await httpsCallable(
        functions,
        "resolvePayoutDispute"
      )({ rentalId, role, note: note.trim(), proofPath });
      onSuccess();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not resolve the dispute.";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-[rgb(var(--surface))] shadow-xl">
        <div className="flex items-center justify-between border-b border-[rgb(var(--border))] p-5">
          <h3 className="text-base font-semibold">Resolve payout dispute</h3>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1 hover:bg-[rgb(var(--surface-hover))] disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm text-[rgb(var(--text-secondary))]">
            {beneficiaryName} says the{" "}
            {role === "landlord" ? "rent payout" : "commission"} of{" "}
            <span className="font-mono font-semibold">
              ₦{amount.toLocaleString("en-NG")}
            </span>{" "}
            never arrived.
          </p>

          {disputeReason && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[rgb(var(--text-hint))]">
                What they reported
              </p>
              <p className="text-sm">{disputeReason}</p>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[rgb(var(--text-hint))]">
              Proof of transfer (optional)
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[rgb(var(--border))] p-3 text-sm hover:bg-[rgb(var(--surface-hover))]">
              <Upload size={16} className="shrink-0" />
              <span className="truncate">
                {file ? file.name : "Attach a screenshot or receipt"}
              </span>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={pickFile}
                disabled={busy}
                className="hidden"
              />
            </label>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[rgb(var(--text-hint))]">
              What you found
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
              rows={4}
              placeholder="e.g. Transfer confirmed delivered on 11 Aug at 14:22, reference 1234567890. Screenshot attached."
              className="w-full resize-none rounded-xl border border-[rgb(var(--border))] bg-transparent p-3 text-sm outline-none focus:border-[rgb(var(--brand))]"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-600 dark:text-red-400">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex gap-3 border-t border-[rgb(var(--border))] p-5">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-xl border border-[rgb(var(--border))] py-3 text-sm font-medium hover:bg-[rgb(var(--surface-hover))] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Resolving…
              </>
            ) : (
              <>
                <CheckCircle2 size={16} /> Resolve dispute
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
