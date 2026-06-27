"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { ClearRentUser, parseTimestamp } from "@/types";
import { cn, capitalize, timeAgo } from "@/lib/utils";
import { Search, Users, ShieldCheck, ShieldAlert, ShieldOff, Clock, MoreVertical, Mail, Phone, MapPin, Star, Building2, Loader2, X, AlertTriangle } from "lucide-react";

type FilterType = "all" | "landlord" | "tenant" | "agent";
type StatusFilter = "all" | "verified" | "pending" | "rejected" | "none";

export default function UsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<ClearRentUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<FilterType>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedUser, setSelectedUser] = useState<ClearRentUser | null>(null);

  useEffect(() => {
    const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const parsed: ClearRentUser[] = snap.docs.filter((d) => d.id !== user?.uid).map((d) => {
        const data = d.data();
        return { id: d.id, uid: data.uid || d.id, fullName: data.fullName || "Unknown", fullNameLower: data.fullNameLower, email: data.email || "", phone: data.phone || "", accountType: data.accountType || "tenant", profileCompleted: data.profileCompleted || false, emailVerified: data.emailVerified || false, profileImageUrl: data.profileImageUrl, verificationStatus: data.verificationStatus || "none", isVerified: data.isVerified || false, verificationSubmittedAt: parseTimestamp(data.verificationSubmittedAt), verificationReviewedAt: parseTimestamp(data.verificationReviewedAt), rejectionReason: data.rejectionReason, baseLocation: data.baseLocation, serviceAreas: data.serviceAreas, rating: data.rating, totalInspections: data.totalInspections, totalRatings: data.totalRatings, allowsCalls: data.allowsCalls, createdAt: parseTimestamp(data.createdAt), updatedAt: parseTimestamp(data.updatedAt) };
      });
      setUsers(parsed);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (typeFilter !== "all" && u.accountType !== typeFilter) return false;
      if (statusFilter !== "all" && u.verificationStatus !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.phone && u.phone.includes(q));
      }
      return true;
    });
  }, [users, typeFilter, statusFilter, searchQuery]);

  const totalCount = users.length;
  const landlordCount = users.filter((u) => u.accountType === "landlord").length;
  const tenantCount = users.filter((u) => u.accountType === "tenant").length;
  const agentCount = users.filter((u) => u.accountType === "agent").length;
  const verifiedCount = users.filter((u) => u.verificationStatus === "verified").length;
  const pendingCount = users.filter((u) => u.verificationStatus === "pending").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-[rgb(var(--text-primary))]">Users</h1>
          <p className="text-sm text-[rgb(var(--text-secondary))] mt-1">{totalCount} total · {verifiedCount} verified · {pendingCount} pending</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {([["All", totalCount, "all"], ["Landlords", landlordCount, "landlord"], ["Tenants", tenantCount, "tenant"], ["Agents", agentCount, "agent"]] as [string, number, FilterType][]).map(([label, value, filter]) => (
          <button key={filter} onClick={() => setTypeFilter(filter)} className={cn("px-4 py-2 rounded-xl text-sm font-medium transition-all", typeFilter === filter ? "bg-[rgb(var(--brand))]/10 text-[rgb(var(--brand))] border border-[rgb(var(--brand))]/30" : "bg-[rgb(var(--surface))] text-[rgb(var(--text-secondary))] border border-[rgb(var(--border))] hover:border-[rgb(var(--text-hint))]")}>
            {label}<span className="ml-2 text-xs opacity-70">{value}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[rgb(var(--text-hint))]" />
          <input type="text" placeholder="Search by name, email, or phone..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="input pl-10" />
          {searchQuery && <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgb(var(--text-hint))] hover:text-[rgb(var(--text-secondary))]"><X size={14} /></button>}
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="input w-auto min-w-[180px] cursor-pointer">
          <option value="all">All Statuses</option>
          <option value="verified">Verified</option>
          <option value="pending">Pending</option>
          <option value="rejected">Rejected</option>
          <option value="none">Unverified</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-[rgb(var(--brand))]" /></div>
      ) : filteredUsers.length === 0 ? (
        <div className="card text-center py-16">
          <Users size={40} className="mx-auto text-[rgb(var(--text-hint))] mb-4" />
          <p className="text-[rgb(var(--text-secondary))] font-medium">No users found</p>
          <p className="text-sm text-[rgb(var(--text-hint))] mt-1">{searchQuery ? "Try a different search term" : "Adjust your filters"}</p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-[rgb(var(--border))]">
                <th className="text-left text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider px-5 py-3">User</th>
                <th className="text-left text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider px-5 py-3">Type</th>
                <th className="text-left text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider px-5 py-3">Status</th>
                <th className="text-left text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider px-5 py-3">Phone</th>
                <th className="text-left text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider px-5 py-3">Joined</th>
                <th className="w-12"></th>
              </tr></thead>
              <tbody>{filteredUsers.map((user) => (
                <tr key={user.id} onClick={() => setSelectedUser(user)} className="border-b border-[rgb(var(--border))]/50 hover:bg-[rgb(var(--background))] cursor-pointer transition-colors">
                  <td className="px-5 py-4"><div className="flex items-center gap-3"><UserAvatar user={user} size={36} /><div><p className="text-sm font-medium text-[rgb(var(--text-primary))]">{user.fullName}</p><p className="text-xs text-[rgb(var(--text-hint))]">{user.email}</p></div></div></td>
                  <td className="px-5 py-4"><TypeBadge type={user.accountType} /></td>
                  <td className="px-5 py-4"><StatusBadge status={user.verificationStatus || "none"} /></td>
                  <td className="px-5 py-4 text-sm text-[rgb(var(--text-secondary))]">{user.phone || "—"}</td>
                  <td className="px-5 py-4 text-sm text-[rgb(var(--text-hint))]">{user.createdAt ? timeAgo(user.createdAt) : "—"}</td>
                  <td className="px-3"><MoreVertical size={16} className="text-[rgb(var(--text-hint))]" /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="lg:hidden divide-y divide-[rgb(var(--border))]/50">
            {filteredUsers.map((user) => (
              <button key={user.id} onClick={() => setSelectedUser(user)} className="w-full text-left px-4 py-4 hover:bg-[rgb(var(--background))] transition-colors">
                <div className="flex items-center gap-3"><UserAvatar user={user} size={40} /><div className="flex-1 min-w-0"><div className="flex items-center gap-2"><p className="text-sm font-medium text-[rgb(var(--text-primary))] truncate">{user.fullName}</p><TypeBadge type={user.accountType} /></div><p className="text-xs text-[rgb(var(--text-hint))] truncate">{user.email}</p></div><StatusBadge status={user.verificationStatus || "none"} /></div>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedUser && <UserDetailPanel user={selectedUser} onClose={() => setSelectedUser(null)} />}
    </div>
  );
}

function UserAvatar({ user, size = 36 }: { user: ClearRentUser; size?: number }) {
  const initials = user.fullName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  const colors: Record<string, string> = { landlord: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", tenant: "bg-blue-500/10 text-blue-600 dark:text-blue-400", agent: "bg-purple-500/10 text-purple-600 dark:text-purple-400" };
  if (user.profileImageUrl) return <img src={user.profileImageUrl} alt={user.fullName} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
  return <div className={cn("rounded-full flex items-center justify-center font-semibold shrink-0", colors[user.accountType] || colors.tenant)} style={{ width: size, height: size, fontSize: size * 0.35 }}>{initials || "?"}</div>;
}

function TypeBadge({ type }: { type: string }) {
  const c: Record<string, string> = { landlord: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", tenant: "bg-blue-500/10 text-blue-600 dark:text-blue-400", agent: "bg-purple-500/10 text-purple-600 dark:text-purple-400" };
  return <span className={cn("badge", c[type] || c.tenant)}>{capitalize(type)}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const c: Record<string, { cls: string; icon: any; label: string }> = { verified: { cls: "badge-success", icon: ShieldCheck, label: "Verified" }, pending: { cls: "badge-warning", icon: Clock, label: "Pending" }, rejected: { cls: "badge-error", icon: ShieldOff, label: "Rejected" }, none: { cls: "badge-neutral", icon: ShieldAlert, label: "Unverified" } };
  const cfg = c[status] || c.none;
  return <span className={cn(cfg.cls, "gap-1")}><cfg.icon size={11} />{cfg.label}</span>;
}

function UserDetailPanel({ user, onClose }: { user: ClearRentUser; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-full max-w-md z-50 bg-[rgb(var(--surface))] border-l border-[rgb(var(--border))] shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-[rgb(var(--surface))] border-b border-[rgb(var(--border))] px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-display font-semibold text-[rgb(var(--text-primary))]">User Details</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[rgb(var(--background))] transition-colors"><X size={18} className="text-[rgb(var(--text-secondary))]" /></button>
        </div>
        <div className="p-6 space-y-6">
          <div className="flex items-center gap-4">
            <UserAvatar user={user} size={56} />
            <div><h3 className="text-lg font-semibold text-[rgb(var(--text-primary))]">{user.fullName}</h3><div className="flex items-center gap-2 mt-1"><TypeBadge type={user.accountType} /><StatusBadge status={user.verificationStatus || "none"} /></div></div>
          </div>
          <div className="space-y-3">
            <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">Contact</h4>
            <DetailRow icon={Mail} label="Email" value={user.email} />
            <DetailRow icon={Phone} label="Phone" value={user.phone || "Not provided"} />
            {user.baseLocation && <DetailRow icon={MapPin} label="Location" value={user.baseLocation} />}
          </div>
          <div className="space-y-3">
            <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">Account</h4>
            <DetailRow icon={Users} label="Account Type" value={capitalize(user.accountType)} />
            <DetailRow icon={Clock} label="Joined" value={user.createdAt ? user.createdAt.toLocaleDateString("en-NG", { year: "numeric", month: "long", day: "numeric" }) : "Unknown"} />
            <DetailRow icon={ShieldCheck} label="Verification" value={capitalize(user.verificationStatus || "none")} />
          </div>
          {user.accountType === "agent" && (
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">Agent Details</h4>
              {user.rating !== undefined && <DetailRow icon={Star} label="Rating" value={`${user.rating?.toFixed(1)} / 5.0`} />}
              <DetailRow icon={Building2} label="Inspections" value={`${user.totalInspections || 0}`} />
              {user.serviceAreas && user.serviceAreas.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{user.serviceAreas.map((area) => <span key={area} className="badge-neutral text-[10px]">{area}</span>)}</div>}
            </div>
          )}
          {user.verificationStatus === "rejected" && user.rejectionReason && (
            <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/20">
              <div className="flex items-center gap-2 mb-2"><AlertTriangle size={14} className="text-red-500" /><span className="text-xs font-semibold text-red-500">Rejection Reason</span></div>
              <p className="text-sm text-[rgb(var(--text-secondary))]">{user.rejectionReason}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-[rgb(var(--background))] flex items-center justify-center shrink-0"><Icon size={14} className="text-[rgb(var(--text-hint))]" /></div>
      <div className="flex-1 min-w-0"><p className="text-[11px] text-[rgb(var(--text-hint))]">{label}</p><p className="text-sm text-[rgb(var(--text-primary))] truncate">{value}</p></div>
    </div>
  );
}
