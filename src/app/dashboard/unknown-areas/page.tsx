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
  setDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { cn, timeAgo } from "@/lib/utils";
import {
  MapPin,
  Search,
  X,
  CheckCircle2,
  Clock,
  ExternalLink,
  Copy,
  Check,
  EyeOff,
  Info,
  Loader2,
  RefreshCw,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusFilter = "all" | "pending" | "added" | "dismissed";

interface AreaRequest {
  id: string;
  rawName: string;
  lat: number | null;
  lng: number | null;
  source: string;
  status: "pending" | "added" | "dismissed";
  createdAt: Date;
  reviewedAt?: Date;
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  pending: {
    label: "Pending",
    cls: "bg-amber-500/10 text-amber-600",
    icon: Clock,
  },
  added: {
    label: "Added",
    cls: "bg-emerald-500/10 text-emerald-600",
    icon: CheckCircle2,
  },
  dismissed: {
    label: "Dismissed",
    cls: "bg-[rgb(var(--background))] text-[rgb(var(--text-hint))]",
    icon: EyeOff,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseTimestamp(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate();
  if (val && typeof val === "object" && "seconds" in val)
    return new Date((val as { seconds: number }).seconds * 1000);
  if (val instanceof Date) return val;
  return new Date();
}

function mapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/**
 * LGAs the app prices against — mirrors `lgas` + `outerLGA` in
 * lib/core/utils/inspection_pricing.dart. An area must map to one of these:
 * the chosen LGA is what decides the inspection fee, and the app rejects any
 * remote entry whose LGA it doesn't recognise.
 */
const LGA_OPTIONS: { value: string; label: string }[] = [
  { value: "ikorodu", label: "Ikorodu LGA" },
  { value: "kosofe", label: "Kosofe LGA" },
  { value: "shomolu", label: "Shomolu LGA" },
  { value: "ikeja", label: "Ikeja LGA" },
  { value: "ojodu_lcda", label: "Ojodu LCDA" },
  { value: "agege", label: "Agege LGA" },
  { value: "ifako_ijaiye", label: "Ifako-Ijaiye LGA" },
  { value: "alimosho", label: "Alimosho LGA" },
  { value: "oshodi_isolo", label: "Oshodi-Isolo LGA" },
  { value: "mushin", label: "Mushin LGA" },
  { value: "surulere", label: "Surulere LGA" },
  { value: "yaba_mainland", label: "Yaba / Mainland LGA" },
  { value: "eti_osa", label: "Eti-Osa LGA" },
  { value: "lagos_island", label: "Lagos Island LGA" },
  { value: "outer", label: "Outer Lagos" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UnknownAreasPage() {
  const { canWrite } = useAuth();
  const [requests, setRequests] = useState<AreaRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Row currently being assigned an LGA, and the LGA picked for it.
  const [addingFor, setAddingFor] = useState<AreaRequest | null>(null);
  const [pickedLga, setPickedLga] = useState("");

  // ── Real-time listener ──────────────────────────────────────────────────────
  useEffect(() => {
    const q = query(
      collection(db, "admin_requests"),
      where("type", "==", "unknown_area"),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          rawName: data.rawName ?? "",
          // Absent, not zero. A report filed before the area could be
          // geocoded has no position, and rendering that as 0.0000, 0.0000
          // pointed the admin at the Atlantic off Ghana.
          lat: typeof data.lat === "number" ? data.lat : null,
          lng: typeof data.lng === "number" ? data.lng : null,
          source: data.source ?? "unknown",
          status: data.status ?? "pending",
          createdAt: parseTimestamp(data.createdAt),
          reviewedAt: data.reviewedAt ? parseTimestamp(data.reviewedAt) : undefined,
        } as AreaRequest;
      });
      setRequests(docs);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  // ── Filtered list ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return requests.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (searchQuery) {
        return r.rawName.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return true;
    });
  }, [requests, statusFilter, searchQuery]);

  // ── Counts ──────────────────────────────────────────────────────────────────
  const counts = useMemo(
    () => ({
      all: requests.length,
      pending: requests.filter((r) => r.status === "pending").length,
      added: requests.filter((r) => r.status === "added").length,
      dismissed: requests.filter((r) => r.status === "dismissed").length,
    }),
    [requests]
  );

  // ── Actions ─────────────────────────────────────────────────────────────────
  async function setStatus(id: string, status: "pending" | "added" | "dismissed") {
    if (!canWrite) return;
    setUpdating(id);
    try {
      await updateDoc(doc(db, "admin_requests", id), {
        status,
        reviewedAt: serverTimestamp(),
      });
    } finally {
      setUpdating(null);
    }
  }

  /**
   * Publishes the area for real: writes it into `config/areas`, which every
   * app merges over its compiled list at startup. This is what makes "added"
   * mean added — before this it only changed a status field, and the area
   * still needed a code change and a Play Store release to appear.
   *
   * Every pending row for the same name is resolved together, since the app
   * can't read admin_requests to dedupe and files one row per landlord.
   */
  async function publishArea(request: AreaRequest, lga: string) {
    if (!canWrite) return;
    const key = request.rawName.trim().toLowerCase();
    if (!key || !lga) return;

    setUpdating(request.id);
    try {
      await setDoc(
        doc(db, "config", "areas"),
        { areas: { [key]: lga }, updatedAt: serverTimestamp() },
        { merge: true }
      );

      const sameName = requests.filter(
        (r) => r.rawName.trim().toLowerCase() === key && r.status !== "added"
      );
      const batch = writeBatch(db);
      for (const r of sameName) {
        batch.update(doc(db, "admin_requests", r.id), {
          status: "added",
          assignedLga: lga,
          reviewedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      setAddingFor(null);
    } finally {
      setUpdating(null);
    }
  }

  function copyName(name: string) {
    navigator.clipboard.writeText(name.toLowerCase());
    setCopied(name);
    setTimeout(() => setCopied(null), 2000);
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-[rgb(var(--text-primary))]">
            Unknown Areas
          </h1>
          <p className="text-sm text-[rgb(var(--text-secondary))] mt-0.5">
            Areas picked via the map pin that aren't in the app dropdown yet
          </p>
        </div>
        {counts.pending > 0 && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-600 text-sm font-semibold">
            <Clock size={14} />
            {counts.pending} pending
          </span>
        )}
      </div>

      {/* How-to banner */}
      <div className="flex gap-3 p-4 rounded-xl bg-[rgb(var(--brand))]/5 border border-[rgb(var(--brand))]/15">
        <Info size={18} className="text-[rgb(var(--brand))] mt-0.5 shrink-0" />
        <div className="text-sm text-[rgb(var(--text-secondary))] space-y-1">
          <p className="font-medium text-[rgb(var(--text-primary))]">How to add an area</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Copy the area name (use the copy button — it gives you the lowercase key)</li>
            <li>Open <code className="text-xs bg-[rgb(var(--background))] px-1 py-0.5 rounded">lib/core/utils/inspection_pricing.dart</code></li>
            <li>Add the entry to <code className="text-xs bg-[rgb(var(--background))] px-1 py-0.5 rounded">_areaToCluster</code> with the correct cluster</li>
            <li>Click "Mark as Added" here so it doesn't show up again</li>
          </ol>
        </div>
      </div>

      {/* Filters + search */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Status tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-[rgb(var(--background))] w-fit">
          {(["pending", "all", "added", "dismissed"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize",
                statusFilter === s
                  ? "bg-[rgb(var(--surface))] text-[rgb(var(--text-primary))] shadow-sm"
                  : "text-[rgb(var(--text-hint))] hover:text-[rgb(var(--text-secondary))]"
              )}
            >
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
              <span className="ml-1.5 text-[10px] opacity-60">{counts[s]}</span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgb(var(--text-hint))]" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search area name..."
            className="input w-full pl-9 pr-8 py-2 text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[rgb(var(--text-hint))] hover:text-[rgb(var(--text-primary))]"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={28} className="animate-spin text-[rgb(var(--brand))]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[rgb(var(--background))] flex items-center justify-center mb-4">
            <MapPin size={24} className="text-[rgb(var(--text-hint))]" />
          </div>
          <p className="text-[rgb(var(--text-secondary))] font-medium">
            {statusFilter === "pending" ? "No pending area requests" : "No requests found"}
          </p>
          <p className="text-sm text-[rgb(var(--text-hint))] mt-1">
            {statusFilter === "pending"
              ? "All area requests have been reviewed"
              : "Try adjusting your filters"}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[rgb(var(--border))]">
                  {["Area Name", "Coordinates", "Source", "Submitted", "Status", "Actions"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold text-[rgb(var(--text-hint))] uppercase tracking-wide"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgb(var(--border))]">
                {filtered.map((r) => (
                  <AreaRow
                    key={r.id}
                    request={r}
                    canWrite={canWrite}
                    updating={updating === r.id}
                    copied={copied === r.rawName}
                    onCopy={() => copyName(r.rawName)}
                    onMarkAdded={() => {
                      setPickedLga("");
                      setAddingFor(r);
                    }}
                    onDismiss={() => setStatus(r.id, "dismissed")}
                    onReopen={() => setStatus(r.id, "pending")}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden space-y-3">
            {filtered.map((r) => (
              <AreaCard
                key={r.id}
                request={r}
                canWrite={canWrite}
                updating={updating === r.id}
                copied={copied === r.rawName}
                onCopy={() => copyName(r.rawName)}
                onMarkAdded={() => setStatus(r.id, "added")}
                onDismiss={() => setStatus(r.id, "dismissed")}
              />
            ))}
          </div>

          <p className="text-xs text-[rgb(var(--text-hint))] text-right">
            {filtered.length} of {requests.length} requests
          </p>
        </>
      )}

      {addingFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setAddingFor(null)}
        >
          <div
            className="card max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-1">
              <h3 className="font-semibold text-[rgb(var(--text-primary))]">
                Add &ldquo;{addingFor.rawName}&rdquo;
              </h3>
              <button onClick={() => setAddingFor(null)}>
                <X size={16} className="text-[rgb(var(--text-hint))]" />
              </button>
            </div>
            <p className="text-xs text-[rgb(var(--text-secondary))] mb-4">
              Pick the LGA this area belongs to. It decides the inspection fee
              landlords and tenants are quoted, so check the pin on the map
              before choosing.
            </p>

            {addingFor.lat !== null && addingFor.lng !== null ? (
              <a
                href={mapsUrl(addingFor.lat, addingFor.lng)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-[rgb(var(--brand))] hover:underline mb-4"
              >
                <ExternalLink size={12} />
                View {addingFor.lat.toFixed(4)}, {addingFor.lng.toFixed(4)} on the map
              </a>
            ) : (
              <p className="text-xs text-[rgb(var(--warning))] mb-4">
                No position was captured for this report — search the name
                yourself before picking an LGA.
              </p>
            )}

            <select
              value={pickedLga}
              onChange={(e) => setPickedLga(e.target.value)}
              className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background))] px-3 py-2 text-sm text-[rgb(var(--text-primary))] mb-4"
            >
              <option value="">Select an LGA…</option>
              {LGA_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <p className="text-[11px] text-[rgb(var(--text-hint))] mb-4">
              Publishes to <code>config/areas</code>. Landlords see it the next
              time they open the app — no release needed.
            </p>

            <div className="flex gap-2 justify-end">
              <button
                className="px-3 py-1.5 rounded-lg text-sm text-[rgb(var(--text-secondary))]"
                onClick={() => setAddingFor(null)}
              >
                Cancel
              </button>
              <button
                disabled={!pickedLga || updating === addingFor.id}
                onClick={() => publishArea(addingFor, pickedLga)}
                className="px-3 py-1.5 rounded-lg text-sm bg-[rgb(var(--brand))] text-white disabled:opacity-40"
              >
                {updating === addingFor.id ? "Publishing…" : "Publish area"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Desktop row ──────────────────────────────────────────────────────────────

function AreaRow({
  request: r,
  canWrite,
  updating,
  copied,
  onCopy,
  onMarkAdded,
  onDismiss,
  onReopen,
}: {
  request: AreaRequest;
  canWrite: boolean;
  updating: boolean;
  copied: boolean;
  onCopy: () => void;
  onMarkAdded: () => void;
  onDismiss: () => void;
  onReopen: () => void;
}) {
  const cfg = STATUS_CONFIG[r.status];
  const StatusIcon = cfg.icon;

  return (
    <tr className="hover:bg-[rgb(var(--background))]/50 transition-colors">
      {/* Area name */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-medium text-[rgb(var(--text-primary))]">{r.rawName}</span>
          <button
            onClick={onCopy}
            title="Copy lowercase key"
            className="text-[rgb(var(--text-hint))] hover:text-[rgb(var(--brand))] transition-colors"
          >
            {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
          </button>
        </div>
        <p className="text-[10px] text-[rgb(var(--text-hint))] mt-0.5">
          key: <code>{r.rawName.toLowerCase()}</code>
        </p>
      </td>

      {/* Coordinates */}
      <td className="px-4 py-3">
        {r.lat !== null && r.lng !== null ? (
          <a
            href={mapsUrl(r.lat, r.lng)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[rgb(var(--brand))] hover:underline text-xs"
          >
            {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
            <ExternalLink size={11} />
          </a>
        ) : (
          <span className="text-xs text-[rgb(var(--text-hint))]">no position</span>
        )}
      </td>

      {/* Source */}
      <td className="px-4 py-3">
        <span className="text-xs text-[rgb(var(--text-secondary))] bg-[rgb(var(--background))] px-2 py-0.5 rounded-md">
          {r.source.replace(/_/g, " ")}
        </span>
      </td>

      {/* Submitted */}
      <td className="px-4 py-3 text-xs text-[rgb(var(--text-secondary))]">
        {timeAgo(r.createdAt)}
      </td>

      {/* Status badge */}
      <td className="px-4 py-3">
        <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg", cfg.cls)}>
          <StatusIcon size={11} />
          {cfg.label}
        </span>
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        {!canWrite ? (
          <span className="text-xs text-[rgb(var(--text-hint))]">—</span>
        ) : updating ? (
          <Loader2 size={16} className="animate-spin text-[rgb(var(--text-hint))]" />
        ) : r.status === "pending" ? (
          <div className="flex items-center gap-2">
            <button
              onClick={onMarkAdded}
              className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors"
            >
              <CheckCircle2 size={12} />
              Mark Added
            </button>
            <button
              onClick={onDismiss}
              className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg bg-[rgb(var(--background))] text-[rgb(var(--text-hint))] hover:text-[rgb(var(--text-primary))] transition-colors"
            >
              <EyeOff size={12} />
              Dismiss
            </button>
          </div>
        ) : (
          <button
            onClick={onReopen}
            className="inline-flex items-center gap-1 text-xs text-[rgb(var(--text-hint))] hover:text-[rgb(var(--text-primary))] transition-colors"
          >
            <RefreshCw size={12} />
            Reopen
          </button>
        )}
      </td>
    </tr>
  );
}

// ─── Mobile card ──────────────────────────────────────────────────────────────

function AreaCard({
  request: r,
  canWrite,
  updating,
  copied,
  onCopy,
  onMarkAdded,
  onDismiss,
}: {
  request: AreaRequest;
  canWrite: boolean;
  updating: boolean;
  copied: boolean;
  onCopy: () => void;
  onMarkAdded: () => void;
  onDismiss: () => void;
}) {
  const cfg = STATUS_CONFIG[r.status];
  const StatusIcon = cfg.icon;

  return (
    <div className="card p-4 space-y-3">
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[rgb(var(--brand))]/10 flex items-center justify-center shrink-0">
            <MapPin size={15} className="text-[rgb(var(--brand))]" />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-sm text-[rgb(var(--text-primary))] truncate">{r.rawName}</p>
            <p className="text-[10px] text-[rgb(var(--text-hint))]">
              key: <code>{r.rawName.toLowerCase()}</code>
            </p>
          </div>
        </div>
        <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg shrink-0", cfg.cls)}>
          <StatusIcon size={11} />
          {cfg.label}
        </span>
      </div>

      {/* Details */}
      <div className="flex flex-wrap gap-3 text-xs text-[rgb(var(--text-secondary))]">
        {r.lat !== null && r.lng !== null ? (
          <a
            href={mapsUrl(r.lat, r.lng)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[rgb(var(--brand))] hover:underline"
          >
            {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
            <ExternalLink size={10} />
          </a>
        ) : (
          <span className="text-[rgb(var(--text-hint))]">no position</span>
        )}
        <span className="bg-[rgb(var(--background))] px-2 py-0.5 rounded-md">
          {r.source.replace(/_/g, " ")}
        </span>
        <span>{timeAgo(r.createdAt)}</span>
      </div>

      {/* Actions */}
      {updating ? (
        <Loader2 size={16} className="animate-spin text-[rgb(var(--text-hint))]" />
      ) : (
        <div className="flex items-center gap-2 pt-1 border-t border-[rgb(var(--border))]">
          <button
            onClick={onCopy}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[rgb(var(--background))] text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))] transition-colors"
          >
            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            Copy key
          </button>
          {canWrite && r.status === "pending" && (
            <>
              <button
                onClick={onMarkAdded}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors"
              >
                <CheckCircle2 size={12} />
                Mark Added
              </button>
              <button
                onClick={onDismiss}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[rgb(var(--background))] text-[rgb(var(--text-hint))] hover:text-[rgb(var(--text-primary))] transition-colors"
              >
                <EyeOff size={12} />
                Dismiss
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
