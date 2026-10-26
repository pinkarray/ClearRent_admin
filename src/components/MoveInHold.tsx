"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

/**
 * A furnished stay's move-in check, on the payout panel. The landlord payout
 * is refused server-side (moveInHoldReason) until the tenant confirms, the
 * 48 hours pass in silence, or an admin resolves a report here.
 */
export function moveInHeld(
  check: string | undefined,
  deadline: Date | undefined,
  now: number,
): boolean {
  if (check === "reported") return true;
  if (check === "awaiting") return !deadline || deadline.getTime() > now;
  return false;
}

export function MoveInHold({
  rentalId,
  check,
  deadline,
  report,
  resolution,
}: {
  rentalId: string;
  check: string;
  deadline?: Date;
  report?: string;
  resolution?: string;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve() {
    setBusy(true);
    setError(null);
    try {
      await httpsCallable(functions, "resolveMoveInReport")({ rentalId, note: note.trim() });
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resolve it.");
    } finally {
      setBusy(false);
    }
  }

  const when = deadline?.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const line =
    check === "awaiting"
      ? `Furnished stay: waiting on the tenant's move-in check${when ? ` (closes ${when})` : ""}. The landlord cannot be paid before then unless the tenant confirms.`
      : check === "confirmed"
        ? "Furnished stay: the tenant confirmed the place matches the listing."
        : check === "resolved"
          ? `Furnished stay: move-in report resolved${resolution ? `: ${resolution}` : "."}`
          : "Furnished stay: the tenant reported a problem at move-in. Settle it with both sides, then resolve it here to release the payout.";

  return (
    <div
      className={
        "rounded-xl p-3 text-sm " +
        (check === "reported"
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "bg-[rgb(var(--surface-secondary))] text-[rgb(var(--text-secondary))]")
      }
    >
      <p>{line}</p>
      {check === "reported" && (
        <>
          {report && <p className="mt-2 italic">&ldquo;{report}&rdquo;</p>}
          <textarea
            className="mt-2 w-full rounded-lg border border-[rgb(var(--border))] bg-transparent p-2 text-sm"
            rows={2}
            placeholder="How it was settled (e.g. landlord replaced the fridge, tenant refunded ₦X)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          <button
            onClick={resolve}
            disabled={busy || !note.trim()}
            className="mt-2 w-full rounded-lg bg-amber-500 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Resolving…" : "Mark resolved"}
          </button>
        </>
      )}
    </div>
  );
}
