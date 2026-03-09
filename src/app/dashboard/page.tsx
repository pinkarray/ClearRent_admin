"use client";

import { useDashboardStats, useRecentActivity } from "@/hooks/use-stats";
import { cn, formatNumber, timeAgo, capitalize } from "@/lib/utils";
import {
  Users,
  Building2,
  ShieldCheck,
  CreditCard,
  AlertTriangle,
  Home,
  UserCheck,
  UserPlus,
  Wallet,
  TrendingUp,
  ArrowRight,
  Clock,
  Loader2,
} from "lucide-react";
import { useRouter } from "next/navigation";

export default function DashboardPage() {
  const stats = useDashboardStats();
  const { activities, loading: activitiesLoading } = useRecentActivity(12);
  const router = useRouter();

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl lg:text-3xl font-display font-bold text-[rgb(var(--text-primary))]">
          Dashboard
        </h1>
        <p className="text-sm text-[rgb(var(--text-secondary))] mt-1">
          Welcome back. Here&apos;s what&apos;s happening on ClearRent.
        </p>
      </div>

      {/* Attention Needed Banner */}
      {!stats.loading && (stats.pendingVerifications > 0 || stats.openIssues > 0 || stats.pendingPayments > 0) && (
        <div className="card border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
              <AlertTriangle size={20} className="text-amber-500" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-sm text-[rgb(var(--text-primary))]">
                Items needing your attention
              </h3>
              <div className="flex flex-wrap gap-4 mt-2">
                {stats.pendingVerifications > 0 && (
                  <button
                    onClick={() => router.push("/dashboard/verifications")}
                    className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 hover:underline"
                  >
                    <ShieldCheck size={14} />
                    {stats.pendingVerifications} pending verification{stats.pendingVerifications !== 1 ? "s" : ""}
                    <ArrowRight size={12} />
                  </button>
                )}
                {stats.pendingPayments > 0 && (
                  <button
                    onClick={() => router.push("/dashboard/payments")}
                    className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 hover:underline"
                  >
                    <CreditCard size={14} />
                    {stats.pendingPayments} pending payment{stats.pendingPayments !== 1 ? "s" : ""}
                    <ArrowRight size={12} />
                  </button>
                )}
                {stats.openIssues > 0 && (
                  <button
                    onClick={() => router.push("/dashboard/issues")}
                    className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 hover:underline"
                  >
                    <AlertTriangle size={14} />
                    {stats.openIssues} open issue{stats.openIssues !== 1 ? "s" : ""}
                    <ArrowRight size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Users"
          value={stats.totalUsers}
          icon={Users}
          color="brand"
          loading={stats.loading}
          detail={`${stats.landlords}L · ${stats.tenants}T · ${stats.agents}A`}
          onClick={() => router.push("/dashboard/users")}
        />
        <StatCard
          label="Properties"
          value={stats.totalProperties}
          icon={Building2}
          color="blue"
          loading={stats.loading}
          detail={`${stats.availableProperties} available`}
          onClick={() => router.push("/dashboard/properties")}
        />
        <StatCard
          label="Pending Verifications"
          value={stats.pendingVerifications}
          icon={ShieldCheck}
          color={stats.pendingVerifications > 0 ? "amber" : "green"}
          loading={stats.loading}
          pulse={stats.pendingVerifications > 0}
          onClick={() => router.push("/dashboard/verifications")}
        />
        <StatCard
          label="Open Issues"
          value={stats.openIssues}
          icon={AlertTriangle}
          color={stats.openIssues > 0 ? "red" : "green"}
          loading={stats.loading}
          onClick={() => router.push("/dashboard/issues")}
        />
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active Rentals"
          value={stats.activeRentals}
          icon={Home}
          color="purple"
          loading={stats.loading}
        />
        <StatCard
          label="Pending Payments"
          value={stats.pendingPayments}
          icon={Wallet}
          color={stats.pendingPayments > 0 ? "amber" : "green"}
          loading={stats.loading}
          onClick={() => router.push("/dashboard/payments")}
        />
        <StatCard
          label="Landlords"
          value={stats.landlords}
          icon={UserCheck}
          color="teal"
          loading={stats.loading}
        />
        <StatCard
          label="Agents"
          value={stats.agents}
          icon={UserPlus}
          color="indigo"
          loading={stats.loading}
        />
      </div>

      {/* Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display font-semibold text-[rgb(var(--text-primary))]">
              Recent Activity
            </h2>
            <span className="text-xs text-[rgb(var(--text-hint))]">
              Live updates
            </span>
          </div>

          {activitiesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-[rgb(var(--brand))]" />
            </div>
          ) : activities.length === 0 ? (
            <div className="text-center py-12">
              <Clock size={36} className="mx-auto text-[rgb(var(--text-hint))] mb-3" />
              <p className="text-sm text-[rgb(var(--text-secondary))]">No recent activity</p>
            </div>
          ) : (
            <div className="space-y-1">
              {activities.slice(0, 8).map((activity) => (
                <ActivityItem key={activity.id} activity={activity} />
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="card">
          <h2 className="font-display font-semibold text-[rgb(var(--text-primary))] mb-5">
            Quick Actions
          </h2>
          <div className="space-y-2">
            {[
              { label: "Review Verifications", icon: ShieldCheck, href: "/dashboard/verifications", color: "text-emerald-500" },
              { label: "Verify Payments", icon: CreditCard, href: "/dashboard/payments", color: "text-blue-500" },
              { label: "Agent Payouts", icon: Wallet, href: "/dashboard/payouts", color: "text-purple-500" },
              { label: "Manage Users", icon: Users, href: "/dashboard/users", color: "text-orange-500" },
              { label: "View Issues", icon: AlertTriangle, href: "/dashboard/issues", color: "text-red-500" },
              { label: "View Analytics", icon: BarChart3, href: "/dashboard/analytics", color: "text-cyan-500" },
              { label: "Send Announcement", icon: Megaphone, href: "/dashboard/announcements", color: "text-amber-500" },
            ].map((action) => (
              <button
                key={action.href}
                onClick={() => router.push(action.href)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-[rgb(var(--background))] transition-colors group"
              >
                <div className="w-9 h-9 rounded-lg bg-[rgb(var(--background))] flex items-center justify-center group-hover:scale-105 transition-transform">
                  <action.icon size={18} className={action.color} />
                </div>
                <span className="text-sm font-medium text-[rgb(var(--text-primary))] flex-1 text-left">
                  {action.label}
                </span>
                <ArrowRight size={14} className="text-[rgb(var(--text-hint))] opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Stat Card Component ─────────────────────────────────────────────────────

const colorMap: Record<string, { bg: string; text: string; accent: string }> = {
  brand: { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", accent: "bg-emerald-500" },
  green: { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", accent: "bg-emerald-500" },
  blue: { bg: "bg-blue-500/10", text: "text-blue-600 dark:text-blue-400", accent: "bg-blue-500" },
  amber: { bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400", accent: "bg-amber-500" },
  red: { bg: "bg-red-500/10", text: "text-red-600 dark:text-red-400", accent: "bg-red-500" },
  purple: { bg: "bg-purple-500/10", text: "text-purple-600 dark:text-purple-400", accent: "bg-purple-500" },
  teal: { bg: "bg-teal-500/10", text: "text-teal-600 dark:text-teal-400", accent: "bg-teal-500" },
  indigo: { bg: "bg-indigo-500/10", text: "text-indigo-600 dark:text-indigo-400", accent: "bg-indigo-500" },
};

function StatCard({
  label,
  value,
  icon: Icon,
  color = "brand",
  loading,
  detail,
  pulse,
  onClick,
}: {
  label: string;
  value: number;
  icon: any;
  color?: string;
  loading?: boolean;
  detail?: string;
  pulse?: boolean;
  onClick?: () => void;
}) {
  const c = colorMap[color] || colorMap.brand;

  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "stat-card text-left group",
        onClick && "hover:border-[rgb(var(--brand))]/30 hover:shadow-md transition-all cursor-pointer"
      )}
    >
      {/* Accent bar */}
      <div className={cn("absolute top-0 left-0 w-1 h-full rounded-l-2xl", c.accent)} />

      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[rgb(var(--text-secondary))] uppercase tracking-wider">
            {label}
          </p>
          {loading ? (
            <div className="mt-2 h-8 w-16 rounded-lg bg-[rgb(var(--background))] animate-pulse" />
          ) : (
            <p className="mt-1 text-2xl lg:text-3xl font-display font-bold text-[rgb(var(--text-primary))]">
              {formatNumber(value)}
            </p>
          )}
          {detail && !loading && (
            <p className="mt-1 text-xs text-[rgb(var(--text-hint))]">{detail}</p>
          )}
        </div>
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", c.bg, "relative")}>
          <Icon size={20} className={c.text} />
          {pulse && (
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-500 animate-pulse" />
          )}
        </div>
      </div>
    </button>
  );
}

// ── Activity Item Component ─────────────────────────────────────────────────

import { RecentActivity } from "@/hooks/use-stats";
import { BarChart3, Megaphone } from "lucide-react";

const activityIcons: Record<string, any> = {
  verification: ShieldCheck,
  payment: CreditCard,
  issue: AlertTriangle,
  signup: UserPlus,
  rental: Home,
};

const activityColors: Record<string, string> = {
  verification: "text-emerald-500 bg-emerald-500/10",
  payment: "text-blue-500 bg-blue-500/10",
  issue: "text-red-500 bg-red-500/10",
  signup: "text-purple-500 bg-purple-500/10",
  rental: "text-teal-500 bg-teal-500/10",
};

function ActivityItem({ activity }: { activity: RecentActivity }) {
  const Icon = activityIcons[activity.type] || Clock;
  const colorClass = activityColors[activity.type] || "text-gray-500 bg-gray-500/10";
  const [iconBg, iconText] = colorClass.split(" ");

  return (
    <div className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-[rgb(var(--background))] transition-colors">
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", colorClass)}>
        <Icon size={15} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[rgb(var(--text-primary))] truncate">
          {activity.title}
        </p>
        <p className="text-xs text-[rgb(var(--text-hint))] truncate">
          {activity.subtitle}
        </p>
      </div>
      <span className="text-[11px] text-[rgb(var(--text-hint))] whitespace-nowrap shrink-0">
        {timeAgo(activity.timestamp)}
      </span>
    </div>
  );
}
