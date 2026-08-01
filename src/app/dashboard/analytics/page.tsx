"use client";

import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  getCountFromServer,
  getAggregateFromServer,
  sum,
  onSnapshot,
  orderBy,
  limit,
  Timestamp,
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
  /// Properties + buildings whose ownership doc is awaiting admin review.
  pendingDocProperties: number;

  // Money — naira totals from `payments` (status 'completed'), by type.
  revenueRent: number;
  revenueInspection: number;
  revenueListing: number;
  revenueVerification: number;
  revenueRenewal: number;
  refundsPending: number;
  refundsPendingValue: number;

  // Funnel — interest through to a started tenancy.
  rentalInterests: number;
  inspectionsRequested: number;
  inspectionsPaid: number;
  inspectionsCompleted: number;
  rentalsStarted: number;

  // Trends — last 7 days vs the 7 before it.
  newUsers7d: number;
  newUsersPrev7d: number;
  newProperties7d: number;
  newPropertiesPrev7d: number;
  newInspections7d: number;
  newInspectionsPrev7d: number;
  revenue7d: number;
  revenuePrev7d: number;

  // Operational
  totalBuildings: number;
  moveOutsPending: number;
  cautionDepositsHeld: number;
  unknownAreaRequests: number;
  verificationsExpiringSoon: number;

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
    revenueRent: 0, revenueInspection: 0, revenueListing: 0,
    revenueVerification: 0, revenueRenewal: 0,
    refundsPending: 0, refundsPendingValue: 0,
    rentalInterests: 0, inspectionsRequested: 0, inspectionsPaid: 0,
    inspectionsCompleted: 0, rentalsStarted: 0,
    newUsers7d: 0, newUsersPrev7d: 0, newProperties7d: 0, newPropertiesPrev7d: 0,
    newInspections7d: 0, newInspectionsPrev7d: 0, revenue7d: 0, revenuePrev7d: 0,
    totalBuildings: 0, moveOutsPending: 0, cautionDepositsHeld: 0,
    unknownAreaRequests: 0, verificationsExpiringSoon: 0,
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
          verifiedPropsSnap, pendingDocPropsSnap, pendingDocBuildingsSnap,
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
          // Occupancy means a tenant is in it. `isAvailable == false` also covers
          // every listing still awaiting admin review, which is not occupancy.
          getCountFromServer(query(collection(db, "properties"), where("currentTenantsCount", ">", 0))),
          getCountFromServer(query(collection(db, "properties"), where("ownershipDocStatus", "==", "verified"))),
          getCountFromServer(query(collection(db, "properties"), where("ownershipDocStatus", "==", "pending"))),
          // A unit in a building carries 'inherited'; the doc awaiting review is
          // on the BUILDING, so property-only counts miss grouped listings.
          getCountFromServer(query(collection(db, "buildings"), where("ownershipDocStatus", "==", "pending"))),
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
          pendingDocProperties:
            pendingDocPropsSnap.data().count + pendingDocBuildingsSnap.data().count,
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

    // ── Money, funnel, trends, operational ──────────────────────────────────
    //
    // Split from fetchCounts so one failing aggregation (a missing composite
    // index, most likely) can't blank the whole dashboard.
    async function fetchDeepStats() {
      const now = Date.now();
      const day = 24 * 60 * 60 * 1000;
      const from7d = Timestamp.fromMillis(now - 7 * day);
      const from14d = Timestamp.fromMillis(now - 14 * day);
      const in30d = Timestamp.fromMillis(now + 30 * day);
      const payments = collection(db, "payments");

      // Revenue by type. Only 'completed' counts — an initiated-but-unpaid
      // charge is not money.
      const revenueOf = async (type: string) => {
        const snap = await getAggregateFromServer(
          query(payments, where("type", "==", type), where("status", "==", "completed")),
          { total: sum("amount") }
        );
        return snap.data().total || 0;
      };

      const countOf = async (q: ReturnType<typeof query>) =>
        (await getCountFromServer(q)).data().count;

      try {
        const [
          rent, inspection, listing, verification, renewal,
        ] = await Promise.all([
          revenueOf("rent"),
          revenueOf("inspection"),
          revenueOf("listing"),
          revenueOf("verification"),
          revenueOf("renewal"),
        ]);
        if (cancelled) return;
        setData((prev) => ({
          ...prev,
          revenueRent: rent,
          revenueInspection: inspection,
          revenueListing: listing,
          revenueVerification: verification,
          revenueRenewal: renewal,
        }));
      } catch (e) {
        console.error("Revenue aggregation failed:", e);
      }

      try {
        const [
          refundsPending, refundsValue,
          interests, inspRequested, inspPaid, inspCompleted, rentals,
          buildings, moveOuts, unknownAreas, expiringVerifs,
        ] = await Promise.all([
          countOf(query(collection(db, "refunds"), where("status", "==", "pending"))),
          getAggregateFromServer(
            query(collection(db, "refunds"), where("status", "==", "pending")),
            { total: sum("amount") }
          ).then((s) => s.data().total || 0),
          countOf(collection(db, "rental_interests")),
          countOf(collection(db, "inspection_requests")),
          countOf(query(collection(db, "inspection_requests"), where("paymentStatus", "==", "paid"))),
          countOf(query(collection(db, "inspection_requests"), where("status", "==", "completed"))),
          countOf(collection(db, "active_rentals")),
          countOf(collection(db, "buildings")),
          countOf(query(collection(db, "active_rentals"), where("status", "==", "moveout_pending"))),
          countOf(query(collection(db, "admin_requests"), where("status", "==", "pending"))),
          countOf(query(collection(db, "users"), where("verificationExpiresAt", "<=", in30d))),
        ]);
        if (cancelled) return;
        setData((prev) => ({
          ...prev,
          refundsPending,
          refundsPendingValue: refundsValue,
          rentalInterests: interests,
          inspectionsRequested: inspRequested,
          inspectionsPaid: inspPaid,
          inspectionsCompleted: inspCompleted,
          rentalsStarted: rentals,
          totalBuildings: buildings,
          moveOutsPending: moveOuts,
          unknownAreaRequests: unknownAreas,
          verificationsExpiringSoon: expiringVerifs,
        }));
      } catch (e) {
        console.error("Funnel/operational aggregation failed:", e);
      }

      // Caution deposits currently held across live tenancies.
      try {
        const snap = await getAggregateFromServer(
          query(collection(db, "active_rentals"), where("status", "in", ["active", "expiring_soon", "grace_locked", "moveout_pending"])),
          { total: sum("cautionDeposit") }
        );
        if (!cancelled) {
          setData((prev) => ({ ...prev, cautionDepositsHeld: snap.data().total || 0 }));
        }
      } catch (e) {
        console.error("Caution deposit aggregation failed:", e);
      }

      // Week-on-week. Each pair is [last 7 days, the 7 days before that].
      const window = async (
        col: string,
        field = "createdAt"
      ): Promise<[number, number]> => {
        const [recent, previous] = await Promise.all([
          countOf(query(collection(db, col), where(field, ">=", from7d))),
          countOf(
            query(
              collection(db, col),
              where(field, ">=", from14d),
              where(field, "<", from7d)
            )
          ),
        ]);
        return [recent, previous];
      };

      try {
        const [users, props, insps] = await Promise.all([
          window("users"),
          window("properties"),
          window("inspection_requests"),
        ]);
        const [rev7, revPrev] = await Promise.all([
          getAggregateFromServer(
            query(payments, where("status", "==", "completed"), where("createdAt", ">=", from7d)),
            { total: sum("amount") }
          ).then((s) => s.data().total || 0),
          getAggregateFromServer(
            query(payments, where("status", "==", "completed"), where("createdAt", ">=", from14d), where("createdAt", "<", from7d)),
            { total: sum("amount") }
          ).then((s) => s.data().total || 0),
        ]);
        if (cancelled) return;
        setData((prev) => ({
          ...prev,
          newUsers7d: users[0], newUsersPrev7d: users[1],
          newProperties7d: props[0], newPropertiesPrev7d: props[1],
          newInspections7d: insps[0], newInspectionsPrev7d: insps[1],
          revenue7d: rev7, revenuePrev7d: revPrev,
        }));
      } catch (e) {
        console.error("Trend aggregation failed (composite index may be missing):", e);
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
    fetchDeepStats();

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

      {/* ── This week vs last ── */}
      <Section title="Last 7 days" icon={TrendingUp}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <TrendStat label="Revenue" value={data.revenue7d} previous={data.revenuePrev7d} money loading={data.loading} />
          <TrendStat label="New Users" value={data.newUsers7d} previous={data.newUsersPrev7d} loading={data.loading} />
          <TrendStat label="New Listings" value={data.newProperties7d} previous={data.newPropertiesPrev7d} loading={data.loading} />
          <TrendStat label="Inspections" value={data.newInspections7d} previous={data.newInspectionsPrev7d} loading={data.loading} />
        </div>
      </Section>

      {/* ── Money ── */}
      <Section title="Money" icon={Wallet}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <BigStat label="Rent Collected" value={naira(data.revenueRent)} color="emerald" loading={data.loading} />
          <BigStat label="Inspection Fees" value={naira(data.revenueInspection)} color="blue" loading={data.loading} />
          <BigStat label="Listing Fees" value={naira(data.revenueListing)} color="purple" loading={data.loading} />
          <BigStat label="Verification Fees" value={naira(data.revenueVerification + data.revenueRenewal)} color="brand" loading={data.loading}
            sub="incl. renewals" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
          <BigStat label="Total Collected" value={naira(data.revenueRent + data.revenueInspection + data.revenueListing + data.revenueVerification + data.revenueRenewal)} color="emerald" loading={data.loading} />
          <BigStat label="Refunds Owed" value={naira(data.refundsPendingValue)} color="amber" loading={data.loading}
            sub={`${data.refundsPending} pending`} onClick={() => router.push("/dashboard/payments")} />
          <BigStat label="Deposits Held" value={naira(data.cautionDepositsHeld)} color="blue" loading={data.loading}
            sub="tenant caution money" />
        </div>
      </Section>

      {/* ── Funnel ── */}
      <Section title="Tenant Funnel" icon={Activity}>
        <div className="space-y-2">
          <FunnelRow label="Rental interests" value={data.rentalInterests} top={data.rentalInterests} />
          <FunnelRow label="Inspections requested" value={data.inspectionsRequested} top={data.rentalInterests} />
          <FunnelRow label="Inspections paid" value={data.inspectionsPaid} top={data.rentalInterests} />
          <FunnelRow label="Inspections completed" value={data.inspectionsCompleted} top={data.rentalInterests} />
          <FunnelRow label="Tenancies started" value={data.rentalsStarted} top={data.rentalInterests} />
        </div>
      </Section>

      {/* ── Operations ── */}
      <Section title="Operations" icon={AlertTriangle}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <BigStat label="Buildings" value={data.totalBuildings} color="brand" loading={data.loading} onClick={() => router.push("/dashboard/properties")} />
          <BigStat label="Move-outs in flight" value={data.moveOutsPending} color="amber" loading={data.loading} />
          <BigStat label="Unknown areas" value={data.unknownAreaRequests} color="blue" loading={data.loading}
            sub="landlord-reported" />
          <BigStat label="Verifications expiring" value={data.verificationsExpiringSoon} color="amber" loading={data.loading}
            sub="next 30 days" onClick={() => router.push("/dashboard/verifications")} />
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
  label: string; value: number | string; color: string; loading: boolean; sub?: string; onClick?: () => void;
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
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
      )}
      <p className="text-xs text-[rgb(var(--text-hint))] mt-1">{label}</p>
      {sub && <p className="text-[10px] text-[rgb(var(--text-hint))] mt-0.5 opacity-70">{sub}</p>}
    </div>
  );
}

// ─── Money / trend / funnel helpers ──────────────────────────────────────────

/** Compact naira. Amounts are stored in naira, not kobo. */
function naira(amount: number): string {
  if (amount >= 1_000_000) return `₦${(amount / 1_000_000).toFixed(1)}m`;
  if (amount >= 1_000) return `₦${(amount / 1_000).toFixed(0)}k`;
  return `₦${amount.toLocaleString()}`;
}

/**
 * A count for the last 7 days against the 7 before it. With no prior activity
 * there is no percentage to show — "no change" would be a lie when the previous
 * window is zero, so it shows the raw baseline instead.
 */
function TrendStat({ label, value, previous, money, loading }: {
  label: string; value: number; previous: number; money?: boolean; loading: boolean;
}) {
  const delta = value - previous;
  const pctChange = previous > 0 ? Math.round((delta / previous) * 100) : null;
  const up = delta > 0;
  const flat = delta === 0;

  return (
    <div className="card p-4">
      {loading ? (
        <div className="h-8 w-16 bg-[rgb(var(--border))] rounded animate-pulse mb-1" />
      ) : (
        <p className="text-3xl font-bold font-display text-[rgb(var(--text-primary))]">
          {money ? naira(value) : value.toLocaleString()}
        </p>
      )}
      <p className="text-xs text-[rgb(var(--text-hint))] mt-1">{label}</p>
      <p
        className={cn(
          "text-[10px] mt-0.5",
          flat
            ? "text-[rgb(var(--text-hint))]"
            : up
            ? "text-emerald-500"
            : "text-red-500"
        )}
      >
        {flat
          ? "no change"
          : pctChange === null
          ? `${up ? "+" : ""}${money ? naira(delta) : delta} vs none before`
          : `${up ? "▲" : "▼"} ${Math.abs(pctChange)}% vs previous 7 days`}
      </p>
    </div>
  );
}

/** One stage of the tenant funnel, as a share of the first stage. */
function FunnelRow({ label, value, top }: { label: string; value: number; top: number }) {
  const width = top > 0 ? Math.max((value / top) * 100, 2) : 0;
  const share = top > 0 ? Math.round((value / top) * 100) : 0;
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm text-[rgb(var(--text-secondary))]">{label}</span>
        <span className="text-sm font-semibold text-[rgb(var(--text-primary))]">
          {value.toLocaleString()}
          {top > 0 && (
            <span className="text-xs text-[rgb(var(--text-hint))] font-normal ml-1.5">
              {share}%
            </span>
          )}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[rgb(var(--border))] overflow-hidden">
        <div
          className="h-full rounded-full bg-[rgb(var(--brand))] transition-all"
          style={{ width: `${width}%` }}
        />
      </div>
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