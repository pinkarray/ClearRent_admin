"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import {
  CalendarClock,
  Search,
  X,
  Loader2,
  Bell,
  Pin,
  PinOff,
  User,
  Home,
  MapPin,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Inspection {
  id: string;
  propertyTitle: string;
  propertyAddress: string;
  tenantId: string;
  tenantName: string;
  agentId: string | null;
  agentName: string | null;
  landlordId: string;
  landlordName: string | null;
  requestedDate: Date | null;
  requestedTimeSlot: string;
  requestedTimeDisplay: string;
  tenantOnWay: boolean;
  tenantArrived: boolean;
  handlerOnWay: boolean;
  handlerArrived: boolean;
  totalFee: number;
  adminPinned: boolean;
}

function toDate(v: unknown): Date | null {
  if (v instanceof Timestamp) return v.toDate();
  return null;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(a: Date, b: Date) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function formatDate(d: Date | null) {
  if (!d) return "Date TBD";
  return d.toLocaleDateString("en-NG", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function InspectionDayPage() {
  const router = useRouter();
  const [items, setItems] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [nudging, setNudging] = useState<string | null>(null); // `${id}:${target}`
  const [nudged, setNudged] = useState<Record<string, number>>({});
  const [pinBusy, setPinBusy] = useState<string | null>(null);

  useEffect(() => {
    // Approved inspections are the ones that will actually happen. Awaiting-
    // review ones live on the Inspection Reviews page, so exclude them here.
    const q = query(
      collection(db, "inspection_requests"),
      where("status", "==", "approved")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: Inspection[] = snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            propertyTitle: (x.propertyTitle as string) ?? "Property",
            propertyAddress: (x.propertyAddress as string) ?? "",
            tenantId: (x.tenantId as string) ?? "",
            tenantName: (x.tenantName as string) ?? "Tenant",
            agentId: (x.agentId as string) || null,
            agentName: (x.agentName as string) || null,
            landlordId: (x.landlordId as string) ?? "",
            landlordName: (x.landlordName as string) || null,
            requestedDate: toDate(x.requestedDate),
            requestedTimeSlot: (x.requestedTimeSlot as string) ?? "",
            requestedTimeDisplay: (x.requestedTimeDisplay as string) ?? "",
            tenantOnWay: x.tenantOnWay === true,
            tenantArrived: x.tenantArrived === true,
            handlerOnWay: x.handlerOnWay === true,
            handlerArrived: x.handlerArrived === true,
            totalFee: (x.totalFee as number) ?? 0,
            adminPinned: x.adminPinned === true,
          };
        });
        setItems(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.propertyTitle.toLowerCase().includes(q) ||
        i.tenantName.toLowerCase().includes(q) ||
        (i.agentName ?? "").toLowerCase().includes(q) ||
        (i.landlordName ?? "").toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  const { pinned, today, upcoming, overdue } = useMemo(() => {
    const now = new Date();
    const pinned: Inspection[] = [];
    const today: Inspection[] = [];
    const upcoming: Inspection[] = [];
    const overdue: Inspection[] = [];
    const byDate = (a: Inspection, b: Inspection) =>
      (a.requestedDate?.getTime() ?? 0) - (b.requestedDate?.getTime() ?? 0);
    for (const i of filtered) {
      if (i.adminPinned) {
        pinned.push(i);
        continue;
      }
      const d = i.requestedDate;
      if (!d) {
        upcoming.push(i);
      } else if (isSameDay(d, now)) {
        today.push(i);
      } else if (d.getTime() < startOfDay(now).getTime()) {
        overdue.push(i);
      } else {
        upcoming.push(i);
      }
    }
    pinned.sort(byDate);
    today.sort(byDate);
    upcoming.sort(byDate);
    overdue.sort(byDate);
    return { pinned, today, upcoming, overdue };
  }, [filtered]);

  async function nudge(item: Inspection, target: "tenant" | "handler") {
    const key = `${item.id}:${target}`;
    setNudging(key);
    try {
      const fn = httpsCallable<
        { inspectionId: string; target: "tenant" | "handler" },
        { ok: boolean }
      >(functions, "nudgeInspectionParty");
      await fn({ inspectionId: item.id, target });
      setNudged((prev) => ({ ...prev, [key]: Date.now() }));
    } catch (err) {
      alert(
        err instanceof Error ? err.message : "Could not send the reminder. Try again."
      );
    } finally {
      setNudging(null);
    }
  }

  async function togglePin(item: Inspection) {
    setPinBusy(item.id);
    try {
      await updateDoc(doc(db, "inspection_requests", item.id), {
        adminPinned: !item.adminPinned,
        adminPinnedAt: item.adminPinned ? null : serverTimestamp(),
      });
    } finally {
      setPinBusy(null);
    }
  }

  const cardProps = { router, nudge, nudging, nudged, togglePin, pinBusy };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl lg:text-3xl font-display font-bold text-[rgb(var(--text-primary))]">
            Inspection Day
          </h1>
          <p className="text-sm text-[rgb(var(--text-secondary))] mt-1">
            Approved inspections by day. Nudge a party or pin one to follow up.
          </p>
        </div>
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgb(var(--text-hint))]"
          />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search property or person"
            className="pl-9 pr-8 py-2 rounded-xl bg-[rgb(var(--surface))] border border-[rgb(var(--border))] text-sm w-64 focus:outline-none focus:border-[rgb(var(--brand))]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgb(var(--text-hint))]"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-[rgb(var(--brand))]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16">
          <CalendarClock size={36} className="mx-auto text-[rgb(var(--text-hint))]" />
          <p className="mt-3 text-sm text-[rgb(var(--text-secondary))]">
            No approved inspections scheduled right now.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {pinned.length > 0 && (
            <Group title="Pinned" tone="brand" count={pinned.length}>
              {pinned.map((i) => (
                <InspectionCard key={i.id} item={i} {...cardProps} />
              ))}
            </Group>
          )}
          {overdue.length > 0 && (
            <Group title="Overdue — no outcome yet" tone="amber" count={overdue.length}>
              {overdue.map((i) => (
                <InspectionCard key={i.id} item={i} {...cardProps} />
              ))}
            </Group>
          )}
          {today.length > 0 && (
            <Group title="Today" tone="brand" count={today.length}>
              {today.map((i) => (
                <InspectionCard key={i.id} item={i} {...cardProps} />
              ))}
            </Group>
          )}
          {upcoming.length > 0 && (
            <Group title="Upcoming" tone="neutral" count={upcoming.length}>
              {upcoming.map((i) => (
                <InspectionCard key={i.id} item={i} {...cardProps} />
              ))}
            </Group>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Group({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count: number;
  tone: "brand" | "amber" | "neutral";
  children: React.ReactNode;
}) {
  const dot =
    tone === "amber"
      ? "bg-amber-500"
      : tone === "brand"
      ? "bg-[rgb(var(--brand))]"
      : "bg-[rgb(var(--text-hint))]";
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className={cn("w-2 h-2 rounded-full", dot)} />
        <h2 className="text-sm font-display font-semibold uppercase tracking-wider text-[rgb(var(--text-secondary))]">
          {title}
        </h2>
        <span className="text-xs text-[rgb(var(--text-hint))]">({count})</span>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

interface CardProps {
  item: Inspection;
  router: ReturnType<typeof useRouter>;
  nudge: (item: Inspection, target: "tenant" | "handler") => void;
  nudging: string | null;
  nudged: Record<string, number>;
  togglePin: (item: Inspection) => void;
  pinBusy: string | null;
}

function InspectionCard({ item, router, nudge, nudging, nudged, togglePin, pinBusy }: CardProps) {
  const handlerId = item.agentId ?? item.landlordId;
  const handlerName = item.agentId ? item.agentName ?? "Agent" : item.landlordName ?? "Landlord";
  const handlerRole = item.agentId ? "agent" : "landlord";
  const tenantKey = `${item.id}:tenant`;
  const handlerKey = `${item.id}:handler`;

  return (
    <div className={cn("card", item.adminPinned && "border-[rgb(var(--brand))]/40")}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2 min-w-0">
          <div className="flex items-center gap-2">
            <Home size={15} className="text-[rgb(var(--brand))] shrink-0" />
            <span className="font-semibold text-sm text-[rgb(var(--text-primary))]">
              {item.propertyTitle}
            </span>
          </div>
          {item.propertyAddress && (
            <p className="flex items-center gap-1 text-xs text-[rgb(var(--text-hint))]">
              <MapPin size={11} /> {item.propertyAddress}
            </p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[rgb(var(--text-secondary))]">
            <span className="flex items-center gap-1">
              <CalendarClock size={12} />
              {formatDate(item.requestedDate)}
              {item.requestedTimeDisplay || item.requestedTimeSlot
                ? ` · ${item.requestedTimeDisplay || item.requestedTimeSlot}`
                : ""}
            </span>
            <button
              onClick={() => router.push(`/dashboard/users/${item.tenantId}`)}
              className="flex items-center gap-1 hover:text-[rgb(var(--brand))]"
            >
              <User size={12} /> {item.tenantName} (tenant)
            </button>
            <button
              onClick={() => router.push(`/dashboard/users/${handlerId}`)}
              className="flex items-center gap-1 hover:text-[rgb(var(--brand))]"
            >
              <User size={12} /> {handlerName} ({handlerRole})
            </button>
          </div>
          {/* Arrival progress */}
          <div className="flex flex-wrap gap-2 pt-0.5">
            <ProgressPill label="Tenant" onWay={item.tenantOnWay} arrived={item.tenantArrived} />
            <ProgressPill label="Handler" onWay={item.handlerOnWay} arrived={item.handlerArrived} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <button
            onClick={() => togglePin(item)}
            disabled={pinBusy === item.id}
            className={cn(
              "flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50",
              item.adminPinned
                ? "border-[rgb(var(--brand))]/40 text-[rgb(var(--brand))] bg-[rgb(var(--brand))]/5"
                : "border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))]"
            )}
          >
            {pinBusy === item.id ? (
              <Loader2 size={12} className="animate-spin" />
            ) : item.adminPinned ? (
              <PinOff size={12} />
            ) : (
              <Pin size={12} />
            )}
            {item.adminPinned ? "Unpin" : "Pin"}
          </button>
          <div className="flex gap-2">
            <NudgeButton
              label="Nudge tenant"
              busy={nudging === tenantKey}
              done={!!nudged[tenantKey]}
              onClick={() => nudge(item, "tenant")}
            />
            <NudgeButton
              label="Nudge handler"
              busy={nudging === handlerKey}
              done={!!nudged[handlerKey]}
              onClick={() => nudge(item, "handler")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function NudgeButton({
  label,
  busy,
  done,
  onClick,
}: {
  label: string;
  busy: boolean;
  done: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-[rgb(var(--brand))]/10 text-[rgb(var(--brand))] hover:bg-[rgb(var(--brand))]/20 transition-colors disabled:opacity-50"
    >
      {busy ? (
        <Loader2 size={12} className="animate-spin" />
      ) : done ? (
        <CheckCircle2 size={12} className="text-emerald-500" />
      ) : (
        <Bell size={12} />
      )}
      {done ? "Sent" : label}
    </button>
  );
}

function ProgressPill({
  label,
  onWay,
  arrived,
}: {
  label: string;
  onWay: boolean;
  arrived: boolean;
}) {
  const state = arrived ? "arrived" : onWay ? "onway" : "waiting";
  const cfg = {
    arrived: {
      cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      icon: CheckCircle2,
      text: "arrived",
    },
    onway: {
      cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      icon: AlertTriangle,
      text: "on the way",
    },
    waiting: {
      cls: "bg-[rgb(var(--text-hint))]/10 text-[rgb(var(--text-secondary))]",
      icon: XCircle,
      text: "not yet",
    },
  }[state];
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        "flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full",
        cfg.cls
      )}
    >
      <Icon size={11} />
      {label} {cfg.text}
    </span>
  );
}
