"use client";

import { useEffect, useState, useMemo } from "react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { parseTimestamp } from "@/types";
import { cn, timeAgo } from "@/lib/utils";
import {
  AlertTriangle,
  Search,
  X,
  Loader2,
  CheckCircle2,
  Clock,
  Wrench,
  Zap,
  Building2,
  Bug,
  ShieldAlert,
  Sparkles,
  HelpCircle,
  ChefHat,
  User,
  Home,
  Image as ImageIcon,
  ExternalLink,
  ArrowUpRight,
  BarChart2,
  Bell,
  CheckSquare,
  Square,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusFilter = "all" | "open" | "in_progress" | "pending_confirmation" | "resolved";
type PriorityFilter = "all" | "high" | "medium" | "low";
type CategoryFilter = "all" | "plumbing" | "electrical" | "structural" | "appliance" | "pest" | "security" | "cleaning" | "other";

interface Issue {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  // Parties
  tenantId: string;
  tenantName: string;
  landlordId: string;
  landlordName?: string;
  propertyId: string;
  propertyTitle: string;
  // Media
  images: string[];
  // Timestamps
  createdAt: Date;
  updatedAt?: Date;
  resolvedAt?: Date;
  pendingConfirmationAt?: Date;
  // Admin nudges (written by the nudgeIssueParty CF)
  lastNudgedAt?: Date;
  lastNudgedTarget?: string;
  nudgeCount: number;
}

// ─── Category config ──────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<string, { icon: any; label: string; color: string }> = {
  plumbing:   { icon: Wrench,      label: "Plumbing",    color: "text-blue-500 bg-blue-500/10" },
  electrical: { icon: Zap,         label: "Electrical",  color: "text-yellow-500 bg-yellow-500/10" },
  structural: { icon: Building2,   label: "Structural",  color: "text-stone-500 bg-stone-500/10" },
  appliance:  { icon: ChefHat,     label: "Appliance",   color: "text-purple-500 bg-purple-500/10" },
  pest:       { icon: Bug,         label: "Pest",        color: "text-orange-500 bg-orange-500/10" },
  security:   { icon: ShieldAlert, label: "Security",    color: "text-red-500 bg-red-500/10" },
  cleaning:   { icon: Sparkles,    label: "Cleaning",    color: "text-teal-500 bg-teal-500/10" },
  other:      { icon: HelpCircle,  label: "Other",       color: "text-[rgb(var(--text-hint))] bg-[rgb(var(--background))]" },
};

// A fix awaiting confirmation past this many days is going stale — the CF
// sweep (issuePendingConfirmationReminders) escalates on the same schedule.
const STALE_PENDING_DAYS = 7;

// Mirrors BULK_MAX in the nudgeIssuesBulk CF — keep the two in step so the UI
// never offers a selection the server will reject outright.
const BULK_MAX = 50;

/** Days an issue has been sitting awaiting tenant confirmation, or null. */
function pendingDays(issue: Issue): number | null {
  if (issue.status !== "pending_confirmation") return null;
  const since = issue.pendingConfirmationAt ?? issue.updatedAt ?? issue.createdAt;
  return Math.floor((Date.now() - since.getTime()) / 86_400_000);
}

const PRIORITY_CONFIG: Record<string, { cls: string; label: string }> = {
  high:   { cls: "badge-error",   label: "High" },
  medium: { cls: "badge-warning", label: "Medium" },
  low:    { cls: "badge bg-blue-500/10 text-blue-600 dark:text-blue-400", label: "Low" },
};

const STATUS_CONFIG: Record<string, { cls: string; label: string; icon: any }> = {
  open:                 { cls: "badge-error",   label: "Open",            icon: AlertTriangle },
  in_progress:          { cls: "badge-warning", label: "In Progress",     icon: Clock },
  pending_confirmation: { cls: "badge bg-purple-500/10 text-purple-600 dark:text-purple-400", label: "Pending Confirm", icon: Clock },
  resolved:             { cls: "badge-success", label: "Resolved",        icon: CheckCircle2 },
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function IssuesPage() {
  const { canWrite } = useAuth();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  // Hold the id, not the doc: the open panel then re-renders from the live
  // snapshot (so a nudge's own stamp lands in it without a refresh).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIssue = useMemo(
    () => issues.find((i) => i.id === selectedId) ?? null,
    [issues, selectedId]
  );
  // Checkbox selection for a bulk nudge over whatever is currently filtered.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // What the "Nudge all" banner button targets, when it's the one that opened
  // the modal rather than a hand-picked selection.
  const [bulkSource, setBulkSource] = useState<"stale" | "checked">("stale");

  // ── Listener ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const q = query(collection(db, "issues"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const parsed: Issue[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          title: data.title || "Untitled Issue",
          description: data.description || "",
          category: data.category || "other",
          priority: data.priority || "medium",
          status: data.status || "open",
          tenantId: data.tenantId || "",
          tenantName: data.tenantName || "Unknown Tenant",
          landlordId: data.landlordId || "",
          landlordName: data.landlordName,
          propertyId: data.propertyId || "",
          propertyTitle: data.propertyTitle || "Unknown Property",
          images: data.images || [],
          createdAt: parseTimestamp(data.createdAt) || new Date(),
          updatedAt: parseTimestamp(data.updatedAt),
          resolvedAt: parseTimestamp(data.resolvedAt),
          pendingConfirmationAt: parseTimestamp(data.pendingConfirmationAt),
          lastNudgedAt: parseTimestamp(data.lastNudgedAt),
          lastNudgedTarget: data.lastNudgedTarget,
          nudgeCount: data.nudgeCount || 0,
        };
      });
      setIssues(parsed);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // ── Counts ─────────────────────────────────────────────────────────────────

  const openCount       = issues.filter((i) => i.status === "open").length;
  const inProgressCount = issues.filter((i) => i.status === "in_progress").length;
  const pendingCount    = issues.filter((i) => i.status === "pending_confirmation").length;
  const resolvedCount   = issues.filter((i) => i.status === "resolved").length;
  const highPriorityOpen = issues.filter((i) => i.status === "open" && i.priority === "high").length;
  // Fixes the tenant never signed off on — the quiet failure mode: not open,
  // not resolved, nobody chasing.
  const stalePending = useMemo(
    () => issues.filter((i) => (pendingDays(i) ?? 0) >= STALE_PENDING_DAYS),
    [issues]
  );

  // ── Filtering ──────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return issues.filter((issue) => {
      if (statusFilter !== "all" && issue.status !== statusFilter) return false;
      if (priorityFilter !== "all" && issue.priority !== priorityFilter) return false;
      if (categoryFilter !== "all" && issue.category !== categoryFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          issue.title.toLowerCase().includes(q) ||
          issue.propertyTitle.toLowerCase().includes(q) ||
          issue.tenantName.toLowerCase().includes(q) ||
          issue.description.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [issues, statusFilter, priorityFilter, categoryFilter, searchQuery]);

  // ── Selection ──────────────────────────────────────────────────────────────

  // Resolved issues have nobody to chase, so they can't be picked.
  const selectable = useMemo(
    () => filtered.filter((i) => waitingOn(i.status) !== null),
    [filtered]
  );

  // Drop the selection whenever the visible set changes — carrying hidden
  // picks across a filter change is how you nudge someone you never saw.
  useEffect(() => {
    setChecked(new Set());
  }, [statusFilter, priorityFilter, categoryFilter, searchQuery]);

  const checkedIssues = useMemo(
    () => issues.filter((i) => checked.has(i.id)),
    [issues, checked]
  );

  function toggleChecked(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < BULK_MAX) next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setChecked((prev) =>
      prev.size > 0
        ? new Set()
        : new Set(selectable.slice(0, BULK_MAX).map((i) => i.id))
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-display font-bold text-[rgb(var(--text-primary))]">
          Issues
        </h1>
        <p className="text-sm text-[rgb(var(--text-secondary))] mt-1">
          {issues.length} total ·{" "}
          <span className={cn(openCount > 0 ? "text-red-500 font-medium" : "")}>
            {openCount} open
          </span>{" "}
          · {inProgressCount} in progress · {pendingCount} pending confirm · {resolvedCount} resolved
        </p>
      </div>

      {/* High priority alert */}
      {highPriorityOpen > 0 && (
        <div
          className="card border-red-500/30 bg-red-500/5 flex items-start gap-3 cursor-pointer hover:bg-red-500/10 transition-colors"
          onClick={() => { setStatusFilter("open"); setPriorityFilter("high"); }}
        >
          <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle size={18} className="text-red-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">
              {highPriorityOpen} high-priority issue{highPriorityOpen !== 1 ? "s" : ""} open
            </p>
            <p className="text-xs text-[rgb(var(--text-secondary))] mt-0.5">
              Tap to filter — these are marked as urgent by tenants.
            </p>
          </div>
          <ArrowUpRight size={16} className="text-red-500 shrink-0 mt-1" />
        </div>
      )}

      {/* Stale pending alert */}
      {stalePending.length > 0 && (
        <div
          className="card border-purple-500/30 bg-purple-500/5 flex items-start gap-3 cursor-pointer hover:bg-purple-500/10 transition-colors"
          onClick={() => { setStatusFilter("pending_confirmation"); setPriorityFilter("all"); }}
        >
          <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center shrink-0 mt-0.5">
            <Clock size={18} className="text-purple-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">
              {stalePending.length} fix{stalePending.length !== 1 ? "es" : ""} unconfirmed for over a week
            </p>
            <p className="text-xs text-[rgb(var(--text-secondary))] mt-0.5">
              The landlord says it&apos;s done; the tenant never confirmed or disputed.
            </p>
          </div>
          {canWrite ? (
            <button
              onClick={(e) => { e.stopPropagation(); setBulkSource("stale"); setBulkOpen(true); }}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 transition-colors shrink-0"
            >
              <Bell size={13} />
              Nudge all
            </button>
          ) : (
            <ArrowUpRight size={16} className="text-purple-500 shrink-0 mt-1" />
          )}
        </div>
      )}

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(
          [
            ["open", openCount, "Open", "text-red-500 bg-red-500/10"],
            ["in_progress", inProgressCount, "In Progress", "text-amber-500 bg-amber-500/10"],
            ["pending_confirmation", pendingCount, "Pending", "text-purple-500 bg-purple-500/10"],
            ["resolved", resolvedCount, "Resolved", "text-emerald-500 bg-emerald-500/10"],
          ] as [StatusFilter, number, string, string][]
        ).map(([value, count, label, color]) => (
          <button
            key={value}
            onClick={() => setStatusFilter(value)}
            className={cn(
              "card p-4 text-left transition-all hover:scale-[1.02]",
              statusFilter === value && "ring-2 ring-[rgb(var(--brand))]/30"
            )}
          >
            <p className={cn("text-2xl font-bold font-display", color.split(" ")[0])}>
              {count}
            </p>
            <p className="text-xs text-[rgb(var(--text-hint))] mt-1">{label}</p>
          </button>
        ))}
      </div>

      {/* Status tab filter */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["All", issues.length, "all"],
            ["Open", openCount, "open"],
            ["In Progress", inProgressCount, "in_progress"],
            ["Pending Confirm", pendingCount, "pending_confirmation"],
            ["Resolved", resolvedCount, "resolved"],
          ] as [string, number, StatusFilter][]
        ).map(([label, count, value]) => (
          <button
            key={value}
            onClick={() => setStatusFilter(value)}
            className={cn(
              "px-3 py-1.5 rounded-xl text-sm font-medium transition-all border",
              statusFilter === value
                ? "bg-[rgb(var(--brand))]/10 text-[rgb(var(--brand))] border-[rgb(var(--brand))]/30"
                : "bg-[rgb(var(--surface))] text-[rgb(var(--text-secondary))] border-[rgb(var(--border))] hover:border-[rgb(var(--text-hint))]"
            )}
          >
            {label}
            <span className="ml-1.5 text-xs opacity-60">{count}</span>
          </button>
        ))}
      </div>

      {/* Secondary filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[rgb(var(--text-hint))]" />
          <input
            type="text"
            placeholder="Search by title, property, or tenant..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input pl-10"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgb(var(--text-hint))] hover:text-[rgb(var(--text-secondary))]">
              <X size={14} />
            </button>
          )}
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
          className="input w-auto min-w-[160px] cursor-pointer"
        >
          <option value="all">All Categories</option>
          {Object.entries(CATEGORY_CONFIG).map(([value, cfg]) => (
            <option key={value} value={value}>{cfg.label}</option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as PriorityFilter)}
          className="input w-auto min-w-[140px] cursor-pointer"
        >
          <option value="all">All Priorities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-[rgb(var(--brand))]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16">
          <CheckCircle2 size={40} className="mx-auto text-emerald-500 mb-4" />
          <p className="text-[rgb(var(--text-secondary))] font-medium">No issues found</p>
          <p className="text-sm text-[rgb(var(--text-hint))] mt-1">
            {searchQuery ? "Try a different search term" : "Adjust your filters"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Select-all, only where there's something nudgeable to select */}
          {canWrite && selectable.length > 0 && (
            <div className="flex items-center justify-between px-1 pb-1">
              <button
                onClick={toggleAll}
                className="flex items-center gap-2 text-xs text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--brand))] transition-colors"
              >
                {checked.size > 0 ? <CheckSquare size={14} /> : <Square size={14} />}
                {checked.size > 0
                  ? `Clear selection (${checked.size})`
                  : `Select all ${
                      selectable.length > BULK_MAX ? `${BULK_MAX} of ${selectable.length}` : selectable.length
                    }`}
              </button>
              {selectable.length > BULK_MAX && checked.size === 0 && (
                <span className="text-[10px] text-[rgb(var(--text-hint))]">
                  {BULK_MAX} max per nudge
                </span>
              )}
            </div>
          )}
          {filtered.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              onView={() => setSelectedId(issue.id)}
              selectable={canWrite && waitingOn(issue.status) !== null}
              checked={checked.has(issue.id)}
              onToggle={() => toggleChecked(issue.id)}
              atCap={checked.size >= BULK_MAX}
            />
          ))}
        </div>
      )}

      {/* Selection action bar */}
      {checked.size > 0 && (
        <div className="sticky bottom-4 z-30 flex items-center justify-between gap-4 card border-[rgb(var(--brand))]/40 bg-[rgb(var(--surface))] shadow-lg py-3">
          <p className="text-sm text-[rgb(var(--text-primary))]">
            <span className="font-semibold">{checked.size}</span> selected
            {checked.size >= BULK_MAX && (
              <span className="text-xs text-[rgb(var(--text-hint))] ml-2">
                at the {BULK_MAX} limit
              </span>
            )}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setChecked(new Set())}
              className="text-xs px-3 py-2 rounded-lg border border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))] transition-colors"
            >
              Clear
            </button>
            <button
              onClick={() => { setBulkSource("checked"); setBulkOpen(true); }}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[rgb(var(--brand))] text-white hover:opacity-90 transition-opacity"
            >
              <Bell size={13} />
              Nudge selected
            </button>
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selectedIssue && (
        <IssueDetailPanel
          issue={selectedIssue}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* Bulk nudge */}
      {bulkOpen && (
        <BulkNudgeModal
          issues={bulkSource === "stale" ? stalePending.slice(0, BULK_MAX) : checkedIssues}
          onClose={() => setBulkOpen(false)}
          onSent={() => setChecked(new Set())}
        />
      )}
    </div>
  );
}

// ─── Issue Row ────────────────────────────────────────────────────────────────

function IssueRow({
  issue,
  onView,
  selectable,
  checked,
  onToggle,
  atCap,
}: {
  issue: Issue;
  onView: () => void;
  selectable: boolean;
  checked: boolean;
  onToggle: () => void;
  atCap: boolean;
}) {
  const cat = CATEGORY_CONFIG[issue.category] || CATEGORY_CONFIG.other;
  const CatIcon = cat.icon;
  const waiting = pendingDays(issue);
  // At the cap, unchecked rows go inert rather than silently no-op'ing.
  const disabled = atCap && !checked;

  return (
    <div
      className={cn(
        "card flex items-center gap-4 cursor-pointer hover:border-[rgb(var(--text-hint))]/40 transition-all py-3",
        checked && "border-[rgb(var(--brand))]/40 bg-[rgb(var(--brand))]/[0.03]"
      )}
      onClick={onView}
    >
      {/* Selection */}
      {selectable && (
        <button
          onClick={(e) => { e.stopPropagation(); if (!disabled) onToggle(); }}
          disabled={disabled}
          aria-label={checked ? "Deselect issue" : "Select issue"}
          className={cn(
            "shrink-0 transition-colors",
            checked
              ? "text-[rgb(var(--brand))]"
              : disabled
                ? "text-[rgb(var(--text-hint))]/30 cursor-not-allowed"
                : "text-[rgb(var(--text-hint))] hover:text-[rgb(var(--brand))]"
          )}
        >
          {checked ? <CheckSquare size={16} /> : <Square size={16} />}
        </button>
      )}

      {/* Category icon */}
      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", cat.color)}>
        <CatIcon size={18} />
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-[rgb(var(--text-primary))] truncate">
            {issue.title}
          </p>
          <PriorityBadge priority={issue.priority} />
        </div>
        <p className="text-xs text-[rgb(var(--text-hint))] mt-0.5 truncate">
          {issue.propertyTitle} · {issue.tenantName}
          {waiting !== null && (
            <span
              className={cn(
                "ml-2",
                waiting >= STALE_PENDING_DAYS
                  ? "text-purple-500 font-medium"
                  : "text-[rgb(var(--text-hint))]"
              )}
            >
              · awaiting confirmation {waiting}d
            </span>
          )}
        </p>
      </div>

      {/* Status + time */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        <StatusBadge status={issue.status} />
        <span className="text-[10px] text-[rgb(var(--text-hint))] flex items-center gap-1">
          {issue.lastNudgedAt && (
            <Bell
              size={10}
              className="text-[rgb(var(--brand))]"
              // Saves opening every row to see which ones have been chased.
              aria-label={`Nudged ${timeAgo(issue.lastNudgedAt)}`}
            />
          )}
          {timeAgo(issue.createdAt)}
        </span>
      </div>
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function IssueDetailPanel({ issue, onClose }: { issue: Issue; onClose: () => void }) {
  const cat = CATEGORY_CONFIG[issue.category] || CATEGORY_CONFIG.other;
  const CatIcon = cat.icon;
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-full max-w-md z-50 bg-[rgb(var(--surface))] border-l border-[rgb(var(--border))] shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[rgb(var(--surface))] border-b border-[rgb(var(--border))] px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-display font-semibold text-[rgb(var(--text-primary))]">Issue Details</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[rgb(var(--background))] transition-colors">
            <X size={18} className="text-[rgb(var(--text-secondary))]" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Category + title */}
          <div className="flex items-start gap-3">
            <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center shrink-0 mt-0.5", cat.color)}>
              <CatIcon size={20} />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-semibold text-[rgb(var(--text-primary))]">{issue.title}</h3>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="badge bg-[rgb(var(--background))] text-[rgb(var(--text-secondary))] border border-[rgb(var(--border))] capitalize">
                  {cat.label}
                </span>
                <PriorityBadge priority={issue.priority} />
                <StatusBadge status={issue.status} />
              </div>
            </div>
          </div>

          {/* Description */}
          {issue.description && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">Description</h4>
              <p className="text-sm text-[rgb(var(--text-secondary))] leading-relaxed">{issue.description}</p>
            </div>
          )}

          {/* Images */}
          {issue.images.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
                Photos ({issue.images.length})
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {issue.images.map((url, i) => (
                  <div
                    key={i}
                    className="relative aspect-square rounded-xl overflow-hidden bg-[rgb(var(--background))] cursor-pointer group"
                    onClick={() => setLightboxImg(url)}
                  >
                    <img src={url} alt={`Issue photo ${i + 1}`} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <ExternalLink size={18} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Parties */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">Parties</h4>
            <DetailRow icon={User} label="Tenant" value={issue.tenantName} />
            {issue.landlordName && (
              <DetailRow icon={User} label="Landlord" value={issue.landlordName} />
            )}
            <DetailRow icon={Home} label="Property" value={issue.propertyTitle} />
          </div>

          {/* Timeline */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">Timeline</h4>
            <DetailRow icon={Clock} label="Reported" value={issue.createdAt.toLocaleString("en-NG")} />
            {issue.pendingConfirmationAt && (
              <DetailRow icon={Clock} label="Fix Submitted" value={issue.pendingConfirmationAt.toLocaleString("en-NG")} />
            )}
            {issue.resolvedAt && (
              <DetailRow icon={CheckCircle2} label="Resolved" value={issue.resolvedAt.toLocaleString("en-NG")} />
            )}
          </div>

          {/* Nudge */}
          <NudgeSection issue={issue} />
        </div>
      </div>

      {/* Lightbox */}
      {lightboxImg && (
        <div
          className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4"
          onClick={() => setLightboxImg(null)}
        >
          <img src={lightboxImg} alt="Issue photo" className="max-w-full max-h-full object-contain rounded-xl" />
          <button className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors">
            <X size={20} className="text-white" />
          </button>
        </div>
      )}
    </>
  );
}

// ─── Bulk nudge ───────────────────────────────────────────────────────────────
// Confirm-then-send: this fires real pushes at real people, so the count and
// the recipients are spelled out before anything leaves. The server re-checks
// each issue and skips anyone nudged in the last day, so the "will send" count
// here is an upper bound — the result summary is the truth.

function BulkNudgeModal({
  issues,
  onClose,
  onSent,
}: {
  issues: Issue[];
  onClose: () => void;
  /** Clears the caller's selection once the batch actually went out. */
  onSent: () => void;
}) {
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ sent: number; skipped: number } | null>(
    null
  );

  const recentlyNudged = issues.filter(
    (i) => i.lastNudgedAt && Date.now() - i.lastNudgedAt.getTime() < 20 * 3_600_000
  ).length;

  // The server derives the recipient per issue from its status, so a
  // hand-picked selection can span both parties. Say which, plainly.
  const tenants = issues.filter((i) => waitingOn(i.status) === "tenant").length;
  const landlords = issues.filter((i) => waitingOn(i.status) === "landlord").length;
  const who =
    tenants && landlords
      ? `${tenants} tenant${tenants !== 1 ? "s" : ""} and ${landlords} landlord${landlords !== 1 ? "s" : ""}`
      : landlords
        ? `${landlords} landlord${landlords !== 1 ? "s" : ""}`
        : `${tenants} tenant${tenants !== 1 ? "s" : ""}`;

  async function send() {
    setSending(true);
    setError(null);
    try {
      const fn = httpsCallable<
        { issueIds: string[]; note?: string },
        { ok: boolean; sent: number; skipped: { issueId: string; reason: string }[] }
      >(functions, "nudgeIssuesBulk");
      const res = await fn({
        issueIds: issues.map((i) => i.id),
        note: note.trim() || undefined,
      });
      setResult({ sent: res.data.sent, skipped: res.data.skipped.length });
      onSent();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not send the reminders. Try again."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
      <div className="w-full max-w-md rounded-2xl bg-[rgb(var(--surface))] border border-[rgb(var(--border))] shadow-2xl">
        <div className="px-6 py-4 border-b border-[rgb(var(--border))] flex items-center justify-between">
          <h2 className="font-display font-semibold text-[rgb(var(--text-primary))]">
            {result ? "Reminders sent" : `Nudge ${who}`}
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[rgb(var(--background))] transition-colors">
            <X size={18} className="text-[rgb(var(--text-secondary))]" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {result ? (
            <>
              <p className="text-sm text-[rgb(var(--text-secondary))] flex items-start gap-2">
                <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" />
                Sent {result.sent} reminder{result.sent !== 1 ? "s" : ""}.
              </p>
              {result.skipped > 0 && (
                <p className="text-xs text-[rgb(var(--text-hint))]">
                  {result.skipped} skipped — already nudged in the last day, or
                  confirmed since you loaded this page.
                </p>
              )}
              <button onClick={onClose} className="btn-primary w-full">
                Done
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-[rgb(var(--text-secondary))]">
                {landlords > 0 && tenants > 0
                  ? "Each person gets the reminder that fits their issue — landlords to act on a report, tenants to confirm or dispute a fix."
                  : landlords > 0
                    ? "Each landlord gets a push asking them to act on their tenant's report."
                    : "Each tenant gets a push asking them to confirm or dispute the fix on their property."}{" "}
                One reminder per issue.
              </p>
              {recentlyNudged > 0 && (
                <p className="text-xs text-[rgb(var(--text-hint))] flex items-start gap-1.5">
                  <Bell size={12} className="shrink-0 mt-0.5" />
                  {recentlyNudged} of these {recentlyNudged === 1 ? "was" : "were"} nudged
                  in the last day and will be skipped.
                </p>
              )}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={300}
                placeholder="Optional note added to every reminder..."
                className="input resize-none text-sm"
              />
              {error && (
                <p className="text-xs text-red-500 flex items-start gap-1.5">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  disabled={sending}
                  className="flex-1 px-4 py-2 rounded-xl text-sm border border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))] transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={send}
                  disabled={sending}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm bg-[rgb(var(--brand))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />}
                  Send {issues.length} reminder{issues.length !== 1 ? "s" : ""}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Nudge ────────────────────────────────────────────────────────────────────
// The only write this page makes. Everything else about an issue is driven by
// the parties in the mobile app; this is the admin's lever when a report has
// been sitting on someone. Server-side (nudgeIssueParty) re-checks the status,
// so the gating here is UX, not the security boundary.

/** Which party the issue is currently waiting on, if any. */
function waitingOn(status: string): "landlord" | "tenant" | null {
  if (status === "open" || status === "in_progress") return "landlord";
  if (status === "pending_confirmation") return "tenant";
  return null; // resolved — nobody left to chase
}

function NudgeSection({ issue }: { issue: Issue }) {
  const { canWrite } = useAuth();
  const [note, setNote] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const target = waitingOn(issue.status);
  const waiting = pendingDays(issue);

  async function send(to: "landlord" | "tenant") {
    setSending(to);
    setError(null);
    try {
      const fn = httpsCallable<
        { issueId: string; target: "landlord" | "tenant"; note?: string },
        { ok: boolean }
      >(functions, "nudgeIssueParty");
      await fn({ issueId: issue.id, target: to, note: note.trim() || undefined });
      setNote("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not send the reminder. Try again."
      );
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="p-4 rounded-xl bg-[rgb(var(--background))] border border-[rgb(var(--border))] space-y-3">
      <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
        Nudge
      </h4>

      {issue.lastNudgedAt && (
        <p className="text-xs text-[rgb(var(--text-secondary))] flex items-center gap-1.5">
          <Bell size={12} className="text-[rgb(var(--brand))] shrink-0" />
          Last nudged the {issue.lastNudgedTarget ?? "landlord"}{" "}
          {timeAgo(issue.lastNudgedAt)}
          {issue.nudgeCount > 1 ? ` · ${issue.nudgeCount} nudges total` : ""}
        </p>
      )}

      {target === null ? (
        <p className="text-xs text-[rgb(var(--text-hint))]">
          This issue is resolved — there&apos;s no one left to chase.
        </p>
      ) : !canWrite ? (
        <p className="text-xs text-[rgb(var(--text-hint))]">
          Read-only access. Sending a reminder needs an admin account.
        </p>
      ) : (
        <>
          <p className="text-xs text-[rgb(var(--text-hint))]">
            {target === "landlord"
              ? "Sends the landlord a push + in-app alert linking straight to this issue."
              : `The landlord marked this fixed${
                  waiting !== null ? ` ${waiting} days ago` : ""
                } — remind the tenant to confirm or dispute it. Automatic reminders go out at 3 and 7 days.`}
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={300}
            placeholder="Optional note to add to the reminder..."
            className="input resize-none text-sm"
          />
          <button
            onClick={() => send(target)}
            disabled={sending !== null}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[rgb(var(--brand))]/10 text-[rgb(var(--brand))] hover:bg-[rgb(var(--brand))]/20 transition-colors disabled:opacity-50"
          >
            {sending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Bell size={13} />
            )}
            Nudge {target === "landlord" ? issue.landlordName ?? "landlord" : issue.tenantName}
          </button>
          {error && (
            <p className="text-xs text-red-500 flex items-start gap-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ─── Shared Components ────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: string }) {
  const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.medium;
  return <span className={cn(cfg.cls, "text-[10px]")}>{cfg.label}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.open;
  return (
    <span className={cn(cfg.cls, "gap-1 text-[10px]")}>
      <cfg.icon size={10} />
      {cfg.label}
    </span>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-[rgb(var(--background))] flex items-center justify-center shrink-0">
        <Icon size={14} className="text-[rgb(var(--text-hint))]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-[rgb(var(--text-hint))]">{label}</p>
        <p className="text-sm text-[rgb(var(--text-primary))] truncate">{value}</p>
      </div>
    </div>
  );
}