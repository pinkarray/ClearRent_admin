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

export interface RecentActivity {
  id: string;
  type: "verification" | "payment" | "issue" | "signup" | "rental";
  title: string;
  subtitle: string;
  timestamp: Date;
  status?: string;
  metadata?: Record<string, any>;
}

export function useRecentActivity(count = 15): {
  activities: RecentActivity[];
  loading: boolean;
} {
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    // Listen to recent user signups
    const usersQuery = query(
      collection(db, "users"),
      orderBy("createdAt", "desc"),
      limit(count)
    );

    const unsubUsers = onSnapshot(usersQuery, (snap) => {
      if (!isMounted) return;
      const userActivities: RecentActivity[] = snap.docs.map((doc) => {
        const d = doc.data();
        const ts = d.createdAt instanceof Timestamp ? d.createdAt.toDate() : new Date();
        const vStatus = d.verificationStatus || "none";

        // Determine activity type
        let type: RecentActivity["type"] = "signup";
        let title = `New ${d.accountType || "user"} signed up`;
        let subtitle = d.fullName || d.email || "Unknown";

        if (vStatus === "pending") {
          type = "verification";
          title = `Verification submitted`;
          subtitle = `${d.fullName || "User"} (${d.accountType || "unknown"})`;
        }

        return {
          id: doc.id,
          type,
          title,
          subtitle,
          timestamp: ts,
          status: vStatus,
          metadata: { accountType: d.accountType, email: d.email },
        };
      });

      setActivities(userActivities);
      setLoading(false);
    });

    return () => {
      isMounted = false;
      unsubUsers();
    };
  }, [count]);

  return { activities, loading };
}
