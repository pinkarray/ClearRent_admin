"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { parseTimestamp } from "@/types";
import { cn, capitalize } from "@/lib/utils";
import {
  ArrowLeft,
  Loader2,
  Mail,
  Phone,
  MapPin,
  Clock,
  Building2,
  Home,
  KeyRound,
  ClipboardCheck,
  AlertTriangle,
  CreditCard,
  RotateCcw,
  Users as UsersIcon,
  ChevronRight,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type Role = "landlord" | "tenant" | "agent";

interface BaseUser {
  fullName: string;
  email: string;
  phone?: string;
  accountType: Role;
  verificationStatus: string;
  profileImageUrl?: string;
  baseLocation?: string;
  createdAt?: Date;
}

interface PropertyRow {
  id: string;
  title: string;
  // Exact street address lives in the gated private/location subdoc (Phase 2b);
  // this overview shows area-level (city/state) — `address` is a legacy
  // fallback for un-migrated docs.
  address: string;
  city: string;
  state: string;
  isAvailable: boolean;
  slots?: number;
  currentTenantsCount?: number;
  landlordId: string;
  assignedAgentId?: string;
}

interface RentalRow {
  id: string;
  kind: "rental" | "link"; // active_rental vs tenancy_link
  propertyId: string;
  propertyTitle: string;
  tenantId: string;
  landlordId: string;
  rentAmount: number;
  status: string;
  leaseEndDate?: Date;
}

interface InspectionRow {
  id: string;
  propertyTitle: string;
  tenantId: string;
  landlordId: string;
  agentId?: string;
  status: string;
  requestedDate?: Date;
  totalFee: number;
}

interface IssueRow {
  id: string;
  title: string;
  propertyTitle: string;
  tenantId: string;
  landlordId: string;
  status: string;
  createdAt?: Date;
}

interface PaymentRow {
  id: string;
  type: string;
  amount: number;
  status: string;
  createdAt?: Date;
}

interface RefundRow {
  id: string;
  amount: number;
  reason: string;
  status: string;
  createdAt?: Date;
}

interface UserGraph {
  owned: PropertyRow[]; // properties where landlordId == uid
  handled: PropertyRow[]; // properties where assignedAgentId == uid
  rentingAsTenant: RentalRow[]; // active_rentals/tenancy_links tenantId == uid
  tenantsInUnits: RentalRow[]; // active_rentals/tenancy_links landlordId == uid
  inspections: InspectionRow[];
  issues: IssueRow[];
  payments: PaymentRow[];
  refunds: RefundRow[];
  names: Record<string, string>; // uid -> full name (counterparties)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatNaira(amount: number) {
  return `₦${(amount ?? 0).toLocaleString("en-NG")}`;
}

function formatDate(d?: Date) {
  if (!d) return "—";
  return d.toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" });
}

const num = (v: unknown) => (typeof v === "number" ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");

// Merge active_rentals + tenancy_links snapshots into a single RentalRow list.
function mapRental(id: string, x: Record<string, unknown>, kind: "rental" | "link"): RentalRow {
  return {
    id,
    kind,
    propertyId: str(x.propertyId),
    propertyTitle: str(x.propertyTitle) || "Property",
    tenantId: str(x.tenantId),
    landlordId: str(x.landlordId),
    rentAmount: num(x.rentAmount),
    status: str(x.status) || (kind === "link" ? "linked" : "active"),
    leaseEndDate: parseTimestamp(x.leaseEndDate),
  };
}

// ─── Data load ────────────────────────────────────────────────────────────────

async function loadGraph(uid: string): Promise<UserGraph> {
  const col = (name: string) => collection(db, name);
  const byField = (name: string, field: string) =>
    getDocs(query(col(name), where(field, "==", uid)));

  // Fire everything in parallel; tolerate individual failures (a role that
  // has no rows in a collection still resolves empty).
  const [
    ownedSnap,
    handledSnap,
    rentalTenantSnap,
    rentalLandlordSnap,
    linkTenantSnap,
    linkLandlordSnap,
    inspTenantSnap,
    inspAgentSnap,
    inspLandlordSnap,
    issueTenantSnap,
    issueLandlordSnap,
    paymentsSnap,
    refundsSnap,
  ] = await Promise.all([
    byField("properties", "landlordId"),
    byField("properties", "assignedAgentId"),
    byField("active_rentals", "tenantId"),
    byField("active_rentals", "landlordId"),
    byField("tenancy_links", "tenantId"),
    byField("tenancy_links", "landlordId"),
    byField("inspection_requests", "tenantId"),
    byField("inspection_requests", "agentId"),
    byField("inspection_requests", "landlordId"),
    byField("issues", "tenantId"),
    byField("issues", "landlordId"),
    byField("payments", "userId"),
    byField("refunds", "beneficiaryId"),
  ]);

  const mapProperty = (d: (typeof ownedSnap.docs)[number]): PropertyRow => {
    const x = d.data();
    return {
      id: d.id,
      title: str(x.title) || "Property",
      address: str(x.address),
      city: str(x.city),
      state: str(x.state),
      isAvailable: x.isAvailable !== false,
      slots: typeof x.slots === "number" ? x.slots : undefined,
      currentTenantsCount:
        typeof x.currentTenantsCount === "number" ? x.currentTenantsCount : undefined,
      landlordId: str(x.landlordId),
      assignedAgentId: str(x.assignedAgentId) || undefined,
    };
  };

  const owned = ownedSnap.docs.map(mapProperty);
  const handled = handledSnap.docs.map(mapProperty);

  // De-dupe active_rentals + tenancy_links by id across the two.
  const dedupe = (rows: RentalRow[]) => {
    const seen = new Set<string>();
    return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  };
  const rentingAsTenant = dedupe([
    ...rentalTenantSnap.docs.map((d) => mapRental(d.id, d.data(), "rental")),
    ...linkTenantSnap.docs.map((d) => mapRental(d.id, d.data(), "link")),
  ]);
  const tenantsInUnits = dedupe([
    ...rentalLandlordSnap.docs.map((d) => mapRental(d.id, d.data(), "rental")),
    ...linkLandlordSnap.docs.map((d) => mapRental(d.id, d.data(), "link")),
  ]);

  // Inspections merge across the three roles; de-dupe by id.
  const inspSeen = new Set<string>();
  const inspections: InspectionRow[] = [];
  for (const d of [...inspTenantSnap.docs, ...inspAgentSnap.docs, ...inspLandlordSnap.docs]) {
    if (inspSeen.has(d.id)) continue;
    inspSeen.add(d.id);
    const x = d.data();
    inspections.push({
      id: d.id,
      propertyTitle: str(x.propertyTitle) || "Property",
      tenantId: str(x.tenantId),
      landlordId: str(x.landlordId),
      agentId: str(x.agentId) || undefined,
      status: str(x.status) || "pending",
      requestedDate: parseTimestamp(x.requestedDate),
      totalFee: num(x.totalFee),
    });
  }
  inspections.sort(
    (a, b) => (b.requestedDate?.getTime() ?? 0) - (a.requestedDate?.getTime() ?? 0)
  );

  const issueSeen = new Set<string>();
  const issues: IssueRow[] = [];
  for (const d of [...issueTenantSnap.docs, ...issueLandlordSnap.docs]) {
    if (issueSeen.has(d.id)) continue;
    issueSeen.add(d.id);
    const x = d.data();
    issues.push({
      id: d.id,
      title: str(x.title) || "Issue",
      propertyTitle: str(x.propertyTitle) || "Property",
      tenantId: str(x.tenantId),
      landlordId: str(x.landlordId),
      status: str(x.status) || "open",
      createdAt: parseTimestamp(x.createdAt),
    });
  }
  issues.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));

  const payments: PaymentRow[] = paymentsSnap.docs
    .map((d) => {
      const x = d.data();
      return {
        id: d.id,
        type: str(x.type) || "payment",
        amount: num(x.amount),
        status: str(x.status) || "—",
        createdAt: parseTimestamp(x.createdAt),
      };
    })
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));

  const refunds: RefundRow[] = refundsSnap.docs
    .map((d) => {
      const x = d.data();
      return {
        id: d.id,
        amount: num(x.amount),
        reason: str(x.reason) || "Refund",
        status: str(x.status) || "pending",
        createdAt: parseTimestamp(x.createdAt),
      };
    })
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));

  // Resolve counterparty names for cross-links.
  const counterpartyIds = new Set<string>();
  for (const p of [...owned, ...handled]) {
    if (p.assignedAgentId) counterpartyIds.add(p.assignedAgentId);
    if (p.landlordId) counterpartyIds.add(p.landlordId);
  }
  for (const r of [...rentingAsTenant, ...tenantsInUnits]) {
    counterpartyIds.add(r.tenantId);
    counterpartyIds.add(r.landlordId);
  }
  for (const i of inspections) {
    counterpartyIds.add(i.tenantId);
    counterpartyIds.add(i.landlordId);
    if (i.agentId) counterpartyIds.add(i.agentId);
  }
  for (const i of issues) {
    counterpartyIds.add(i.tenantId);
    counterpartyIds.add(i.landlordId);
  }
  counterpartyIds.delete(uid);
  counterpartyIds.delete("");

  const names: Record<string, string> = {};
  await Promise.all(
    Array.from(counterpartyIds).map(async (id) => {
      try {
        const s = await getDoc(doc(db, "users", id));
        if (s.exists()) names[id] = str(s.data().fullName) || "Unknown";
      } catch {
        /* leave unresolved */
      }
    })
  );

  return {
    owned,
    handled,
    rentingAsTenant,
    tenantsInUnits,
    inspections,
    issues,
    payments,
    refunds,
    names,
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UserProfilePage() {
  const params = useParams();
  const router = useRouter();
  const uid = String(params.uid);

  const [user, setUser] = useState<BaseUser | null>(null);
  const [graph, setGraph] = useState<UserGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const uSnap = await getDoc(doc(db, "users", uid));
        if (!uSnap.exists()) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const d = uSnap.data();
        const base: BaseUser = {
          fullName: str(d.fullName) || "Unknown",
          email: str(d.email),
          phone: str(d.phone) || undefined,
          accountType: (str(d.accountType) as Role) || "tenant",
          verificationStatus: str(d.verificationStatus) || "none",
          profileImageUrl: str(d.profileImageUrl) || undefined,
          baseLocation: str(d.baseLocation) || undefined,
          createdAt: parseTimestamp(d.createdAt),
        };
        const g = await loadGraph(uid);
        if (!cancelled) {
          setUser(base);
          setGraph(g);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-[rgb(var(--brand))]" />
      </div>
    );
  }

  if (notFound || !user || !graph) {
    return (
      <div className="space-y-4">
        <BackButton />
        <div className="card text-center py-16">
          <UsersIcon size={40} className="mx-auto text-[rgb(var(--text-hint))] mb-4" />
          <p className="text-[rgb(var(--text-secondary))] font-medium">User not found</p>
        </div>
      </div>
    );
  }

  const initials = user.fullName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  const roleColor: Record<string, string> = {
    landlord: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    tenant: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    agent: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  };

  return (
    <div className="space-y-6">
      <BackButton />

      {/* Header */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          {user.profileImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.profileImageUrl}
              alt={user.fullName}
              className="w-16 h-16 rounded-full object-cover shrink-0"
            />
          ) : (
            <div
              className={cn(
                "w-16 h-16 rounded-full flex items-center justify-center font-semibold text-xl shrink-0",
                roleColor[user.accountType] || roleColor.tenant
              )}
            >
              {initials || "?"}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-display font-bold text-[rgb(var(--text-primary))]">
                {user.fullName}
              </h1>
              <span className={cn("badge", roleColor[user.accountType] || roleColor.tenant)}>
                {capitalize(user.accountType)}
              </span>
              <VerificationPill status={user.verificationStatus} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-[rgb(var(--text-secondary))]">
              <span className="flex items-center gap-1.5"><Mail size={13} />{user.email || "—"}</span>
              <span className="flex items-center gap-1.5"><Phone size={13} />{user.phone || "—"}</span>
              {user.baseLocation && (
                <span className="flex items-center gap-1.5"><MapPin size={13} />{user.baseLocation}</span>
              )}
              <span className="flex items-center gap-1.5"><Clock size={13} />Joined {formatDate(user.createdAt)}</span>
            </div>
          </div>
        </div>

        {/* Relationship snapshot */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-5">
          <Stat label="Owns" value={graph.owned.length} icon={Building2} />
          <Stat label="Handles" value={graph.handled.length} icon={KeyRound} />
          <Stat label="Renting" value={graph.rentingAsTenant.length} icon={Home} />
          <Stat label="Inspections" value={graph.inspections.length} icon={ClipboardCheck} />
          <Stat label="Issues" value={graph.issues.length} icon={AlertTriangle} />
          <Stat label="Refunds" value={graph.refunds.length} icon={RotateCcw} />
        </div>
      </div>

      {/* Owns (landlord) */}
      {graph.owned.length > 0 && (
        <Section title="Properties owned" icon={Building2} count={graph.owned.length}>
          {graph.owned.map((p) => (
            <div key={p.id} className="row">
              <div className="flex-1 min-w-0">
                <p className="row-title">{p.title}</p>
                <p className="row-sub">
                  {[p.city, p.state].filter(Boolean).join(", ") ||
                    p.address ||
                    "No location"}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {p.assignedAgentId && (
                  <span className="text-xs text-[rgb(var(--text-hint))]">
                    Agent:{" "}
                    <PersonLink
                      uid={p.assignedAgentId}
                      name={graph.names[p.assignedAgentId]}
                      router={router}
                    />
                  </span>
                )}
                <OccupancyPill p={p} />
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* Handles (agent) */}
      {graph.handled.length > 0 && (
        <Section title="Properties handled as agent" icon={KeyRound} count={graph.handled.length}>
          {graph.handled.map((p) => (
            <div key={p.id} className="row">
              <div className="flex-1 min-w-0">
                <p className="row-title">{p.title}</p>
                <p className="row-sub">
                  {[p.city, p.state].filter(Boolean).join(", ") ||
                    p.address ||
                    "No location"}
                </p>
              </div>
              <span className="text-xs text-[rgb(var(--text-hint))] shrink-0">
                Owner:{" "}
                <PersonLink uid={p.landlordId} name={graph.names[p.landlordId]} router={router} />
              </span>
            </div>
          ))}
        </Section>
      )}

      {/* Renting (tenant) */}
      {graph.rentingAsTenant.length > 0 && (
        <Section title="Renting / occupying" icon={Home} count={graph.rentingAsTenant.length}>
          {graph.rentingAsTenant.map((r) => (
            <div key={r.id} className="row">
              <div className="flex-1 min-w-0">
                <p className="row-title">{r.propertyTitle}</p>
                <p className="row-sub">
                  Landlord:{" "}
                  <PersonLink uid={r.landlordId} name={graph.names[r.landlordId]} router={router} />
                  {r.kind === "link" && <span className="ml-2 badge-neutral text-[10px]">linked</span>}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-mono text-[rgb(var(--text-primary))]">{formatNaira(r.rentAmount)}</p>
                <p className="text-[11px] text-[rgb(var(--text-hint))]">{capitalize(r.status)} · ends {formatDate(r.leaseEndDate)}</p>
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* Tenants in their units (landlord) */}
      {graph.tenantsInUnits.length > 0 && (
        <Section title="Tenants in their properties" icon={UsersIcon} count={graph.tenantsInUnits.length}>
          {graph.tenantsInUnits.map((r) => (
            <div key={r.id} className="row">
              <div className="flex-1 min-w-0">
                <p className="row-title">
                  <PersonLink uid={r.tenantId} name={graph.names[r.tenantId]} router={router} />
                </p>
                <p className="row-sub">
                  {r.propertyTitle}
                  {r.kind === "link" && <span className="ml-2 badge-neutral text-[10px]">linked</span>}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-mono text-[rgb(var(--text-primary))]">{formatNaira(r.rentAmount)}</p>
                <p className="text-[11px] text-[rgb(var(--text-hint))]">{capitalize(r.status)}</p>
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* Inspections */}
      {graph.inspections.length > 0 && (
        <Section title="Inspections" icon={ClipboardCheck} count={graph.inspections.length}>
          {graph.inspections.map((i) => {
            const role =
              i.tenantId === uid ? "as tenant" : i.agentId === uid ? "as agent" : "as landlord";
            const handlerId = i.agentId ?? i.landlordId;
            return (
              <div key={i.id} className="row">
                <div className="flex-1 min-w-0">
                  <p className="row-title">{i.propertyTitle}</p>
                  <p className="row-sub">
                    {role} · tenant{" "}
                    <PersonLink uid={i.tenantId} name={graph.names[i.tenantId]} router={router} self={uid} />
                    {" · handler "}
                    <PersonLink uid={handlerId} name={graph.names[handlerId]} router={router} self={uid} />
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <StatusText status={i.status} />
                  <p className="text-[11px] text-[rgb(var(--text-hint))]">{formatDate(i.requestedDate)}</p>
                </div>
              </div>
            );
          })}
        </Section>
      )}

      {/* Issues */}
      {graph.issues.length > 0 && (
        <Section title="Issues" icon={AlertTriangle} count={graph.issues.length}>
          {graph.issues.map((i) => (
            <div key={i.id} className="row">
              <div className="flex-1 min-w-0">
                <p className="row-title">{i.title}</p>
                <p className="row-sub">{i.propertyTitle}</p>
              </div>
              <div className="text-right shrink-0">
                <StatusText status={i.status} />
                <p className="text-[11px] text-[rgb(var(--text-hint))]">{formatDate(i.createdAt)}</p>
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* Payments + Refunds */}
      {(graph.payments.length > 0 || graph.refunds.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Section title="Payments" icon={CreditCard} count={graph.payments.length}>
            {graph.payments.length === 0 ? (
              <p className="text-sm text-[rgb(var(--text-hint))] px-1 py-2">No payments recorded.</p>
            ) : (
              graph.payments.map((p) => (
                <div key={p.id} className="row">
                  <div className="flex-1 min-w-0">
                    <p className="row-title capitalize">{p.type}</p>
                    <p className="row-sub">{capitalize(p.status)} · {formatDate(p.createdAt)}</p>
                  </div>
                  <p className="text-sm font-mono text-[rgb(var(--text-primary))] shrink-0">{formatNaira(p.amount)}</p>
                </div>
              ))
            )}
          </Section>
          <Section title="Refunds" icon={RotateCcw} count={graph.refunds.length}>
            {graph.refunds.length === 0 ? (
              <p className="text-sm text-[rgb(var(--text-hint))] px-1 py-2">No refunds.</p>
            ) : (
              graph.refunds.map((r) => (
                <div key={r.id} className="row">
                  <div className="flex-1 min-w-0">
                    <p className="row-title">{r.reason}</p>
                    <p className="row-sub">{capitalize(r.status)} · {formatDate(r.createdAt)}</p>
                  </div>
                  <p className="text-sm font-mono text-[rgb(var(--text-primary))] shrink-0">{formatNaira(r.amount)}</p>
                </div>
              ))
            )}
          </Section>
        </div>
      )}

      {/* Nothing at all */}
      {graph.owned.length === 0 &&
        graph.handled.length === 0 &&
        graph.rentingAsTenant.length === 0 &&
        graph.tenantsInUnits.length === 0 &&
        graph.inspections.length === 0 &&
        graph.issues.length === 0 &&
        graph.payments.length === 0 &&
        graph.refunds.length === 0 && (
          <div className="card text-center py-12">
            <p className="text-sm text-[rgb(var(--text-secondary))]">
              No properties, tenancies, inspections, issues, or payments linked to this user yet.
            </p>
          </div>
        )}

      <style jsx>{`
        :global(.row) {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 0.75rem 0.25rem;
          border-bottom: 1px solid rgb(var(--border) / 0.5);
        }
        :global(.row:last-child) {
          border-bottom: none;
        }
        :global(.row-title) {
          font-size: 0.875rem;
          font-weight: 500;
          color: rgb(var(--text-primary));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        :global(.row-sub) {
          font-size: 0.75rem;
          color: rgb(var(--text-hint));
          margin-top: 0.125rem;
        }
      `}</style>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function BackButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.back()}
      className="flex items-center gap-1.5 text-sm text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))] transition-colors"
    >
      <ArrowLeft size={16} />
      Back
    </button>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: React.ElementType }) {
  return (
    <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[rgb(var(--text-hint))]">
        <Icon size={13} />
        <span className="text-[11px] uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-lg font-bold text-[rgb(var(--text-primary))] mt-0.5">{value}</p>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  count,
  children,
}: {
  title: string;
  icon: React.ElementType;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className="text-[rgb(var(--brand))]" />
        <h2 className="font-display font-semibold text-[rgb(var(--text-primary))]">{title}</h2>
        <span className="text-xs text-[rgb(var(--text-hint))]">({count})</span>
      </div>
      <div>{children}</div>
    </div>
  );
}

function PersonLink({
  uid,
  name,
  router,
  self,
}: {
  uid: string;
  name?: string;
  router: ReturnType<typeof useRouter>;
  self?: string;
}) {
  if (!uid) return <span className="text-[rgb(var(--text-hint))]">—</span>;
  const label = name || "Unknown";
  if (self && uid === self) {
    return <span className="font-medium text-[rgb(var(--text-secondary))]">{label} (this user)</span>;
  }
  return (
    <button
      onClick={() => router.push(`/dashboard/users/${uid}`)}
      className="font-medium text-[rgb(var(--brand))] hover:underline inline-flex items-center gap-0.5"
    >
      {label}
      <ChevronRight size={11} />
    </button>
  );
}

function OccupancyPill({ p }: { p: PropertyRow }) {
  const occupied = (p.currentTenantsCount ?? 0) > 0;
  return (
    <span
      className={cn(
        "text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap",
        occupied
          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
          : p.isAvailable
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-[rgb(var(--text-hint))]/10 text-[rgb(var(--text-secondary))]"
      )}
    >
      {p.slots && p.slots > 1
        ? `${p.currentTenantsCount ?? 0}/${p.slots} occupied`
        : occupied
        ? "Occupied"
        : p.isAvailable
        ? "Available"
        : "Unlisted"}
    </span>
  );
}

function VerificationPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    verified: "badge-success",
    pending: "badge-warning",
    rejected: "badge-error",
    none: "badge-neutral",
  };
  return <span className={map[status] || "badge-neutral"}>{capitalize(status)}</span>;
}

function StatusText({ status }: { status: string }) {
  const good = ["completed", "resolved", "paid", "accepted", "approved"].includes(status);
  const warn = ["awaitingOutcome", "pending", "in_progress", "pending_confirmation"].includes(status);
  return (
    <p
      className={cn(
        "text-sm font-medium capitalize",
        good
          ? "text-emerald-600 dark:text-emerald-400"
          : warn
          ? "text-amber-500"
          : "text-[rgb(var(--text-secondary))]"
      )}
    >
      {status === "awaitingOutcome" ? "Awaiting review" : status.replace(/_/g, " ")}
    </p>
  );
}
