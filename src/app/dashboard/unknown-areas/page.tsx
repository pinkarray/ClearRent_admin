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
  lat: number;
  lng: number;
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UnknownAreasPage() {
  const { canWrite } = useAuth();
  const [requests, setRequests] = useState<AreaRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

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
          lat: data.lat ?? 0,
          lng: data.lng ?? 0,
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
                    onMarkAdded={() => setStatus(r.id, "added")}
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
        <a
          href={mapsUrl(r.lat, r.lng)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[rgb(var(--brand))] hover:underline text-xs"
        >
          {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
          <ExternalLink size={11} />
        </a>
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
        <a
          href={mapsUrl(r.lat, r.lng)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[rgb(var(--brand))] hover:underline"
        >
          {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
          <ExternalLink size={10} />
        </a>
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
