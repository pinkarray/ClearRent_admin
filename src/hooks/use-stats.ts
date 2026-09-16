"use client";

import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  getCountFromServer,
  orderBy,
  limit,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AdminAlert, isRoutineInfo } from "@/lib/alerts";

export interface DashboardStats {
  totalUsers: number;
  landlords: number;
  tenants: number;
  agents: number;
  totalProperties: number;
  availableProperties: number;
  pendingVerifications: number;
  pendingPayments: number;
  openIssues: number;
  activeRentals: number;
  totalRevenue: number;
  loading: boolean;
}

export function useDashboardStats(): DashboardStats {
  const [stats, setStats] = useState<DashboardStats>({
    totalUsers: 0,
    landlords: 0,
    tenants: 0,
    agents: 0,
    totalProperties: 0,
    availableProperties: 0,
    pendingVerifications: 0,
    pendingPayments: 0,
    openIssues: 0,
    activeRentals: 0,
    totalRevenue: 0,
    loading: true,
  });

  useEffect(() => {
    let isMounted = true;

    async function fetchCounts() {
      try {
        const usersRef = collection(db, "users");
        const propertiesRef = collection(db, "properties");
        const issuesRef = collection(db, "issues");
        const rentalsRef = collection(db, "active_rentals");

        // Parallel count queries
        const [
          totalUsersSnap,
          landlordsSnap,
          tenantsSnap,
          agentsSnap,
          totalPropsSnap,
          availablePropsSnap,
          pendingVeriSnap,
          pendingPaySnap,
          openIssuesSnap,
          activeRentalsSnap,
        ] = await Promise.all([
          getCountFromServer(usersRef),
          getCountFromServer(query(usersRef, where("accountType", "==", "landlord"))),
          getCountFromServer(query(usersRef, where("accountType", "==", "tenant"))),
          getCountFromServer(query(usersRef, where("accountType", "==", "agent"))),
          getCountFromServer(propertiesRef),
          getCountFromServer(query(propertiesRef, where("isAvailable", "==", true))),
          getCountFromServer(
            query(usersRef, where("verificationStatus", "==", "pending"))
          ),
          getCountFromServer(
            query(usersRef, where("paymentStatus", "==", "pending_verification"))
          ),
          getCountFromServer(query(issuesRef, where("status", "==", "open"))),
          getCountFromServer(rentalsRef),
        ]);

        if (isMounted) {
          setStats({
            totalUsers: totalUsersSnap.data().count,
            landlords: landlordsSnap.data().count,
            tenants: tenantsSnap.data().count,
            agents: agentsSnap.data().count,
            totalProperties: totalPropsSnap.data().count,
            availableProperties: availablePropsSnap.data().count,
            pendingVerifications: pendingVeriSnap.data().count,
            pendingPayments: pendingPaySnap.data().count,
            openIssues: openIssuesSnap.data().count,
            activeRentals: activeRentalsSnap.data().count,
            totalRevenue: 0, // computed from payments collection below
            loading: false,
          });
        }
      } catch (err) {
        console.error("Error fetching dashboard stats:", err);
        if (isMounted) setStats((prev) => ({ ...prev, loading: false }));
      }
    }

    fetchCounts();

    // Live listener for pending verifications (updates badge in real-time)
    const pendingQuery = query(
      collection(db, "users"),
      where("verificationStatus", "==", "pending")
    );
    const unsubPending = onSnapshot(pendingQuery, (snap) => {
      if (isMounted) {
        setStats((prev) => ({ ...prev, pendingVerifications: snap.size }));
      }
    });

    // Live listener for open issues
    const issuesQuery = query(
      collection(db, "issues"),
      where("status", "==", "open")
    );
    const unsubIssues = onSnapshot(issuesQuery, (snap) => {
      if (isMounted) {
        setStats((prev) => ({ ...prev, openIssues: snap.size }));
      }
    });

    return () => {
      isMounted = false;
      unsubPending();
      unsubIssues();
    };
  }, []);

  return stats;
}

// ── Recent Activity ─────────────────────────────────────────────────────────

// The admin_alerts feed, newest first, open or closed. Every producer that has
// something to tell an admin (listings, payments, disputes, sign-ups, home
// bills) writes there, so it is the platform's activity log. Reading the users
// collection showed sign-ups and nothing else.
export interface RecentActivity {
  id: string;
  severity: AdminAlert["severity"];
  title: string;
  subtitle: string;
  timestamp: Date;
  /** Still open and not routine info: the same test as the attention banner. */
  needsAction: boolean;
}

export function useRecentActivity(count = 15): {
  activities: RecentActivity[];
  loading: boolean;
} {
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, "admin_alerts"),
      orderBy("createdAt", "desc"),
      limit(count)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setActivities(
          snap.docs.map((d) => {
            const x = d.data();
            const alert = {
              id: d.id,
              type: (x.type as string) ?? "unknown",
              severity: (x.severity as AdminAlert["severity"]) ?? "info",
              title: (x.title as string) ?? "Alert",
              body: (x.body as string) ?? "",
              meta: x.meta as AdminAlert["meta"],
              createdAt: x.createdAt instanceof Timestamp ? x.createdAt.toDate() : null,
            } as AdminAlert;
            return {
              id: alert.id,
              severity: alert.severity,
              title: alert.title,
              subtitle: alert.body,
              timestamp: alert.createdAt ?? new Date(),
              needsAction: x.status === "open" && !isRoutineInfo(alert),
            };
          })
        );
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [count]);

  return { activities, loading };
}
