// Formatting helpers shared across the dashboard.
//
// These used to be redefined per screen — `toDate` existed in four pages,
// `formatDate` in three, each with slightly different fallbacks. One home, one
// behaviour. `cn` deliberately stays in utils.ts (Tailwind convention).

import { Timestamp } from "firebase/firestore";

// ─── Dates ───────────────────────────────────────────────────────────────────

/**
 * Coerce whatever Firestore handed back into a Date.
 *
 * Accepts a Timestamp, an already-converted Date, or the `{seconds}` shape that
 * comes off documents read before the SDK's converter runs. Returns null rather
 * than an Invalid Date so callers can branch on "no value" explicitly.
 */
export function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null && "seconds" in v) {
    const s = (v as { seconds: unknown }).seconds;
    if (typeof s === "number") return new Date(s * 1000);
  }
  return null;
}

/** Whole days elapsed since `d`. 0 when the date is missing. */
export function daysSince(d: Date | null | undefined): number {
  if (!d) return 0;
  return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
}

/** Short absolute date — "12 Feb 2026". Em dash when there's nothing to show. */
export function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Absolute date with time — for audit trails where the hour matters. */
export function formatDateTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Relative, coarse. Falls back to an absolute date past a week. */
export function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-NG", { month: "short", day: "numeric" });
}

/** "1 day" / "3 days" — pluralisation for waiting-time copy. */
export function pluralDays(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

// ─── Money ───────────────────────────────────────────────────────────────────

/** Naira, no decimals — "₦200,000". The dashboard never shows kobo. */
export function naira(amount: number | null | undefined): string {
  return `₦${(amount || 0).toLocaleString("en-NG")}`;
}

/** Naira via Intl, for headline figures that want the full currency treatment. */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Text ────────────────────────────────────────────────────────────────────

/** Compact counts for stat tiles — 1.2K, 3.4M. */
export function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "payment_verified" -> "Payment verified". For raw Firestore status values. */
export function humanizeStatus(s: string): string {
  return capitalize(s.replace(/_/g, " "));
}
