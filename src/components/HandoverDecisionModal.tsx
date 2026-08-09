"use client";

/*
  Adjudicating a contested move-out.

  Closing the handover is unconditional — whoever was right, the property has
  been held off the market long enough, and an argument about money should not
  keep a unit dark indefinitely. What the finding changes is what is recorded
  against the landlord, not whether they can trade.

  The two consequences are gated behind a finding FOR THE TENANT, because a
  penalty attached to a finding in the landlord's favour is a mistake rather
  than a policy. The CF rejects that combination too; this only stops you
  reaching for it.
*/

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { AlertTriangle, Loader2, X } from "lucide-react";

type Finding = "landlord" | "tenant" | "inconclusive";

const FINDINGS: { value: Finding; label: string; detail: string }[] = [
  {
    value: "landlord",
    label: "Deduction was justified",
    detail: "The landlord keeps what they withheld. Nothing is held against them.",
  },
  {
    value: "tenant",
    label: "Deduction was not justified",
    detail:
      "Recorded against the landlord. Only this finding allows a penalty.",
  },
  {
    value: "inconclusive",
    label: "Can't tell from the evidence",
    detail:
      "Recorded as reviewed with no fault assigned. The property is released.",
  },
];

export function HandoverDecisionModal({
  handover,
  onClose,
  onSuccess,
}: {
  handover: {
    id: string;
    propertyTitle: string;
    landlordName: string;
    tenantName: string;
    contested: boolean;
  };
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [finding, setFinding] = useState<Finding | null>(null);
  const [note, setNote] = useState("");
  const [ratingPenalty, setRatingPenalty] = useState(0);
  const [suspendDays, setSuspendDays] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canPenalise = finding === "tenant";
  const trimmedNote = note.trim();
  // The note is shown verbatim to BOTH parties, so it is the explanation they
  // get. An empty one would leave someone told only that they lost.
  const ready = finding !== null && trimmedNote.length >= 10 && !submitting;

  const submit = async () => {
    if (!ready || finding === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = {
        rentalId: handover.id,
        finding,
        note: trimmedNote,
        ...(canPenalise && ratingPenalty > 0 && { ratingPenalty }),
        ...(canPenalise && suspendDays !== 0 && { suspendListingDays: suspendDays }),
      };
      const fn = httpsCallable<typeof data, { success: boolean }>(
        functions,
        "adminResolveHandover"
      );
      await fn(data);
      onSuccess();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong. Try again.";
      setError(message);
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-background p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Resolve handover</h2>
            <p className="text-sm text-muted-foreground">
              {handover.propertyTitle} · {handover.tenantName} vs{" "}
              {handover.landlordName}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <fieldset className="mt-5 space-y-2">
          <legend className="text-sm font-medium">Your finding</legend>
          {FINDINGS.map((f) => (
            <label
              key={f.value}
              className="flex cursor-pointer gap-3 rounded-md border p-3 text-sm has-[:checked]:border-foreground"
            >
              <input
                type="radio"
                name="finding"
                className="mt-1"
                checked={finding === f.value}
                onChange={() => {
                  setFinding(f.value);
                  if (f.value !== "tenant") {
                    setRatingPenalty(0);
                    setSuspendDays(0);
                  }
                }}
              />
              <span>
                <span className="font-medium">{f.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {f.detail}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="mt-5 block">
          <span className="text-sm font-medium">
            What you decided, and why
          </span>
          <span className="block text-xs text-muted-foreground">
            Sent to both the tenant and the landlord, word for word.
          </span>
          <textarea
            className="mt-1.5 w-full rounded-md border bg-background p-2 text-sm"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="The photos show the damage predates this tenancy…"
          />
        </label>

        <fieldset
          className="mt-5 space-y-3 rounded-md border p-3"
          disabled={!canPenalise}
        >
          <legend className="flex items-center gap-1.5 px-1 text-sm font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            Consequences
          </legend>
          <p className="text-xs text-muted-foreground">
            {canPenalise
              ? "Neither is automatic anywhere else. Both are hard to undo — a suspension cannot be untold."
              : "Available only when you find the deduction was not justified."}
          </p>

          <label className="block text-sm">
            Rating penalty
            <select
              className="ml-2 rounded border bg-background px-2 py-1"
              value={ratingPenalty}
              onChange={(e) => setRatingPenalty(Number(e.target.value))}
            >
              <option value={0}>None</option>
              <option value={0.5}>−0.5</option>
              <option value={1}>−1.0</option>
              <option value={2}>−2.0</option>
            </select>
          </label>

          <label className="block text-sm">
            Suspend from listing
            <select
              className="ml-2 rounded border bg-background px-2 py-1"
              value={suspendDays}
              onChange={(e) => setSuspendDays(Number(e.target.value))}
            >
              <option value={0}>No</option>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={-1}>Until I lift it</option>
            </select>
          </label>
        </fieldset>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!ready}
            className="flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Resolve and release
          </button>
        </div>
      </div>
    </div>
  );
}
