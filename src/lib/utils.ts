import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware class merge. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Formatting moved to @/lib/format — import from there in new code. Re-exported
// here so the existing call sites keep working.
export {
  formatCurrency,
  formatNumber,
  capitalize,
  timeAgo,
  toDate,
  daysSince,
  formatDate,
  naira,
} from "./format";
