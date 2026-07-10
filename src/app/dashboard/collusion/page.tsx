"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import {
  ShieldAlert,
  Users,
  Search,
  X,
  Loader2,
  RefreshCw,
  ChevronDown,
  Home,
  CalendarClock,
  User,
  RotateCcw,
  Handshake,
  AlertTriangle,
  Info,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ─── Collusion analytics ─────────────────────────────────────────────────────
// Consumes the Phase-3 capture (handlerId/handlerType on inspections) to group
// inspections by the tenant↔handler PAIR and surface patterns that look like
// off-platform dealing or refund farming. Heuristic + advisory — a flag is a
// prompt to look, not proof. Everything is derived from raw signals already on
// the inspection docs (arrival flags, met, paymentStatus) joined to
// active_rentals (did the tenant actually rent the property they inspected).

type Outcome =
  | "met" // both confirmed meeting (money moved to handler)
  | "tenant_no_show" // handler showed, tenant didn't
  | "handler_no_show" // tenant showed, handler didn't → refund (forgeable)
  | "no_show_both"
  | "refund_other"
  | "under_review"
  | "declined"
  | "not_held" // cancelled / expired before it happened
  | "in_progress";

interface RawInspection {
  id: string;
  tenantId: string;
  tenantName: string;
  handlerId: string;
  handlerName: string;
  handlerType: "agent" | "landlord";
  propertyId: string;
  propertyTitle: string;
  requestedDate: Date | null;
  outcome: Outcome;
  rented: boolean; // tenant has an active rental on this property
}

interface Pair {
  key: string;
  tenantId: string;
  tenantName: string;
  handlerId: string;
  handlerName: string;
  handlerType: "agent" | "landlord";
  inspections: RawInspection[];
  total: number;
  met: number; // confirmed meetings
  handlerNoShowRefunds: number;
  tenantNoShows: number;
  underReview: number;
  propertiesInvolved: number;
  rentalsResulted: number; // distinct inspected properties the tenant rented
  metNoRental: number; // distinct properties met-on but never rented
  score: number;
  risk: "high" | "medium" | "low";
}

function toDate(v: unknown): Date | null {
  if (v instanceof Timestamp) return v.toDate();
  return null;
}

function deriveOutcome(x: Record<string, unknown>): Outcome {
  const status = (x.status as string) ?? "";
  const paymentStatus = (x.paymentStatus as string) ?? "";
  const met = x.met === true;
  const tenantArrived = x.tenantArrived === true;
  const handlerArrived = x.handlerArrived === true;

  if (paymentStatus === "refunded") {
    if (tenantArrived && !handlerArrived) return "handler_no_show";
    if (!tenantArrived && !handlerArrived) return "no_show_both";
    return "refund_other";
  }
  if (status === "completed") {
    if (met) return "met";
    if (handlerArrived && !tenantArrived) return "tenant_no_show";
    if (x.tenantNoShow === true) return "tenant_no_show";
    return "met"; // completed with no adverse flag ⇒ treat as a meeting
  }
  if (status === "awaitingOutcome") return "under_review";
  if (status === "declined" || status === "declinedByAgent") return "declined";
  if (status === "cancelled" || status === "expiredUnapproved") return "not_held";
  return "in_progress";
}

const MEETING_OUTCOMES: Outcome[] = ["met"];

function classifyRisk(p: Omit<Pair, "risk" | "score">): {
  risk: Pair["risk"];
  score: number;
} {
  const score =
    p.metNoRental * 3 +
    p.handlerNoShowRefunds * 4 +
    (p.rentalsResulted === 0 && p.total >= 3 ? 2 : 0);

  let risk: Pair["risk"] = "low";
  if (p.metNoRental >= 3 || p.handlerNoShowRefunds >= 2) risk = "high";
  else if (
    p.metNoRental >= 2 ||
    p.handlerNoShowRefunds >= 1 ||
    (p.total >= 4 && p.rentalsResulted === 0)
  )
    risk = "medium";
  return { risk, score };
}

export default function CollusionPage() {
  const router = useRouter();
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [analyzedCount, setAnalyzedCount] = useState(0);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [inspSnap, rentalSnap] = await Promise.all([
        getDocs(collection(db, "inspection_requests")),
        getDocs(collection(db, "active_rentals")),
      ]);

      // Which (tenant, property) combos actually became rentals.
      const rentedSet = new Set<string>();
      rentalSnap.docs.forEach((d) => {
        const x = d.data();
        const t = x.tenantId as string | undefined;
        const p = x.propertyId as string | undefined;
        if (t && p) rentedSet.add(`${t}__${p}`);
      });

      const rows: RawInspection[] = [];
      inspSnap.docs.forEach((d) => {
        const x = d.data();
        const tenantId = (x.tenantId as string) ?? "";
        // Handler = stored handlerId (Phase 3) or derived (agent ?? landlord)
        // so this works even before the backfill runs.
        const agentId = (x.agentId as string) || null;
        const landlordId = (x.landlordId as string) || "";
        const handlerId = (x.handlerId as string) || agentId || landlordId;
        const handlerType: "agent" | "landlord" =
          (x.handlerType as "agent" | "landlord") ?? (agentId ? "agent" : "landlord");
        if (!tenantId || !handlerId || tenantId === handlerId) return;

        const propertyId = (x.propertyId as string) ?? "";
        rows.push({
          id: d.id,
          tenantId,
          tenantName: (x.tenantName as string) || "Tenant",
          handlerId,
          handlerName: agentId
            ? (x.agentName as string) || "Agent"
            : (x.landlordName as string) || "Landlord",
          handlerType,
          propertyId,
          propertyTitle: (x.propertyTitle as string) || "Property",
          requestedDate: toDate(x.requestedDate),
          outcome: deriveOutcome(x),
          rented: propertyId ? rentedSet.has(`${tenantId}__${propertyId}`) : false,
        });
      });
      setAnalyzedCount(rows.length);

      // Group by tenant↔handler pair.
      const groups = new Map<string, RawInspection[]>();
      for (const r of rows) {
        const key = `${r.tenantId}__${r.handlerId}`;
        const arr = groups.get(key);
        if (arr) arr.push(r);
        else groups.set(key, [r]);
      }

      const built: Pair[] = [];
      for (const [key, insps] of Array.from(groups.entries())) {
        if (insps.length < 2) continue; // a single inspection isn't a pattern

        const first = insps[0];
        const met = insps.filter((i) => MEETING_OUTCOMES.includes(i.outcome)).length;
        const handlerNoShowRefunds = insps.filter(
          (i) => i.outcome === "handler_no_show"
        ).length;
        const tenantNoShows = insps.filter((i) => i.outcome === "tenant_no_show").length;
        const underReview = insps.filter((i) => i.outcome === "under_review").length;

        // Per-property rollups (a pair may inspect the same property twice).
        const propsMet = new Set<string>();
        const propsRented = new Set<string>();
        const propsAll = new Set<string>();
        for (const i of insps) {
          if (i.propertyId) propsAll.add(i.propertyId);
          if (MEETING_OUTCOMES.includes(i.outcome) && i.propertyId)
            propsMet.add(i.propertyId);
          if (i.rented && i.propertyId) propsRented.add(i.propertyId);
        }
        const metNoRental = Array.from(propsMet).filter(
          (p) => !propsRented.has(p)
        ).length;

        const base = {
          key,
          tenantId: first.tenantId,
          tenantName: first.tenantName,
          handlerId: first.handlerId,
          handlerName: first.handlerName,
          handlerType: first.handlerType,
          inspections: insps.sort(
            (a, b) => (b.requestedDate?.getTime() ?? 0) - (a.requestedDate?.getTime() ?? 0)
          ),
          total: insps.length,
          met,
          handlerNoShowRefunds,
          tenantNoShows,
          underReview,
          propertiesInvolved: propsAll.size,
          rentalsResulted: propsRented.size,
          metNoRental,
        };
        const { risk, score } = classifyRisk(base);
        // Only surface pairs that carry at least one signal.
        if (score === 0 && metNoRental === 0 && handlerNoShowRefunds === 0) continue;
        built.push({ ...base, risk, score });
      }

      const rank = { high: 0, medium: 1, low: 2 } as const;
      built.sort((a, b) => rank[a.risk] - rank[b.risk] || b.score - a.score || b.total - a.total);
      setPairs(built);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to load collusion analytics."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return pairs;
    return pairs.filter(
      (p) =>
        p.tenantName.toLowerCase().includes(q) ||
        p.handlerName.toLowerCase().includes(q)
    );
  }, [pairs, searchQuery]);

  const stats = useMemo(() => {
    const high = pairs.filter((p) => p.risk === "high").length;
    const medium = pairs.filter((p) => p.risk === "medium").length;
    const refunds = pairs.reduce((s, p) => s + p.handlerNoShowRefunds, 0);
    return { high, medium, flagged: pairs.length, refunds };
  }, [pairs]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl lg:text-3xl font-display font-bold text-[rgb(var(--text-primary))]">
            Collusion Watch
          </h1>
          <p className="text-sm text-[rgb(var(--text-secondary))] mt-1">
            Tenant↔handler pairs that meet repeatedly but never rent, or farm
            refunds. Advisory — a flag is a prompt to look, not proof.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgb(var(--text-hint))]"
            />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tenant or handler"
              className="pl-9 pr-8 py-2 rounded-xl bg-[rgb(var(--surface))] border border-[rgb(var(--border))] text-sm w-60 focus:outline-none focus:border-[rgb(var(--brand))]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgb(var(--text-hint))]"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))] disabled:opacity-50"
          >
            <RefreshCw size={14} className={cn(loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Flagged pairs" value={stats.flagged} tone="brand" icon={Users} />
        <StatTile label="High risk" value={stats.high} tone="red" icon={ShieldAlert} />
        <StatTile label="Medium risk" value={stats.medium} tone="amber" icon={AlertTriangle} />
        <StatTile label="No-show refunds" value={stats.refunds} tone="neutral" icon={RotateCcw} />
      </div>

      {/* How-to-read note */}
      <div className="card p-4 flex gap-3">
        <Info size={16} className="text-[rgb(var(--brand))] shrink-0 mt-0.5" />
        <div className="text-xs text-[rgb(var(--text-secondary))] space-y-1">
          <p>
            <b>Met, no rental</b> — the pair confirmed a meeting on a property the
            tenant never rented on ClearRent. Repeated, this suggests they connect
            here then transact off-platform.
          </p>
          <p>
            <b>Handler no-show refunds</b> — the tenant marked they attended but the
            handler didn&apos;t confirm, triggering a refund. Repeated for one pair,
            this is the exact signal a colluding tenant+handler can forge.
          </p>
          <p className="text-[rgb(var(--text-hint))]">
            Analyzed {analyzedCount} inspections across {pairs.length} flagged pairs.
          </p>
        </div>
      </div>

      {error ? (
        <div className="card p-6 text-center text-sm text-red-500">{error}</div>
      ) : loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-[rgb(var(--brand))]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16">
          <Handshake size={36} className="mx-auto text-[rgb(var(--text-hint))]" />
          <p className="mt-3 text-sm text-[rgb(var(--text-secondary))]">
            No suspicious tenant↔handler pairs right now.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => (
            <PairCard
              key={p.key}
              pair={p}
              expanded={expanded === p.key}
              onToggle={() => setExpanded(expanded === p.key ? null : p.key)}
              router={router}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone: "brand" | "red" | "amber" | "neutral";
  icon: LucideIcon;
}) {
  const color =
    tone === "red"
      ? "text-red-500"
      : tone === "amber"
      ? "text-amber-500"
      : tone === "brand"
      ? "text-[rgb(var(--brand))]"
      : "text-[rgb(var(--text-secondary))]";
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <Icon size={16} className={color} />
        <span className="text-xs text-[rgb(var(--text-secondary))]">{label}</span>
      </div>
      <p className={cn("text-2xl font-display font-bold mt-1", color)}>{value}</p>
    </div>
  );
}

function RiskBadge({ risk }: { risk: Pair["risk"] }) {
  const cfg = {
    high: { cls: "bg-red-500/10 text-red-600 dark:text-red-400", label: "High risk" },
    medium: { cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400", label: "Medium risk" },
    low: { cls: "bg-[rgb(var(--text-hint))]/10 text-[rgb(var(--text-secondary))]", label: "Low" },
  }[risk];
  return (
    <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full", cfg.cls)}>
      {cfg.label}
    </span>
  );
}

function Chip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "red" | "amber" | "emerald";
}) {
  const cls =
    tone === "red"
      ? "bg-red-500/10 text-red-600 dark:text-red-400"
      : tone === "amber"
      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
      : tone === "emerald"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : "bg-[rgb(var(--background))] text-[rgb(var(--text-secondary))]";
  return (
    <span className={cn("text-[11px] px-2 py-0.5 rounded-lg whitespace-nowrap", cls)}>
      {label}: <b>{value}</b>
    </span>
  );
}

const OUTCOME_LABEL: Record<Outcome, { text: string; tone: "neutral" | "red" | "amber" | "emerald" }> = {
  met: { text: "met", tone: "emerald" },
  tenant_no_show: { text: "tenant no-show", tone: "amber" },
  handler_no_show: { text: "handler no-show (refund)", tone: "red" },
  no_show_both: { text: "no-show (both)", tone: "amber" },
  refund_other: { text: "refunded", tone: "amber" },
  under_review: { text: "under review", tone: "amber" },
  declined: { text: "declined", tone: "neutral" },
  not_held: { text: "not held", tone: "neutral" },
  in_progress: { text: "in progress", tone: "neutral" },
};

function PairCard({
  pair,
  expanded,
  onToggle,
  router,
}: {
  pair: Pair;
  expanded: boolean;
  onToggle: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <div
      className={cn(
        "card",
        pair.risk === "high" && "border-red-500/30",
        pair.risk === "medium" && "border-amber-500/30"
      )}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <RiskBadge risk={pair.risk} />
            <button
              onClick={() => router.push(`/dashboard/users/${pair.tenantId}`)}
              className="flex items-center gap-1 text-sm font-semibold text-[rgb(var(--text-primary))] hover:text-[rgb(var(--brand))]"
            >
              <User size={13} /> {pair.tenantName}
            </button>
            <span className="text-xs text-[rgb(var(--text-hint))]">tenant</span>
            <Handshake size={13} className="text-[rgb(var(--text-hint))]" />
            <button
              onClick={() => router.push(`/dashboard/users/${pair.handlerId}`)}
              className="flex items-center gap-1 text-sm font-semibold text-[rgb(var(--text-primary))] hover:text-[rgb(var(--brand))]"
            >
              <User size={13} /> {pair.handlerName}
            </button>
            <span className="text-xs text-[rgb(var(--text-hint))]">{pair.handlerType}</span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Chip label="Inspections" value={pair.total} />
            <Chip label="Met" value={pair.met} tone="emerald" />
            <Chip
              label="Met, no rental"
              value={pair.metNoRental}
              tone={pair.metNoRental >= 2 ? "red" : pair.metNoRental >= 1 ? "amber" : "neutral"}
            />
            <Chip
              label="No-show refunds"
              value={pair.handlerNoShowRefunds}
              tone={pair.handlerNoShowRefunds >= 1 ? "red" : "neutral"}
            />
            <Chip label="Rentals" value={pair.rentalsResulted} tone={pair.rentalsResulted > 0 ? "emerald" : "neutral"} />
            <Chip label="Properties" value={pair.propertiesInvolved} />
          </div>
        </div>

        <button
          onClick={onToggle}
          className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))] shrink-0"
        >
          {pair.total} inspection{pair.total === 1 ? "" : "s"}
          <ChevronDown
            size={13}
            className={cn("transition-transform", expanded && "rotate-180")}
          />
        </button>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-[rgb(var(--border))] space-y-2">
          {pair.inspections.map((i) => {
            const o = OUTCOME_LABEL[i.outcome];
            return (
              <div
                key={i.id}
                className="flex items-center justify-between gap-3 text-xs flex-wrap"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Home size={12} className="text-[rgb(var(--text-hint))] shrink-0" />
                  <span className="text-[rgb(var(--text-primary))] truncate">
                    {i.propertyTitle}
                  </span>
                  <span className="flex items-center gap-1 text-[rgb(var(--text-hint))]">
                    <CalendarClock size={11} />
                    {i.requestedDate
                      ? i.requestedDate.toLocaleDateString("en-NG", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "—"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Chip label="outcome" value={o.text} tone={o.tone} />
                  {i.rented && <Chip label="rented" value="yes" tone="emerald" />}
                  {!i.rented && i.outcome === "met" && (
                    <Chip label="rented" value="no" tone="amber" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
