"use client";

/*
  Move-out handovers awaiting a human.

  ClearRent never holds the caution deposit — it moves landlord-to-tenant
  off-platform — so the platform cannot return it, release it, or compel it.
  What it can do is refuse to relist the property, and that is the whole of the
  leverage. Every row here is a unit sitting off the market.

  Two things need an admin and nothing else on this screen does:
    - a CONTESTED settlement, where the tenant says the deduction is wrong
    - a STUCK handover, where a property has been dark long enough to look like
      someone has given up rather than disagreed

  Consequences (suspension, rating) are deliberately not automated anywhere in
  the codebase: the evidence is uploaded photos nobody has independently
  verified, and you cannot un-tell a market that someone was suspended.
*/

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { parseTimestamp } from "@/types";
import { cn, timeAgo } from "@/lib/utils";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Gavel,
  Home,
  Loader2,
  Lock,
  Scale,
  Search,
  X,
} from "lucide-react";
import { HandoverDecisionModal } from "@/components/HandoverDecisionModal";

interface Handover {
  id: string;
  propertyId: string;
  propertyTitle: string;
  landlordId: string;
  landlordName: string;
  tenantId: string;
  tenantName: string;
  stage: string;
  cautionDeposit: number;
  deductionAmount: number;
  deductionReason: string | null;
  proofUrl: string | null;
  contested: boolean;
  contestStatement: string | null;
  settledAt: Date | null;
  endedAt: Date | null;
  evidenceAt: Date | null;
  evidencePending: boolean;
  conditionConfirmedAt: Date | null;
}

/** Stages that still hold a property off the market. */
const OPEN_STAGES = [
  "awaiting_evidence",
  "awaiting_condition",
  "awaiting_settlement",
  "awaiting_confirm",
];

const STAGE_LABEL: Record<string, string> = {
  awaiting_evidence: "Tenant recording condition",
  awaiting_condition: "Landlord to check the unit",
  awaiting_settlement: "Deposit not settled",
  awaiting_confirm: "Tenant to confirm payment",
};

/** How long a stage can sit before it reads as stuck rather than in progress. */
const STALE_DAYS = 14;

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString("en-NG")}`;
}

function daysSince(d: Date | null): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

export default function HandoversPage() {
  const [rows, setRows] = useState<Handover[] | null>(null);
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<Handover | null>(null);

  useEffect(() => {
    // Every open handover, not only the contested ones: a property nobody is
    // arguing about can still be stuck, and that is invisible anywhere else.
    const q = query(
      collection(db, "active_rentals"),
      where("handoverStage", "in", OPEN_STAGES)
    );
    return onSnapshot(q, (snap) => {
      setRows(
        snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            propertyId: (x.propertyId as string) ?? "",
            propertyTitle: (x.propertyTitle as string) ?? "Untitled",
            landlordId: (x.landlordId as string) ?? "",
            landlordName: (x.landlordName as string) ?? "Landlord",
            tenantId: (x.tenantId as string) ?? "",
            tenantName: (x.tenantName as string) ?? "Tenant",
            stage: (x.handoverStage as string) ?? "",
            cautionDeposit: Number(x.cautionDeposit ?? 0),
            deductionAmount: Number(x.cautionDeductionAmount ?? 0),
            deductionReason: (x.cautionDeductionReason as string) ?? null,
            proofUrl: (x.handoverProofUrl as string) ?? null,
            contested: x.tenantContested === true,
            contestStatement: (x.tenantContestStatement as string) ?? null,
            settledAt: parseTimestamp(x.handoverSettledAt) ?? null,
            endedAt: parseTimestamp(x.endedAt) ?? null,
            evidenceAt: parseTimestamp(x.handoverEvidenceAt) ?? null,
            evidencePending: x.handoverEvidencePending === true,
            conditionConfirmedAt:
              parseTimestamp(x.handoverConditionConfirmedAt) ?? null,
          };
        })
      );
    });
  }, []);

  const { contested, stuck, running } = useMemo(() => {
    const all = (rows ?? []).filter((r) => {
      if (!search.trim()) return true;
      const s = search.toLowerCase();
      return (
        r.propertyTitle.toLowerCase().includes(s) ||
        r.tenantName.toLowerCase().includes(s) ||
        r.landlordName.toLowerCase().includes(s)
      );
    });
    // A contest is a decision waiting on you. Everything else is only waiting
    // on time, so it is ranked by how long it has been waiting.
    const c = all.filter((r) => r.contested);
    const rest = all.filter((r) => !r.contested);
    const age = (r: Handover) => daysSince(r.endedAt) ?? 0;
    return {
      contested: c.sort((a, b) => age(b) - age(a)),
      stuck: rest.filter((r) => age(r) >= STALE_DAYS).sort((a, b) => age(b) - age(a)),
      running: rest.filter((r) => age(r) < STALE_DAYS).sort((a, b) => age(b) - age(a)),
    };
  }, [rows, search]);

  if (rows === null) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading handovers…
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Scale className="h-5 w-5" />
          Move-out handovers
        </h1>
        <p className="text-sm text-muted-foreground">
          Every property here is off the market until its caution deposit is
          settled. ClearRent never holds that money — withholding the relisting
          is the only leverage there is.
        </p>
      </header>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          className="w-full rounded-md border bg-background py-2 pl-9 pr-8 text-sm"
          placeholder="Property, tenant or landlord"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <Section
        title="Contested"
        hint="The tenant says the deduction is wrong. Only an admin can settle this."
        icon={Gavel}
        tone="danger"
        rows={contested}
        onDecide={setTarget}
      />
      <Section
        title={`Stuck (${STALE_DAYS}+ days)`}
        hint="Nobody is arguing — it has simply stalled, and the unit earns nothing meanwhile."
        icon={AlertTriangle}
        tone="warn"
        rows={stuck}
        onDecide={setTarget}
      />
      <Section
        title="In progress"
        hint="Moving along on its own. Shown so a handover is never invisible."
        icon={Home}
        tone="muted"
        rows={running}
        onDecide={setTarget}
      />

      {target && (
        <HandoverDecisionModal
          handover={target}
          onClose={() => setTarget(null)}
          onSuccess={() => setTarget(null)}
        />
      )}
    </div>
  );
}

function Section({
  title,
  hint,
  icon: Icon,
  tone,
  rows,
  onDecide,
}: {
  title: string;
  hint: string;
  icon: typeof Gavel;
  tone: "danger" | "warn" | "muted";
  rows: Handover[];
  onDecide: (h: Handover) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon
          className={cn(
            "h-4 w-4",
            tone === "danger" && "text-red-600",
            tone === "warn" && "text-amber-600",
            tone === "muted" && "text-muted-foreground"
          )}
        />
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
          {rows.length}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="grid gap-3">
        {rows.map((h) => (
          <HandoverCard key={h.id} h={h} onDecide={onDecide} />
        ))}
      </div>
    </section>
  );
}

function HandoverCard({
  h,
  onDecide,
}: {
  h: Handover;
  onDecide: (h: Handover) => void;
}) {
  const age = daysSince(h.endedAt);
  const returning = Math.max(0, h.cautionDeposit - h.deductionAmount);

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        h.contested && "border-red-300 bg-red-50/50"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{h.propertyTitle}</p>
          <p className="text-xs text-muted-foreground">
            {h.tenantName} moved out{age !== null && ` · ${age} days ago`} ·
            landlord {h.landlordName}
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs">
          <Lock className="h-3 w-3" />
          {STAGE_LABEL[h.stage] ?? h.stage}
        </span>
      </div>

      <div className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <Line label="Deposit on record" value={formatNaira(h.cautionDeposit)} />
        <Line
          label="Landlord is keeping"
          value={
            h.deductionAmount > 0 ? formatNaira(h.deductionAmount) : "Nothing"
          }
        />
        <Line label="Owed to tenant" value={formatNaira(returning)} />
        <Line
          label="Proof of transfer"
          value={h.proofUrl ? "Uploaded" : "None"}
        />
      </div>

      {h.deductionReason && (
        <p className="mt-2 text-sm">
          <span className="text-muted-foreground">Reason given: </span>
          {h.deductionReason}
        </p>
      )}

      {/* The evidence is what a deduction is judged on, so its absence is
          stated plainly rather than left to be inferred from a blank space. */}
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Camera className="h-3 w-3" />
          {h.evidencePending
            ? "Tenant's recording still uploading"
            : h.evidenceAt
              ? `Tenant recorded ${timeAgo(h.evidenceAt)}`
              : "No tenant recording — a deduction cannot rest on much"}
        </span>
        <span className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {h.conditionConfirmedAt
            ? `Landlord checked the unit ${timeAgo(h.conditionConfirmedAt)}`
            : "Landlord has not confirmed checking the unit"}
        </span>
      </div>

      {h.contested && h.contestStatement && (
        <blockquote className="mt-3 border-l-2 border-red-400 pl-3 text-sm">
          <span className="text-muted-foreground">Tenant disputes: </span>
          {h.contestStatement}
        </blockquote>
      )}

      <div className="mt-4">
        <button
          onClick={() => onDecide(h)}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background"
        >
          {h.contested ? "Adjudicate" : "Resolve and release"}
        </button>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex justify-between gap-4 sm:justify-start">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{value}</span>
    </p>
  );
}
