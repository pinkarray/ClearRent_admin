// Sidebar structure.
//
// Was a flat twenty-item array in dashboard-shell.tsx, ordered by roughly when
// each screen was built — Pricing next to Settings, Rent Attention buried
// between two unrelated review queues, and three separate payout screens spread
// across the list. Grouped here by what an admin is actually trying to do, and
// kept as data so the shell stays presentation-only.

import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  CreditCard,
  Wallet,
  Building2,
  AlertTriangle,
  BarChart3,
  Megaphone,
  Settings,
  MapPin,
  Banknote,
  TrendingUp,
  ClipboardCheck,
  RotateCcw,
  CalendarClock,
  ShieldAlert,
  Scale,
  Hourglass,
  Bell,
  Coins,
  LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  /** Null for the top group, which needs no heading. */
  label: string | null;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Alerts", href: "/dashboard/alerts", icon: Bell },
    ],
  },
  {
    // Queues where something is blocked on an admin decision. These are the
    // screens with a backlog, so they sit directly under Alerts.
    label: "Needs review",
    items: [
      { label: "Verifications", href: "/dashboard/verifications", icon: ShieldCheck },
      { label: "Rent Attention", href: "/dashboard/rent-attention", icon: Hourglass },
      { label: "Rent Reviews", href: "/dashboard/rent-reviews", icon: TrendingUp },
      { label: "Inspection Reviews", href: "/dashboard/inspection-reviews", icon: ClipboardCheck },
      { label: "Handovers", href: "/dashboard/handovers", icon: Scale },
      { label: "Collusion Watch", href: "/dashboard/collusion", icon: ShieldAlert },
      { label: "Area Requests", href: "/dashboard/unknown-areas", icon: MapPin },
    ],
  },
  {
    // Everything that moves money, together — previously scattered.
    label: "Money",
    items: [
      { label: "Payments", href: "/dashboard/payments", icon: CreditCard },
      { label: "Rent Payouts", href: "/dashboard/rent-payouts", icon: Banknote },
      { label: "Agent Payouts", href: "/dashboard/payouts", icon: Wallet },
      { label: "Refunds", href: "/dashboard/refunds", icon: RotateCcw },
      { label: "Pricing", href: "/dashboard/pricing", icon: Coins },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Users", href: "/dashboard/users", icon: Users },
      { label: "Properties", href: "/dashboard/properties", icon: Building2 },
      { label: "Inspection Day", href: "/dashboard/inspections", icon: CalendarClock },
      { label: "Issues", href: "/dashboard/issues", icon: AlertTriangle },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Analytics", href: "/dashboard/analytics", icon: BarChart3 },
      { label: "Announcements", href: "/dashboard/announcements", icon: Megaphone },
      { label: "Settings", href: "/dashboard/settings", icon: Settings },
    ],
  },
];

/** Flat list, for anything that needs to resolve a path to a label. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/**
 * Whether `href` is the active nav target for `pathname`.
 *
 * /dashboard is exact-match only; every other entry also matches its
 * subroutes, so /dashboard/users/abc keeps Users highlighted.
 */
export function isNavActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}
