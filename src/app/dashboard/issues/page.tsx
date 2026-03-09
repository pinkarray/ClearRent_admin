"use client";

import { useEffect, useState, useMemo } from "react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
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
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);

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
          {filtered.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              onView={() => setSelectedIssue(issue)}
            />
          ))}
        </div>
      )}

      {/* Detail panel */}
      {selectedIssue && (
        <IssueDetailPanel
          issue={selectedIssue}
          onClose={() => setSelectedIssue(null)}
        />
      )}
    </div>
  );
}

// ─── Issue Row ────────────────────────────────────────────────────────────────

function IssueRow({ issue, onView }: { issue: Issue; onView: () => void }) {
  const cat = CATEGORY_CONFIG[issue.category] || CATEGORY_CONFIG.other;
  const CatIcon = cat.icon;

  return (
    <div
      className="card flex items-center gap-4 cursor-pointer hover:border-[rgb(var(--text-hint))]/40 transition-all py-3"
      onClick={onView}
    >
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
        </p>
      </div>

      {/* Status + time */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        <StatusBadge status={issue.status} />
        <span className="text-[10px] text-[rgb(var(--text-hint))]">
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

          {/* Admin note */}
          <div className="p-4 rounded-xl bg-[rgb(var(--background))] border border-[rgb(var(--border))]">
            <p className="text-xs text-[rgb(var(--text-hint))]">
              Issue management (status updates, tenant notifications) is handled by the landlord in the mobile app. This view is read-only for monitoring purposes.
            </p>
          </div>
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