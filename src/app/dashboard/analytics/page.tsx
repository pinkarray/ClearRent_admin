"use client";

import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  getCountFromServer,
  onSnapshot,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { parseTimestamp } from "@/types";
import { cn } from "@/lib/utils";
import {
  Users,
  Building2,
  ShieldCheck,
  Home,
  AlertTriangle,
  TrendingUp,
  Loader2,
  UserCheck,
  UserPlus,
  Wallet,
  BarChart2,
  PieChart,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnalyticsData {
  // Users
  totalUsers: number;
  landlords: number;
  tenants: number;
  agents: number;
  verifiedUsers: number;
  pendingVerifications: number;
  rejectedVerifications: number;

  // Properties
  totalProperties: number;
  availableProperties: number;
  occupiedProperties: number;
  verifiedProperties: number;
  pendingDocProperties: number;

  // Rentals & Inspections
  activeRentals: number;
  completedInspections: number;
  pendingInspections: number;

  // Payments
  pendingPayments: number;
  confirmedInspectionPayments: number;
  pendingAgentPayouts: number;

  // Issues
  openIssues: number;
  inProgressIssues: number;
  resolvedIssues: number;
  highPriorityIssues: number;

  // Property types
  propertyTypeBreakdown: Record<string, number>;

  // Issue categories
  issueCategoryBreakdown: Record<string, number>;

  loading: boolean;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData>({
    totalUsers: 0, landlords: 0, tenants: 0, agents: 0,
    verifiedUsers: 0, pendingVerifications: 0, rejectedVerifications: 0,
    totalProperties: 0, availableProperties: 0, occupiedProperties: 0,
    verifiedProperties: 0, pendingDocProperties: 0,
    activeRentals: 0, completedInspections: 0, pendingInspections: 0,
    pendingPayments: 0, confirmedInspectionPayments: 0, pendingAgentPayouts: 0,
    openIssues: 0, inProgressIssues: 0, resolvedIssues: 0, highPriorityIssues: 0,
    propertyTypeBreakdown: {}, issueCategoryBreakdown: {},
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchCounts() {
      try {
        const [
          totalUsersSnap, landlordsSnap, tenantsSnap, agentsSnap,
          verifiedUsersSnap, pendingVerifSnap, rejectedVerifSnap,
          totalPropsSnap, availPropsSnap, occupiedPropsSnap,
          verifiedPropsSnap, pendingDocPropsSnap,
          activeRentalsSnap, completedInspSnap, pendingInspSnap,
          pendingPaySnap, confirmedInspPaySnap, pendingPayoutsSnap,
          openIssuesSnap, inProgressIssuesSnap, resolvedIssuesSnap, highPrioritySnap,
        ] = await Promise.all([
          getCountFromServer(collection(db, "users")),
          getCountFromServer(query(collection(db, "users"), where("accountType", "==", "landlord"))),
          getCountFromServer(query(collection(db, "users"), where("accountType", "==", "tenant"))),
          getCountFromServer(query(collection(db, "users"), where("accountType", "==", "agent"))),
          getCountFromServer(query(collection(db, "users"), where("verificationStatus", "==", "verified"))),
          getCountFromServer(query(collection(db, "users"), where("verificationStatus", "==", "pending"))),
          getCountFromServer(query(collection(db, "users"), where("verificationStatus", "==", "rejected"))),
          getCountFromServer(collection(db, "properties")),
          getCountFromServer(query(collection(db, "properties"), where("isAvailable", "==", true))),
          getCountFromServer(query(collection(db, "properties"), where("isAvailable", "==", false))),
          getCountFromServer(query(collection(db, "properties"), where("ownershipDocStatus", "==", "verified"))),
          getCountFromServer(query(collection(db, "properties"), where("ownershipDocStatus", "==", "pending"))),
          getCountFromServer(query(collection(db, "active_rentals"), where("status", "==", "active"))),
          getCountFromServer(query(collection(db, "inspection_requests"), where("status", "==", "completed"))),
          getCountFromServer(query(collection(db, "inspection_requests"), where("status", "in", ["pending", "approved"]))),
          getCountFromServer(query(collection(db, "inspection_requests"), where("paymentStatus", "==", "pending_verification"))),
          getCountFromServer(query(collection(db, "inspection_requests"), where("paymentStatus", "==", "paid"))),
          getCountFromServer(query(collection(db, "inspection_requests"), where("agentPayoutStatus", "==", "pending"), where("status", "==", "completed"))),
          getCountFromServer(query(collection(db, "issues"), where("status", "==", "open"))),
          getCountFromServer(query(collection(db, "issues"), where("status", "==", "in_progress"))),
          getCountFromServer(query(collection(db, "issues"), where("status", "==", "resolved"))),
          getCountFromServer(query(collection(db, "issues"), where("priority", "==", "high"), where("status", "==", "open"))),
        ]);

        if (cancelled) return;

        setData((prev) => ({
          ...prev,
          totalUsers: totalUsersSnap.data().count,
          landlords: landlordsSnap.data().count,
          tenants: tenantsSnap.data().count,
          agents: agentsSnap.data().count,
          verifiedUsers: verifiedUsersSnap.data().count,
          pendingVerifications: pendingVerifSnap.data().count,
          rejectedVerifications: rejectedVerifSnap.data().count,
          totalProperties: totalPropsSnap.data().count,
          availableProperties: availPropsSnap.data().count,
          occupiedProperties: occupiedPropsSnap.data().count,
          verifiedProperties: verifiedPropsSnap.data().count,
          pendingDocProperties: pendingDocPropsSnap.data().count,
          activeRentals: activeRentalsSnap.data().count,
          completedInspections: completedInspSnap.data().count,
          pendingInspections: pendingInspSnap.data().count,
          pendingPayments: pendingPaySnap.data().count,
          confirmedInspectionPayments: confirmedInspPaySnap.data().count,
          pendingAgentPayouts: pendingPayoutsSnap.data().count,
          openIssues: openIssuesSnap.data().count,
          inProgressIssues: inProgressIssuesSnap.data().count,
          resolvedIssues: resolvedIssuesSnap.data().count,
          highPriorityIssues: highPrioritySnap.data().count,
        }));
      } catch (e) {
        console.error("Analytics fetch error:", e);
      }
    }

    // Property type breakdown — live listener on small sample
    const propUnsub = onSnapshot(
      query(collection(db, "properties"), orderBy("createdAt", "desc")),
      (snap) => {
        if (cancelled) return;
        const breakdown: Record<string, number> = {};
        snap.docs.forEach((d) => {
          const t = d.data().propertyType || "other";
          breakdown[t] = (breakdown[t] || 0) + 1;
        });
        setData((prev) => ({ ...prev, propertyTypeBreakdown: breakdown }));
      }
    );

    // Issue category breakdown
    const issueUnsub = onSnapshot(
      collection(db, "issues"),
      (snap) => {
        if (cancelled) return;
        const breakdown: Record<string, number> = {};
        snap.docs.forEach((d) => {
          const c = d.data().category || "other";
          breakdown[c] = (breakdown[c] || 0) + 1;
        });
        setData((prev) => ({ ...prev, issueCategoryBreakdown: breakdown, loading: false }));
      }
    );

    fetchCounts();

    return () => {
      cancelled = true;
      propUnsub();
      issueUnsub();
    };
  }, []);

  const router = useRouter();
  const pct = (n: number, total: number) =>
    total === 0 ? 0 : Math.round((n / total) * 100);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-[rgb(var(--text-primary))]">
            Analytics
          </h1>
          <p className="text-sm text-[rgb(var(--text-secondary))] mt-1">
            Platform snapshot — live counts across all collections.
          </p>
        </div>
        {data.loading && (
          <Loader2 size={18} className="animate-spin text-[rgb(var(--text-hint))]" />
        )}
      </div>

      {/* ── Users ── */}
      <Section title="Users" icon={Users}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <BigStat label="Total Users" value={data.totalUsers} color="brand" loading={data.loading} onClick={() => router.push("/dashboard/users")} />
          <BigStat label="Landlords" value={data.landlords} color="emerald" loading={data.loading}
            sub={`${pct(data.landlords, data.totalUsers)}% of users`} onClick={() => router.push("/dashboard/users")} />
          <BigStat label="Tenants" value={data.tenants} color="blue" loading={data.loading}
            sub={`${pct(data.tenants, data.totalUsers)}% of users`} onClick={() => router.push("/dashboard/users")} />
          <BigStat label="Agents" value={data.agents} color="purple" loading={data.loading}
            sub={`${pct(data.agents, data.totalUsers)}% of users`} onClick={() => router.push("/dashboard/users")} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
          <RatioCard
            label="Verification Rate"
            numerator={data.verifiedUsers}
            denominator={data.totalUsers}
            color="emerald"
            icon={ShieldCheck}
            loading={data.loading}
          />
          <RatioCard
            label="Pending Verifications"
            numerator={data.pendingVerifications}
            denominator={data.totalUsers}
            color="amber"
            icon={Clock}
            loading={data.loading}
          />
          <RatioCard
            label="Rejected Verifications"
            numerator={data.rejectedVerifications}
            denominator={data.totalUsers}
            color="red"
            icon={XCircle}
            loading={data.loading}
          />
        </div>
      </Section>

      {/* ── Properties ── */}
      <Section title="Properties" icon={Building2}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <BigStat label="Total Properties" value={data.totalProperties} color="brand" loading={data.loading} onClick={() => router.push("/dashboard/properties")} />
          <BigStat label="Available" value={data.availableProperties} color="emerald" loading={data.loading}
            sub={`${pct(data.availableProperties, data.totalProperties)}% available`} onClick={() => router.push("/dashboard/properties")} />
          <BigStat label="Occupied" value={data.occupiedProperties} color="blue" loading={data.loading}
            sub={`${pct(data.occupiedProperties, data.totalProperties)}% occupied`} onClick={() => router.push("/dashboard/properties")} />
          <BigStat label="Active Rentals" value={data.activeRentals} color="purple" loading={data.loading} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <RatioCard
            label="Docs Verified"
            numerator={data.verifiedProperties}
            denominator={data.totalProperties}
            color="emerald"
            icon={CheckCircle2}
            loading={data.loading}
          />
          <RatioCard
            label="Docs Pending Review"
            numerator={data.pendingDocProperties}
            denominator={data.totalProperties}
            color="amber"
            icon={Clock}
            loading={data.loading}
          />
        </div>

        {/* Property type breakdown */}
        {Object.keys(data.propertyTypeBreakdown).length > 0 && (
          <BreakdownBar
            title="Property Types"
            data={data.propertyTypeBreakdown}
            total={data.totalProperties}
            colorMap={{
              flat: "bg-blue-500",
              duplex: "bg-purple-500",
              selfContain: "bg-emerald-500",
              bungalow: "bg-orange-500",
              room: "bg-yellow-500",
              shop: "bg-pink-500",
              office: "bg-teal-500",
              other: "bg-[rgb(var(--text-hint))]",
            }}
            labelMap={{
              selfContain: "Self Contain",
              bungalow: "Bungalow",
            }}
          />
        )}
      </Section>

      {/* ── Inspections & Payments ── */}
      <Section title="Inspections & Payments" icon={Activity}>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <BigStat label="Completed Inspections" value={data.completedInspections} color="emerald" loading={data.loading} />
          <BigStat label="Active Inspections" value={data.pendingInspections} color="amber" loading={data.loading} />
          <BigStat label="Pending Payments" value={data.pendingPayments} color={data.pendingPayments > 0 ? "red" : "emerald"} loading={data.loading} onClick={() => router.push("/dashboard/payments")} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <RatioCard
            label="Payments Confirmed"
            numerator={data.confirmedInspectionPayments}
            denominator={data.confirmedInspectionPayments + data.pendingPayments}
            color="emerald"
            icon={CheckCircle2}
            loading={data.loading}
          />
          <RatioCard
            label="Agent Payouts Pending"
            numerator={data.pendingAgentPayouts}
            denominator={data.completedInspections}
            color={data.pendingAgentPayouts > 0 ? "amber" : "emerald"}
            icon={Wallet}
            loading={data.loading}
          />
        </div>
      </Section>

      {/* ── Issues ── */}
      <Section title="Issues" icon={AlertTriangle}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <BigStat label="Open" value={data.openIssues} color={data.openIssues > 0 ? "red" : "emerald"} loading={data.loading} onClick={() => router.push("/dashboard/issues")} />
          <BigStat label="In Progress" value={data.inProgressIssues} color="amber" loading={data.loading} onClick={() => router.push("/dashboard/issues")} />
          <BigStat label="Resolved" value={data.resolvedIssues} color="emerald" loading={data.loading} onClick={() => router.push("/dashboard/issues")} />
          <BigStat label="High Priority Open" value={data.highPriorityIssues} color={data.highPriorityIssues > 0 ? "red" : "emerald"} loading={data.loading} onClick={() => router.push("/dashboard/issues")} />
        </div>

        {Object.keys(data.issueCategoryBreakdown).length > 0 && (
          <BreakdownBar
            title="Issue Categories"
            data={data.issueCategoryBreakdown}
            total={Object.values(data.issueCategoryBreakdown).reduce((a, b) => a + b, 0)}
            colorMap={{
              plumbing: "bg-blue-500",
              electrical: "bg-yellow-500",
              structural: "bg-stone-500",
              appliance: "bg-purple-500",
              pest: "bg-orange-500",
              security: "bg-red-500",
              cleaning: "bg-teal-500",
              other: "bg-[rgb(var(--text-hint))]",
            }}
            labelMap={{}}
          />
        )}
      </Section>
    </div>
  );
}

// ─── Section Wrapper ──────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-[rgb(var(--brand))]/10 flex items-center justify-center">
          <Icon size={15} className="text-[rgb(var(--brand))]" />
        </div>
        <h2 className="font-display font-semibold text-[rgb(var(--text-primary))]">{title}</h2>
      </div>
      {children}
    </div>
  );
}

// ─── Big Stat Card ────────────────────────────────────────────────────────────

const COLOR_MAP: Record<string, string> = {
  brand:   "text-[rgb(var(--brand))]",
  emerald: "text-emerald-500",
  blue:    "text-blue-500",
  purple:  "text-purple-500",
  amber:   "text-amber-500",
  red:     "text-red-500",
  teal:    "text-teal-500",
};

function BigStat({ label, value, color, loading, sub, onClick }: {
  label: string; value: number; color: string; loading: boolean; sub?: string; onClick?: () => void;
}) {
  return (
    <div
      className={cn("card p-4", onClick && "cursor-pointer hover:scale-[1.02] transition-transform")}
      onClick={onClick}
    >
      {loading ? (
        <div className="h-8 w-16 bg-[rgb(var(--border))] rounded animate-pulse mb-1" />
      ) : (
        <p className={cn("text-3xl font-bold font-display", COLOR_MAP[color] || COLOR_MAP.brand)}>
          {value.toLocaleString()}
        </p>
      )}
      <p className="text-xs text-[rgb(var(--text-hint))] mt-1">{label}</p>
      {sub && <p className="text-[10px] text-[rgb(var(--text-hint))] mt-0.5 opacity-70">{sub}</p>}
    </div>
  );
}

// ─── Ratio Card ───────────────────────────────────────────────────────────────

function RatioCard({ label, numerator, denominator, color, icon: Icon, loading }: {
  label: string; numerator: number; denominator: number;
  color: string; icon: any; loading: boolean;
}) {
  const pct = denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
  const barColor: Record<string, string> = {
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
    blue: "bg-blue-500",
    purple: "bg-purple-500",
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={15} className={cn(COLOR_MAP[color])} />
          <p className="text-sm font-medium text-[rgb(var(--text-primary))]">{label}</p>
        </div>
        {loading ? (
          <div className="h-4 w-12 bg-[rgb(var(--border))] rounded animate-pulse" />
        ) : (
          <span className={cn("text-sm font-bold", COLOR_MAP[color])}>
            {numerator.toLocaleString()} <span className="text-[rgb(var(--text-hint))] font-normal text-xs">/ {denominator.toLocaleString()}</span>
          </span>
        )}
      </div>
      <div className="h-2 rounded-full bg-[rgb(var(--border))] overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-700", barColor[color] || "bg-[rgb(var(--brand))]")}
          style={{ width: loading ? "0%" : `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-[rgb(var(--text-hint))]">{loading ? "—" : `${pct}%`}</p>
    </div>
  );
}

// ─── Breakdown Bar ────────────────────────────────────────────────────────────

function BreakdownBar({ title, data, total, colorMap, labelMap }: {
  title: string;
  data: Record<string, number>;
  total: number;
  colorMap: Record<string, string>;
  labelMap: Record<string, string>;
}) {
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);

  return (
    <div className="card p-4 space-y-4">
      <p className="text-sm font-medium text-[rgb(var(--text-primary))]">{title}</p>
      {/* Stacked bar */}
      <div className="h-3 rounded-full overflow-hidden flex gap-0.5">
        {sorted.map(([key, count]) => (
          <div
            key={key}
            className={cn("h-full transition-all", colorMap[key] || "bg-[rgb(var(--text-hint))]")}
            style={{ width: `${(count / total) * 100}%` }}
            title={`${labelMap[key] || key}: ${count}`}
          />
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {sorted.map(([key, count]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={cn("w-2.5 h-2.5 rounded-sm", colorMap[key] || "bg-[rgb(var(--text-hint))]")} />
            <span className="text-xs text-[rgb(var(--text-secondary))] capitalize">
              {labelMap[key] || key}
            </span>
            <span className="text-xs text-[rgb(var(--text-hint))]">
              {count} ({Math.round((count / total) * 100)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}