"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, query, orderBy, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp, } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { parseTimestamp } from "@/types";
import { cn, timeAgo } from "@/lib/utils";
import { Megaphone, Plus, X, Loader2, Trash2, Users, User, Search, ChevronDown, ChevronUp, Globe, UserCheck, AlertTriangle, Info, CheckCircle2, Bell, } from "lucide-react";
import { collection as col, getDocs } from "firebase/firestore";

// ─── Types ────────────────────────────────────────────────────────────────────

type TargetType = "all" | "landlord" | "tenant" | "agent" | "specific";
type AnnouncementType = "info" | "warning" | "success" | "alert";

interface SimpleUser {
  id: string;
  fullName: string;
  email: string;
  accountType: string;
}

interface Announcement {
  id: string;
  title: string;
  body: string;
  type: AnnouncementType;
  targetType: TargetType;
  targetIds: string[];
  targetNames: string[];
  createdAt: Date;
  createdBy: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<AnnouncementType, { cls: string; icon: any; label: string; bar: string }> = {
  info:    { cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",    icon: Info,         label: "Info",    bar: "bg-blue-500" },
  warning: { cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20", icon: AlertTriangle, label: "Warning", bar: "bg-amber-500" },
  success: { cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20", icon: CheckCircle2, label: "Success", bar: "bg-emerald-500" },
  alert:   { cls: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",        icon: Bell,         label: "Alert",   bar: "bg-red-500" },
};

const TARGET_LABELS: Record<TargetType, string> = {
  all:      "Everyone",
  landlord: "All Landlords",
  tenant:   "All Tenants",
  agent:    "All Agents",
  specific: "Specific Users",
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showComposer, setShowComposer] = useState(false);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  // Listener
  useEffect(() => {
    const q = query(collection(db, "announcements"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const parsed: Announcement[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          title: data.title || "",
          body: data.body || "",
          type: data.type || "info",
          targetType: data.targetType || "all",
          targetIds: data.targetIds || [],
          targetNames: data.targetNames || [],
          createdAt: parseTimestamp(data.createdAt) || new Date(),
          createdBy: data.createdBy || "",
        };
      });
      setAnnouncements(parsed);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this announcement? Users will no longer see it.")) return;
    setDeleting((s) => new Set(s).add(id));
    try {
      await deleteDoc(doc(db, "announcements", id));
    } finally {
      setDeleting((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-[rgb(var(--text-primary))]">
            Announcements
          </h1>
          <p className="text-sm text-[rgb(var(--text-secondary))] mt-1">
            Broadcast messages to users — shown in their notification feed on mobile.
          </p>
        </div>
        <button
          onClick={() => setShowComposer(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[rgb(var(--brand))] text-white text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          <Plus size={16} />
          New Announcement
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-[rgb(var(--brand))]" />
        </div>
      ) : announcements.length === 0 ? (
        <div className="card text-center py-16">
          <Megaphone size={40} className="mx-auto text-[rgb(var(--text-hint))] mb-4" />
          <p className="text-[rgb(var(--text-secondary))] font-medium">No announcements yet</p>
          <p className="text-sm text-[rgb(var(--text-hint))] mt-1">
            Create one to notify users on the mobile app.
          </p>
          <button
            onClick={() => setShowComposer(true)}
            className="mt-4 px-4 py-2 rounded-xl bg-[rgb(var(--brand))]/10 text-[rgb(var(--brand))] text-sm font-semibold hover:bg-[rgb(var(--brand))]/20 transition-colors"
          >
            Create announcement
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <AnnouncementCard
              key={a.id}
              announcement={a}
              deleting={deleting.has(a.id)}
              onDelete={() => handleDelete(a.id)}
            />
          ))}
        </div>
      )}

      {/* Composer modal */}
      {showComposer && (
        <AnnouncementComposer onClose={() => setShowComposer(false)} />
      )}
    </div>
  );
}

// ─── Announcement Card ────────────────────────────────────────────────────────

function AnnouncementCard({
  announcement: a,
  deleting,
  onDelete,
}: {
  announcement: Announcement;
  deleting: boolean;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = TYPE_CONFIG[a.type] || TYPE_CONFIG.info;
  const TypeIcon = cfg.icon;

  return (
    <div className={cn("card border overflow-hidden", cfg.cls)}>
      {/* Colour bar */}
      <div className={cn("h-1 w-full -mt-4 mb-3 rounded-t-xl", cfg.bar)} />

      <div className="flex items-start gap-3">
        <div className={cn("w-9 h-9 rounded-xl border flex items-center justify-center shrink-0", cfg.cls)}>
          <TypeIcon size={16} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">{a.title}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <TargetBadge targetType={a.targetType} targetNames={a.targetNames} />
                <span className="text-[10px] text-[rgb(var(--text-hint))]">
                  {timeAgo(a.createdAt)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setExpanded((v) => !v)}
                className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-[rgb(var(--text-hint))]"
              >
                {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
              <button
                onClick={onDelete}
                disabled={deleting}
                className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors text-[rgb(var(--text-hint))] hover:text-red-500 disabled:opacity-50"
              >
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              </button>
            </div>
          </div>

          {expanded && (
            <div className="mt-3 pt-3 border-t border-current/10 space-y-2">
              <p className="text-sm text-[rgb(var(--text-secondary))] leading-relaxed">{a.body}</p>
              {a.targetType === "specific" && a.targetNames.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {a.targetNames.map((name, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-lg bg-[rgb(var(--surface))] text-xs text-[rgb(var(--text-secondary))] border border-[rgb(var(--border))]">
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Target Badge ─────────────────────────────────────────────────────────────

function TargetBadge({ targetType, targetNames }: { targetType: TargetType; targetNames: string[] }) {
  const iconMap: Record<TargetType, any> = {
    all: Globe, landlord: UserCheck, tenant: Users, agent: UserCheck, specific: User,
  };
  const Icon = iconMap[targetType] || Globe;
  const label = targetType === "specific"
    ? `${targetNames.length} user${targetNames.length !== 1 ? "s" : ""}`
    : TARGET_LABELS[targetType];

  return (
    <span className="flex items-center gap-1 badge bg-[rgb(var(--surface))]/60 text-[rgb(var(--text-secondary))] border border-[rgb(var(--border))]/50 text-[10px]">
      <Icon size={10} />
      {label}
    </span>
  );
}

// ─── Composer Modal ───────────────────────────────────────────────────────────

function AnnouncementComposer({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<AnnouncementType>("info");
  const [targetType, setTargetType] = useState<TargetType>("all");
  const [submitting, setSubmitting] = useState(false);

  // For specific targeting
  const [allUsers, setAllUsers] = useState<SimpleUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<SimpleUser[]>([]);

  // Load users when specific is selected
  useEffect(() => {
    if (targetType !== "specific") return;
    if (allUsers.length > 0) return;
    setUsersLoading(true);
    getDocs(query(col(db, "users"), orderBy("fullName"))).then((snap) => {
      const users: SimpleUser[] = snap.docs
        .filter((d) => d.id !== user?.uid)
        .map((d) => ({
          id: d.id,
          fullName: d.data().fullName || "Unknown",
          email: d.data().email || "",
          accountType: d.data().accountType || "tenant",
        }));
      setAllUsers(users);
      setUsersLoading(false);
    });
  }, [targetType]);

  const filteredUsers = useMemo(() => {
    if (!userSearch) return allUsers;
    const q = userSearch.toLowerCase();
    return allUsers.filter(
      (u) => u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }, [allUsers, userSearch]);

  const toggleUser = (user: SimpleUser) => {
    setSelectedUsers((prev) =>
      prev.find((u) => u.id === user.id)
        ? prev.filter((u) => u.id !== user.id)
        : [...prev, user]
    );
  };

  const canSubmit =
    title.trim() &&
    body.trim() &&
    (targetType !== "specific" || selectedUsers.length > 0);

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      await addDoc(collection(db, "announcements"), {
        title: title.trim(),
        body: body.trim(),
        type,
        targetType,
        targetIds: targetType === "specific" ? selectedUsers.map((u) => u.id) : [],
        targetNames: targetType === "specific" ? selectedUsers.map((u) => u.fullName) : [],
        createdAt: serverTimestamp(),
        createdBy: user?.uid ?? "",
        isRead: false,
      });
      onClose();
    } catch (e) {
      console.error("Failed to create announcement:", e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-[rgb(var(--surface))] rounded-2xl shadow-2xl border border-[rgb(var(--border))] overflow-hidden max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 border-b border-[rgb(var(--border))] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Megaphone size={18} className="text-[rgb(var(--brand))]" />
              <h2 className="font-display font-semibold text-[rgb(var(--text-primary))]">
                New Announcement
              </h2>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-[rgb(var(--background))] transition-colors">
              <X size={16} className="text-[rgb(var(--text-secondary))]" />
            </button>
          </div>

          {/* Body — scrollable */}
          <div className="overflow-y-auto flex-1 p-6 space-y-5">

            {/* Type selector */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
                Type
              </label>
              <div className="grid grid-cols-4 gap-2">
                {(Object.keys(TYPE_CONFIG) as AnnouncementType[]).map((t) => {
                  const cfg = TYPE_CONFIG[t];
                  const Icon = cfg.icon;
                  return (
                    <button
                      key={t}
                      onClick={() => setType(t)}
                      className={cn(
                        "flex flex-col items-center gap-1.5 py-3 rounded-xl border text-xs font-medium transition-all",
                        type === t ? cfg.cls : "border-[rgb(var(--border))] text-[rgb(var(--text-hint))] hover:border-[rgb(var(--text-hint))]"
                      )}
                    >
                      <Icon size={16} />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Target */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
                Send To
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(["all", "landlord", "tenant", "agent", "specific"] as TargetType[]).map((t) => {
                  const icons: Record<TargetType, any> = { all: Globe, landlord: UserCheck, tenant: Users, agent: UserCheck, specific: User };
                  const Icon = icons[t];
                  return (
                    <button
                      key={t}
                      onClick={() => { setTargetType(t); setSelectedUsers([]); }}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all",
                        targetType === t
                          ? "bg-[rgb(var(--brand))]/10 text-[rgb(var(--brand))] border-[rgb(var(--brand))]/30"
                          : "border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:border-[rgb(var(--text-hint))]"
                      )}
                    >
                      <Icon size={14} />
                      {TARGET_LABELS[t]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Specific user picker */}
            {targetType === "specific" && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
                  Select Users {selectedUsers.length > 0 && `(${selectedUsers.length} selected)`}
                </label>

                {/* Selected chips */}
                {selectedUsers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedUsers.map((u) => (
                      <span
                        key={u.id}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[rgb(var(--brand))]/10 text-[rgb(var(--brand))] text-xs border border-[rgb(var(--brand))]/20"
                      >
                        {u.fullName}
                        <button onClick={() => toggleUser(u)}>
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgb(var(--text-hint))]" />
                  <input
                    type="text"
                    placeholder="Search users..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="input pl-9 text-sm"
                  />
                </div>

                <div className="border border-[rgb(var(--border))] rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                  {usersLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 size={18} className="animate-spin text-[rgb(var(--brand))]" />
                    </div>
                  ) : filteredUsers.length === 0 ? (
                    <p className="text-center py-6 text-sm text-[rgb(var(--text-hint))]">No users found</p>
                  ) : (
                    filteredUsers.map((u) => {
                      const isSelected = !!selectedUsers.find((s) => s.id === u.id);
                      return (
                        <button
                          key={u.id}
                          onClick={() => toggleUser(u)}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors border-b border-[rgb(var(--border))] last:border-0",
                            isSelected
                              ? "bg-[rgb(var(--brand))]/5"
                              : "hover:bg-[rgb(var(--background))]"
                          )}
                        >
                          <div className={cn(
                            "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors",
                            isSelected ? "bg-[rgb(var(--brand))] border-[rgb(var(--brand))]" : "border-[rgb(var(--border))]"
                          )}>
                            {isSelected && <CheckCircle2 size={11} className="text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[rgb(var(--text-primary))] truncate">{u.fullName}</p>
                            <p className="text-[11px] text-[rgb(var(--text-hint))] truncate capitalize">{u.accountType} · {u.email}</p>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Title */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
                Title
              </label>
              <input
                type="text"
                placeholder="e.g. Scheduled maintenance this weekend"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={80}
                className="input w-full"
              />
              <p className="text-[10px] text-[rgb(var(--text-hint))] text-right">{title.length}/80</p>
            </div>

            {/* Body */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
                Message
              </label>
              <textarea
                placeholder="Write your announcement here..."
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                maxLength={500}
                className="input w-full resize-none"
              />
              <p className="text-[10px] text-[rgb(var(--text-hint))] text-right">{body.length}/500</p>
            </div>

            {/* Preview */}
            {title && body && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
                  Preview
                </label>
                <div className={cn("p-4 rounded-xl border", TYPE_CONFIG[type].cls)}>
                  <div className="flex items-center gap-2 mb-1">
                    {(() => { const Icon = TYPE_CONFIG[type].icon; return <Icon size={14} />; })()}
                    <p className="text-sm font-semibold">{title}</p>
                  </div>
                  <p className="text-xs opacity-80 leading-relaxed">{body}</p>
                  <p className="text-[10px] opacity-60 mt-2">
                    → {TARGET_LABELS[targetType]}
                    {targetType === "specific" && selectedUsers.length > 0 && `: ${selectedUsers.map(u => u.fullName).join(", ")}`}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-[rgb(var(--border))] flex gap-3 shrink-0">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-[rgb(var(--border))] text-sm text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[rgb(var(--brand))] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Megaphone size={14} />}
              Send Announcement
            </button>
          </div>
        </div>
      </div>
    </>
  );
}