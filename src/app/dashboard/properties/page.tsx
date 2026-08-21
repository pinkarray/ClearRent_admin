"use client";

import { useEffect, useState, useMemo } from "react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, auth, functions } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { parseTimestamp } from "@/types";
import { cn, timeAgo } from "@/lib/utils";
import {
  Building2,
  Search,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  ExternalLink,
  MapPin,
  User,
  BedDouble,
  Bath,
  Home,
  AlertTriangle,
  ShieldCheck,
  ShieldOff,
  FileText,
  Users,
  BarChart2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

// Mirrors PropertyModel.typeLabels. 'shop'/'office' aren't pickable by a
// landlord yet but still filterable, so an old listing can be found.
type TypeFilter =
  | "all"
  | "flat"
  | "duplex"
  | "semiDetachedDuplex"
  | "bungalow"
  | "selfContain"
  | "room"
  | "roomAndParlour"
  | "miniFlat"
  | "shop"
  | "office";

// 'miniFlat' is the same dwelling as 'roomAndParlour' and is no longer
// pickable; 'shop'/'office' aren't pickable yet. All stay filterable so an
// existing listing can still be found.
const TYPE_LABELS: Record<string, string> = {
  flat: "Flat",
  duplex: "Duplex",
  semiDetachedDuplex: "Semi-Detached Duplex",
  bungalow: "Bungalow",
  selfContain: "Self Contain",
  room: "Room",
  roomAndParlour: "Room & Parlour",
  miniFlat: "Mini Flat",
  shop: "Shop",
  office: "Office",
};
type DocStatusFilter = "all" | "pending" | "verified" | "rejected" | "none";
type RegionFilter = "all" | "lagos" | "outside";

interface Property {
  id: string;
  landlordId: string;
  landlordName?: string;
  landlordPhone?: string;
  title: string;
  propertyType: string;
  address: string;
  city: string;
  state: string;
  bedrooms: number;
  bathrooms: number;
  rent: number;
  rentFrequency: string;
  maxTenants: number;
  currentTenantsCount?: number;
  isAvailable: boolean;
  isVerified: boolean;
  images: string[];
  // Ownership doc
  ownershipDocUrl?: string;
  ownershipDocType?: string;
  ownershipDocStatus: string; // none | pending | verified | rejected | inherited
  ownershipDocRejectionReason?: string;
  // Building grouping — when set, the ownership doc lives on the building and
  // is shared across all its units.
  buildingId?: string;
  // Which unit this is inside that building. Without it two units of the same
  // shape in one compound are the same row twice at review time.
  unitLabel?: string;
  floor?: string;
  // Grouped units only: what the tenant gets exclusively. Sharing is a fact
  // about the arrangement, not the type — a self contain in a compound can
  // still share a toilet — so these are set for any unit, and absent when the
  // whole property is let.
  bathroomAccess?: string;
  toiletAccess?: string;
  kitchenAccess?: string;
  livingRoomAccess?: string;
  // The unit's OWN building, when the site is a compound: one C of O can cover
  // a duplex and a bungalow side by side, so the building's `structure` says
  // only "compound" and loses which one this unit is in.
  unitBuildingStructure?: string;
  unitBuildingLabel?: string;
  // Stats
  viewCount: number;
  inquiryCount: number;
  // Inspection
  inspectionHandler: string;
  assignedAgentName?: string;
  caretakerId?: string;
  caretakerName?: string;
  // Readiness gate (Phase 2): vetted by the handler ⇒ bookable for inspection.
  readyForInspections: boolean;
  createdAt: Date;
}

interface Building {
  id: string;
  landlordId: string;
  name: string;
  address: string;
  // What the whole structure is: duplex, compound, storey building… The unit's
  // own propertyType says only what is being let.
  structure?: string;
  ownershipDocUrl?: string;
  ownershipDocType?: string;
  ownershipDocStatus: string; // none | pending | verified | rejected
  ownershipDocRejectionReason?: string;
}

// Ownership-doc info that actually governs a listing: the building's shared doc
// when the unit is grouped, otherwise the unit's own.
interface DocInfo {
  status: string;
  url?: string;
  type?: string;
  rejectionReason?: string;
  building?: Building; // present when the doc is inherited from a building
}

function resolveDoc(p: Property, buildings: Map<string, Building>): DocInfo {
  const b = p.buildingId ? buildings.get(p.buildingId) : undefined;
  if (b) {
    return {
      status: b.ownershipDocStatus,
      url: b.ownershipDocUrl,
      type: b.ownershipDocType,
      rejectionReason: b.ownershipDocRejectionReason,
      building: b,
    };
  }
  return {
    status: p.ownershipDocStatus,
    url: p.ownershipDocUrl,
    type: p.ownershipDocType,
    rejectionReason: p.ownershipDocRejectionReason,
  };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatNaira(amount: number) {
  if (amount >= 1_000_000) return `₦${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `₦${(amount / 1_000).toFixed(0)}K`;
  return `₦${amount.toLocaleString()}`;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Labels for BuildingModel.structure — what the whole thing is, as opposed to
// the unit's propertyType, which is only what the tenant gets.
const STRUCTURE_LABELS: Record<string, string> = {
  duplex: "Duplex",
  bungalow: "Bungalow",
  storeyBuilding: "Storey building",
  blockOfFlats: "Block of flats",
  compound: "Compound",
  faceMeIFaceYou: "Face me I face you",
  detachedHouse: "Detached house",
  other: "Other",
};

const FLOOR_LABELS: Record<string, string> = {
  ground: "Ground floor",
  "1": "1st floor",
  "2": "2nd floor",
  "3": "3rd floor",
  "4": "4th floor",
};

// "Ade's Compound (Duplex)" — buildings created before `structure` existed have
// none, so the parenthetical is dropped rather than shown empty.
function buildingContext(b: Building) {
  const s = b.structure ? STRUCTURE_LABELS[b.structure] : undefined;
  return s ? `${b.name} (${s})` : b.name;
}

// "Room 2 · 1st floor" — which unit inside the building this listing is.
function unitDescriptor(p: Property) {
  const parts: string[] = [];
  if (p.unitLabel) parts.push(p.unitLabel);
  if (p.floor) parts.push(FLOOR_LABELS[p.floor] || `Floor ${p.floor}`);
  return parts.join(" · ");
}

// ClearRent operates in Lagos today, but nothing blocks a listing elsewhere:
// admin review IS the gate. A listing born isVerified:false / isAvailable:false
// cannot be browsed or booked until someone here approves it — so this flag has
// to be visible at the moment of review, or an out-of-state listing gets
// rubber-stamped through with everything else.
//
// The landlord cannot type this value: it is derived from their map pin.
// Case-insensitive because it comes from a geocoder that returns both cases.
// Types that are ONE space. Their spec is which facilities the tenant gets
// exclusively — a bedroom count would be a tautology, and showing one made a
// shared room read identically to a self-contained flat.
function isSingleSpace(type: string) {
  return (
    type === "room" ||
    type === "roomAndParlour" ||
    type === "selfContain" ||
    type === "miniFlat"
  );
}

function accessLabel(access?: string) {
  if (access === "private") return "Private";
  if (access === "shared") return "Shared";
  if (access === "none") return "None";
  return "Not stated";
}

function isOutsideLagos(p: Property) {
  const state = (p.state || "").trim();
  return state.length > 0 && state.toLowerCase() !== "lagos";
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PropertiesPage() {
  const { canWrite } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [buildings, setBuildings] = useState<Map<string, Building>>(new Map());
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [docStatusFilter, setDocStatusFilter] = useState<DocStatusFilter>("all");
  const [regionFilter, setRegionFilter] = useState<RegionFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [processing, setProcessing] = useState<Set<string>>(new Set());

  // ── Listener ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const q = query(collection(db, "properties"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const parsed: Property[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          landlordId: data.landlordId || "",
          landlordName: data.landlordName,
          landlordPhone: data.landlordPhone,
          title: data.title || "Untitled Property",
          propertyType: data.propertyType || "flat",
          address: data.address || "",
          city: data.city || "",
          state: data.state || "",
          bedrooms: data.bedrooms || 0,
          bathrooms: data.bathrooms || 0,
          rent: (data.rent || 0) as number,
          rentFrequency: data.rentFrequency || "yearly",
          maxTenants: data.maxTenants || 1,
          currentTenantsCount: data.currentTenantsCount,
          isAvailable: data.isAvailable ?? true,
          isVerified: data.isVerified ?? false,
          images: data.images || [],
          ownershipDocUrl: data.ownershipDocUrl,
          ownershipDocType: data.ownershipDocType,
          ownershipDocStatus: data.ownershipDocStatus || "none",
          ownershipDocRejectionReason: data.ownershipDocRejectionReason,
          buildingId: data.buildingId,
          unitLabel: data.unitLabel,
          floor: data.floor,
          bathroomAccess: data.bathroomAccess,
          toiletAccess: data.toiletAccess,
          kitchenAccess: data.kitchenAccess,
          livingRoomAccess: data.livingRoomAccess,
          unitBuildingStructure: data.unitBuildingStructure,
          unitBuildingLabel: data.unitBuildingLabel,
          viewCount: data.viewCount || 0,
          inquiryCount: data.inquiryCount || 0,
          inspectionHandler: data.inspectionHandler || "self",
          assignedAgentName: data.assignedAgentName,
          caretakerId: data.caretakerId,
          caretakerName: data.caretakerName,
          readyForInspections: data.readyForInspections === true,
          createdAt: parseTimestamp(data.createdAt) || new Date(),
        };
      });
      setProperties(parsed);
      setLoading(false);
    });

    // Buildings carry the shared ownership doc for grouped units.
    const unsubBuildings = onSnapshot(
      collection(db, "buildings"),
      (snap) => {
        const map = new Map<string, Building>();
        snap.docs.forEach((d) => {
          const data = d.data();
          map.set(d.id, {
            id: d.id,
            landlordId: data.landlordId || "",
            name: data.name || "Building",
            address: data.address || "",
            structure: data.structure,
            ownershipDocUrl: data.ownershipDocUrl,
            ownershipDocType: data.ownershipDocType,
            ownershipDocStatus: data.ownershipDocStatus || "none",
            ownershipDocRejectionReason: data.ownershipDocRejectionReason,
          });
        });
        setBuildings(map);
      }
    );

    return () => {
      unsub();
      unsubBuildings();
    };
  }, []);

  // ── Counts ─────────────────────────────────────────────────────────────────

  const pendingDocCount = properties.filter(
    (p) => resolveDoc(p, buildings).status === "pending"
  ).length;
  const totalCount = properties.length;
  const availableCount = properties.filter((p) => p.isAvailable).length;
  const outsideLagosCount = properties.filter(isOutsideLagos).length;

  // ── Filtering ──────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return properties.filter((p) => {
      if (typeFilter !== "all" && p.propertyType !== typeFilter) return false;
      if (
        docStatusFilter !== "all" &&
        resolveDoc(p, buildings).status !== docStatusFilter
      )
        return false;
      if (regionFilter === "lagos" && isOutsideLagos(p)) return false;
      if (regionFilter === "outside" && !isOutsideLagos(p)) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        // Exact street address isn't on the list doc (gated subdoc) — match on
        // the area-level fields + title + landlord.
        return (
          p.title.toLowerCase().includes(q) ||
          p.city.toLowerCase().includes(q) ||
          p.state.toLowerCase().includes(q) ||
          (p.landlordName && p.landlordName.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [properties, buildings, typeFilter, docStatusFilter, regionFilter, searchQuery]);

  // ── Doc actions ──────────────────────────────────────────────────────────
  // For a grouped unit the C of O lives on the building: verifying/rejecting
  // targets the building doc (covering EVERY unit), and the unit being reviewed
  // is published/hidden alongside. Standalone listings keep their own doc.

  // All three review verdicts now go through the adminReviewPropertyDoc CF so
  // each one lands in the immutable admin_audit_log (the CF derives the building
  // link server-side and writes property + building atomically).
  const reviewDoc = async (
    property: Property,
    action: "verify" | "reject" | "publish",
    reason?: string
  ) => {
    if (!canWrite || processing.has(property.id)) return;
    setProcessing((s) => new Set(s).add(property.id));
    try {
      const fn = httpsCallable<
        { propertyId: string; action: string; reason?: string },
        { success: boolean }
      >(functions, "adminReviewPropertyDoc");
      await fn({ propertyId: property.id, action, ...(reason ? { reason } : {}) });
      if (selectedProperty?.id === property.id) setSelectedProperty(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Action failed. Please try again.");
    } finally {
      setProcessing((s) => { const n = new Set(s); n.delete(property.id); return n; });
    }
  };

  const verifyDoc = (property: Property) => reviewDoc(property, "verify");
  const rejectDoc = (property: Property, reason: string) =>
    reviewDoc(property, "reject", reason);

  // Publish a grouped unit whose building C of O is already verified — ownership
  // is settled, this is the per-unit listing approval.
  const publishUnit = async (property: Property) => {
    await reviewDoc(property, "publish");
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-display font-bold text-[rgb(var(--text-primary))]">
          Properties
        </h1>
        <p className="text-sm text-[rgb(var(--text-secondary))] mt-1">
          {totalCount} total · {availableCount} available
          {pendingDocCount > 0 && (
            <span className="text-amber-500 font-medium">
              {" "}· {pendingDocCount} doc{pendingDocCount !== 1 ? "s" : ""} pending review
            </span>
          )}
        </p>
      </div>

      {/* Pending docs banner */}
      {pendingDocCount > 0 && (
        <div
          className="card border-amber-500/30 bg-amber-500/5 flex items-start gap-3 cursor-pointer hover:bg-amber-500/10 transition-colors"
          onClick={() => setDocStatusFilter("pending")}
        >
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
            <FileText size={18} className="text-amber-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">
              {pendingDocCount} ownership document{pendingDocCount !== 1 ? "s" : ""} awaiting review
            </p>
            <p className="text-xs text-[rgb(var(--text-secondary))] mt-0.5">
              Tap to filter — verify or reject each landlord's C of O / deed before their property goes live.
            </p>
          </div>
        </div>
      )}

      {/* Type filter chips */}
      <div className="flex flex-wrap gap-2">
        {(["all", ...Object.keys(TYPE_LABELS)] as TypeFilter[]).map((t) => {
          const count = t === "all" ? totalCount : properties.filter((p) => p.propertyType === t).length;
          return (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn(
                "px-3 py-1.5 rounded-xl text-sm font-medium transition-all border",
                typeFilter === t
                  ? "bg-[rgb(var(--brand))]/10 text-[rgb(var(--brand))] border-[rgb(var(--brand))]/30"
                  : "bg-[rgb(var(--surface))] text-[rgb(var(--text-secondary))] border-[rgb(var(--border))] hover:border-[rgb(var(--text-hint))]"
              )}
            >
              {t === "all" ? "All" : TYPE_LABELS[t] ?? capitalize(t)}
              <span className="ml-1.5 text-xs opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Search + doc status filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[rgb(var(--text-hint))]" />
          <input
            type="text"
            placeholder="Search by title, city, state, or landlord..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input pl-10"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgb(var(--text-hint))] hover:text-[rgb(var(--text-secondary))]">
              <X size={14} />
            </button>
          )}
        </div>
        <select
          value={docStatusFilter}
          onChange={(e) => setDocStatusFilter(e.target.value as DocStatusFilter)}
          className="input w-auto min-w-[200px] cursor-pointer"
        >
          <option value="all">All Doc Statuses</option>
          <option value="pending">Doc Pending Review</option>
          <option value="verified">Doc Verified</option>
          <option value="rejected">Doc Rejected</option>
          <option value="none">No Doc Uploaded</option>
        </select>
        {/* Where we operate. Nothing blocks an out-of-state listing at write
            time — this queue is the gate, so it has to be findable. */}
        <select
          value={regionFilter}
          onChange={(e) => setRegionFilter(e.target.value as RegionFilter)}
          className="input w-auto min-w-[180px] cursor-pointer"
        >
          <option value="all">All States</option>
          <option value="lagos">Lagos</option>
          <option value="outside">Outside Lagos ({outsideLagosCount})</option>
        </select>
      </div>

      {/* Grid / List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-[rgb(var(--brand))]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16">
          <Building2 size={40} className="mx-auto text-[rgb(var(--text-hint))] mb-4" />
          <p className="text-[rgb(var(--text-secondary))] font-medium">No properties found</p>
          <p className="text-sm text-[rgb(var(--text-hint))] mt-1">
            {searchQuery ? "Try a different search term" : "Adjust your filters"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((property) => (
            <PropertyCard
              key={property.id}
              property={property}
              docInfo={resolveDoc(property, buildings)}
              canWrite={canWrite}
              processing={processing.has(property.id)}
              onView={() => setSelectedProperty(property)}
              onVerifyDoc={() => verifyDoc(property)}
            />
          ))}
        </div>
      )}

      {/* Detail panel */}
      {selectedProperty && (
        <PropertyDetailPanel
          property={selectedProperty}
          siblings={properties}
          docInfo={resolveDoc(selectedProperty, buildings)}
          canWrite={canWrite}
          processing={processing.has(selectedProperty.id)}
          onClose={() => setSelectedProperty(null)}
          onVerifyDoc={() => verifyDoc(selectedProperty)}
          onRejectDoc={(reason) => rejectDoc(selectedProperty, reason)}
          onPublish={() => publishUnit(selectedProperty)}
        />
      )}
    </div>
  );
}

// ─── Property Card ────────────────────────────────────────────────────────────

function PropertyCard({
  property,
  docInfo,
  canWrite,
  processing,
  onView,
  onVerifyDoc,
}: {
  property: Property;
  docInfo: DocInfo;
  canWrite: boolean;
  processing: boolean;
  onView: () => void;
  onVerifyDoc: () => void;
}) {
  const hasPendingDoc = docInfo.status === "pending";

  return (
    <div
      className={cn(
        "card p-0 overflow-hidden cursor-pointer hover:border-[rgb(var(--text-hint))]/40 transition-all group",
        hasPendingDoc && "border-amber-500/30"
      )}
      onClick={onView}
    >
      {/* Image */}
      <div className="relative h-40 bg-[rgb(var(--background))]">
        {property.images[0] ? (
          <img
            src={property.images[0]}
            alt={property.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Building2 size={32} className="text-[rgb(var(--text-hint))]" />
          </div>
        )}
        {/* Badges overlaid on image */}
        <div className="absolute top-2 left-2 flex gap-1.5">
          <AvailabilityBadge available={property.isAvailable} docStatus={docInfo.status} />
        </div>
        <div className="absolute top-2 right-2 flex gap-1.5">
          {/* We operate in Lagos. Nothing stops this being listed, so the
              reviewer has to see it before approving. */}
          {isOutsideLagos(property) && (
            <span className="badge-warning gap-1 text-[10px]">
              <MapPin size={10} /> {property.state}
            </span>
          )}
          {docInfo.building && (
            <span className="badge bg-black/50 text-white border-0 gap-1 text-[10px] backdrop-blur-sm">
              <Building2 size={10} /> In building
            </span>
          )}
          <DocStatusBadge status={docInfo.status} />
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-[rgb(var(--text-primary))] truncate">
            {property.title}
          </p>
          {/* Which unit, in which building — two units of the same shape in one
              compound are otherwise identical cards. */}
          {docInfo.building && (
            <div className="flex items-center gap-1 mt-0.5">
              <Building2 size={11} className="text-[rgb(var(--text-hint))] shrink-0" />
              <p className="text-xs text-[rgb(var(--text-hint))] truncate">
                {[unitDescriptor(property), buildingContext(docInfo.building)]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          )}
          <div className="flex items-center gap-1 mt-0.5">
            <MapPin size={11} className="text-[rgb(var(--text-hint))] shrink-0" />
            <p className="text-xs text-[rgb(var(--text-hint))] truncate">
              {/* Exact street address lives in the gated private/location
                  subdoc — the list shows area-level only (fetched per-property
                  in the detail panel). */}
              {[property.city, property.state].filter(Boolean).join(", ")}
            </p>
          </div>
        </div>

        {/* Specs row */}
        <div className="flex items-center gap-3 text-xs text-[rgb(var(--text-secondary))]">
          <span className="flex items-center gap-1">
            <BedDouble size={12} /> {property.bedrooms} bed
          </span>
          <span className="flex items-center gap-1">
            <Bath size={12} /> {property.bathrooms} bath
          </span>
          <span className="flex items-center gap-1">
            <Users size={12} /> {property.currentTenantsCount || 0}/{property.maxTenants}
          </span>
          <span className="ml-auto font-semibold font-mono text-[rgb(var(--text-primary))]">
            {formatNaira(property.rent)}
            <span className="font-normal text-[rgb(var(--text-hint))]">
              /{property.rentFrequency === "yearly" ? "yr" : "mo"}
            </span>
          </span>
        </div>

        {/* Landlord */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-[rgb(var(--text-hint))]">
            <User size={11} />
            <span className="truncate max-w-[140px]">
              {property.landlordName || "Unknown landlord"}
            </span>
          </div>
          <span className="text-[10px] text-[rgb(var(--text-hint))]">
            {property.createdAt ? timeAgo(property.createdAt) : ""}
          </span>
        </div>

        {/* Quick verify action for pending docs */}
        {canWrite && hasPendingDoc && (
          <div
            className="flex items-center gap-2 pt-1 border-t border-[rgb(var(--border))]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs text-amber-500 flex-1">
              {docInfo.building
                ? `Building C of O pending · ${docInfo.building.name}`
                : "Doc pending review"}
            </p>
            <button
              onClick={onVerifyDoc}
              disabled={processing}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
            >
              {processing ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={11} />}
              Verify
            </button>
            <button
              // Opens the detail panel, which holds the document viewer and the
              // rejection-reason form. This was an empty handler, and because
              // the wrapper stops propagation it also blocked the card's own
              // click — so the button did nothing at all.
              onClick={onView}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/10 text-red-500 text-xs font-semibold hover:bg-red-500/20 transition-colors"
            >
              <Eye size={11} />
              Review
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function PropertyDetailPanel({
  property,
  siblings,
  docInfo,
  canWrite,
  processing,
  onClose,
  onVerifyDoc,
  onRejectDoc,
  onPublish,
}: {
  property: Property;
  /** Every property in the list, so a compound's buildings can be DERIVED from
   *  the units actually listed rather than stated up front and going stale. */
  siblings: Property[];
  docInfo: DocInfo;
  canWrite: boolean;
  processing: boolean;
  onClose: () => void;
  onVerifyDoc: () => void;
  onRejectDoc: (reason: string) => void;
  onPublish: () => void;
}) {
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [loadingDoc, setLoadingDoc] = useState(false);

  // The exact street address lives in the gated `properties/{id}/private/location`
  // subdoc (reveal-on-approval, Phase 2b). Admin is entitled — fetch it for the
  // detail view. Falls back to area-level while loading / if absent.
  const [exactAddress, setExactAddress] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setExactAddress(null);
    getDoc(doc(db, "properties", property.id, "private", "location"))
      .then((snap) => {
        if (!active) return;
        const addr = snap.data()?.address;
        if (typeof addr === "string" && addr.length > 0) setExactAddress(addr);
      })
      .catch(() => {
        /* not entitled / absent — leave area-level */
      });
    return () => {
      active = false;
    };
  }, [property.id]);

  // Ownership docs are private. New ones are Storage paths streamed through the
  // authenticated route (token never in a URL); legacy Cloudinary docs are
  // public http URLs opened directly.
  const openDoc = async (urlOrPath: string) => {
    if (/^https?:\/\//i.test(urlOrPath)) {
      window.open(urlOrPath, "_blank", "noopener,noreferrer");
      return;
    }
    setLoadingDoc(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) return;
      const res = await fetch(
        `/api/verification-image?path=${encodeURIComponent(urlOrPath)}`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      if (!res.ok) {
        console.error("Failed to load document:", res.status);
        return;
      }
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("Error loading document:", err);
    } finally {
      setLoadingDoc(false);
    }
  };

  const isPendingDoc = docInfo.status === "pending";
  const grouped = !!docInfo.building;
  // No document at all. Approving is impossible — there is nothing to approve —
  // but REJECTING is the only way to tell the landlord to upload one, and
  // without it these listings sat here with no action available to anyone.
  const isMissingDoc =
    !grouped && (docInfo.status === "none" || !docInfo.url);

  // A compound is LAND: one C of O can cover a duplex and a bungalow side by
  // side. The landlord is never asked how many buildings are on it — the
  // number is DERIVED from the units, so it cannot disagree with what was
  // actually listed. Empty for any other structure, which IS one building.
  const compoundBuildings = useMemo(() => {
    if (!grouped || docInfo.building?.structure !== "compound") return [];
    const counts = new Map<string, number>();
    for (const p of siblings) {
      if (p.buildingId !== property.buildingId) continue;
      if (!p.unitBuildingStructure) continue;
      const key = `${p.unitBuildingStructure}|${p.unitBuildingLabel ?? ""}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    // Array.from, not a spread: the tsconfig target predates ES2015 iterators,
    // so spreading a Map iterator fails the production type check.
    return Array.from(counts.entries()).map(([key, units]) => {
      const [structure, label] = key.split("|");
      return {
        name: `${STRUCTURE_LABELS[structure] ?? structure}${label ? ` ${label}` : ""}`,
        units,
      };
    });
  }, [grouped, docInfo.building, siblings, property.buildingId]);
  // Grouped unit whose building C of O is already verified but which hasn't
  // been published yet — ownership is settled, only per-unit approval remains.
  const needsPublish =
    grouped && docInfo.status === "verified" && !property.isAvailable;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-full max-w-md z-50 bg-[rgb(var(--surface))] border-l border-[rgb(var(--border))] shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[rgb(var(--surface))] border-b border-[rgb(var(--border))] px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-display font-semibold text-[rgb(var(--text-primary))]">
            Property Details
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[rgb(var(--background))] transition-colors">
            <X size={18} className="text-[rgb(var(--text-secondary))]" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Image */}
          {property.images[0] && (
            <div className="rounded-xl overflow-hidden h-44 bg-[rgb(var(--background))]">
              <img src={property.images[0]} alt={property.title} className="w-full h-full object-cover" />
            </div>
          )}

          {/* Title + badges */}
          <div>
            <h3 className="text-lg font-semibold text-[rgb(var(--text-primary))]">
              {property.title}
            </h3>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="badge bg-[rgb(var(--background))] text-[rgb(var(--text-secondary))] border border-[rgb(var(--border))]">
                {TYPE_LABELS[property.propertyType] ?? capitalize(property.propertyType)}
              </span>
              <AvailabilityBadge available={property.isAvailable} docStatus={docInfo.status} />
              <DocStatusBadge status={docInfo.status} />
              {isOutsideLagos(property) && (
                <span className="badge-warning gap-1 text-[10px]">
                  <MapPin size={10} /> Outside Lagos
                </span>
              )}
              {property.readyForInspections ? (
                <span className="badge-success gap-1 text-[10px]">
                  <CheckCircle2 size={10} /> Vetted
                </span>
              ) : (
                <span className="badge-warning gap-1 text-[10px]">
                  <Clock size={10} /> Not vetted
                </span>
              )}
              {grouped && (
                <span className="badge bg-[rgb(var(--brand))]/10 text-[rgb(var(--brand))] border border-[rgb(var(--brand))]/20 gap-1 text-[10px]">
                  <Building2 size={10} /> {buildingContext(docInfo.building!)}
                </span>
              )}
            </div>
          </div>

          {/* Location */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">Location</h4>
            <DetailRow
              icon={MapPin}
              label="Address"
              value={
                exactAddress ??
                (property.address ||
                  [property.city, property.state].filter(Boolean).join(", "))
              }
            />
            <DetailRow icon={MapPin} label="City" value={`${property.city}, ${property.state}`} />
            {/* Says what the reviewer is actually deciding. The state is
                derived from the landlord's map pin, not typed, so it is not a
                typo — it is a real address outside where we operate. */}
            {isOutsideLagos(property) && (
              <div className="rounded-lg border border-[rgb(var(--warning))]/30 bg-[rgb(var(--warning))]/10 p-3 text-xs text-[rgb(var(--text-secondary))]">
                <span className="font-medium text-[rgb(var(--text-primary))]">
                  This property is in {property.state}, not Lagos.
                </span>{" "}
                We operate in Lagos today, so approving it publishes a listing
                we may not be able to service: agents register Lagos areas, and
                the tenant area filter is a Lagos list. The inspection fee is
                flat, so that part still works. Approve only if we intend to
                cover {property.state}.
              </div>
            )}
          </div>

          {/* Specs */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">Details</h4>
            {grouped && unitDescriptor(property) && (
              <DetailRow icon={Building2} label="Unit" value={unitDescriptor(property)} />
            )}
            {/* Counts and sharing are independent. Counts say what is present
                and are real for anything but a single space; sharing says who
                else uses it and is real for any grouped unit, whatever its
                type — a self contain in a compound can still share a toilet. */}
            {!(grouped && isSingleSpace(property.propertyType)) && (
              <>
                <DetailRow icon={BedDouble} label="Bedrooms" value={`${property.bedrooms}`} />
                <DetailRow icon={Bath} label="Bathrooms" value={`${property.bathrooms}`} />
              </>
            )}
            {grouped && (
              <>
                <DetailRow icon={Bath} label="Bathroom" value={accessLabel(property.bathroomAccess)} />
                <DetailRow icon={Bath} label="Toilet" value={accessLabel(property.toiletAccess)} />
                <DetailRow icon={Home} label="Kitchen" value={accessLabel(property.kitchenAccess)} />
                <DetailRow icon={Home} label="Living room" value={accessLabel(property.livingRoomAccess)} />
              </>
            )}
            {compoundBuildings.length > 0 && (
              <DetailRow
                icon={Building2}
                label="On this land"
                value={compoundBuildings
                  .map((b) => `${b.name} (${b.units})`)
                  .join(", ")}
              />
            )}
            {grouped && property.unitBuildingStructure && (
              <DetailRow
                icon={Building2}
                label="Building"
                value={`${
                  STRUCTURE_LABELS[property.unitBuildingStructure] ??
                  property.unitBuildingStructure
                }${
                  property.unitBuildingLabel ? ` ${property.unitBuildingLabel}` : ""
                }`}
              />
            )}
            <DetailRow icon={Users} label="Occupancy" value={`${property.currentTenantsCount || 0} / ${property.maxTenants} tenants`} />
            <DetailRow icon={Home} label="Rent" value={`${formatNaira(property.rent)} / ${property.rentFrequency === "yearly" ? "year" : "month"}`} />
            <DetailRow
              icon={User}
              label="Inspection"
              value={
                property.inspectionHandler === "agent"
                  ? `Agent: ${property.assignedAgentName || "Assigned"}`
                  : property.inspectionHandler === "caretaker"
                    ? `Caretaker: ${property.caretakerName || "Appointed"}`
                    : "Self-handled"
              }
            />
            {/* Who is actually acting on this unit. A dispute over an issue, a
                maintenance record or a tenant message may have been handled by
                the caretaker rather than the owner, so an adjudicating admin
                needs to see that this listing is managed by someone else. */}
            {property.caretakerId && (
              <DetailRow
                icon={User}
                label="Caretaker"
                value={property.caretakerName || "Appointed"}
              />
            )}
          </div>

          {/* Landlord */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">Landlord</h4>
            <DetailRow icon={User} label="Name" value={property.landlordName || "Unknown"} />
            {property.landlordPhone && (
              <DetailRow icon={User} label="Phone" value={property.landlordPhone} />
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-[rgb(var(--background))] text-center">
              <p className="text-xl font-bold text-[rgb(var(--text-primary))]">{property.viewCount}</p>
              <p className="text-xs text-[rgb(var(--text-hint))] mt-0.5">Views</p>
            </div>
            <div className="p-3 rounded-xl bg-[rgb(var(--background))] text-center">
              <p className="text-xl font-bold text-[rgb(var(--text-primary))]">{property.inquiryCount}</p>
              <p className="text-xs text-[rgb(var(--text-hint))] mt-0.5">Inquiries</p>
            </div>
          </div>

          {/* Ownership doc */}
          <div className="space-y-3">
            <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
              Ownership Document
            </h4>

            {grouped && (
              <div className="p-3 rounded-xl bg-[rgb(var(--brand))]/5 border border-[rgb(var(--brand))]/20 flex items-start gap-2">
                <Building2 size={14} className="text-[rgb(var(--brand))] mt-0.5 shrink-0" />
                <p className="text-xs text-[rgb(var(--text-secondary))]">
                  Shared C of O for <span className="font-medium text-[rgb(var(--text-primary))]">{docInfo.building!.name}</span>.
                  Verifying or rejecting it applies to <span className="font-medium">every unit</span> in this building.
                </p>
              </div>
            )}

            {docInfo.status === "none" || !docInfo.url ? (
              <div className="p-4 rounded-xl bg-[rgb(var(--background))] border border-[rgb(var(--border))] text-center">
                <FileText size={24} className="mx-auto text-[rgb(var(--text-hint))] mb-2" />
                <p className="text-sm text-[rgb(var(--text-hint))]">No document uploaded</p>
              </div>
            ) : (
              <>
                <div className="p-3 rounded-xl bg-[rgb(var(--background))] border border-[rgb(var(--border))]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-[rgb(var(--text-secondary))]">
                      {docInfo.type === "c_of_o" ? "Certificate of Occupancy" :
                       docInfo.type === "deed" ? "Deed of Assignment" : "Property Document"}
                    </span>
                    <DocStatusBadge status={docInfo.status} />
                  </div>
                  <button
                    onClick={() => docInfo.url && openDoc(docInfo.url)}
                    disabled={loadingDoc}
                    className="flex items-center gap-1.5 text-xs text-[rgb(var(--brand))] hover:underline disabled:opacity-50"
                  >
                    {loadingDoc ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
                    Open document
                  </button>
                </div>

                {/* Rejection reason */}
                {docInfo.status === "rejected" && docInfo.rejectionReason && (
                  <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/20">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle size={13} className="text-red-500" />
                      <span className="text-xs font-semibold text-red-500">Rejection Reason</span>
                    </div>
                    <p className="text-sm text-[rgb(var(--text-secondary))]">{docInfo.rejectionReason}</p>
                  </div>
                )}

                {/* Per-unit publish: building doc already verified, unit hidden */}
                {canWrite && needsPublish && (
                  <button
                    onClick={onPublish}
                    disabled={processing}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 transition-colors disabled:opacity-50"
                  >
                    {processing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    Publish this unit
                  </button>
                )}

                {/* Actions for pending docs */}
                {canWrite && isPendingDoc && !showRejectForm && (
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={onVerifyDoc}
                      disabled={processing}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 transition-colors disabled:opacity-50"
                    >
                      {processing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                      {grouped ? "Verify C of O & Publish unit" : "Approve & Publish"}
                    </button>
                    <button
                      onClick={() => setShowRejectForm(true)}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-500/30 text-red-500 text-sm font-semibold hover:bg-red-500/5 transition-colors"
                    >
                      <XCircle size={14} />
                      {grouped ? "Reject C of O" : "Reject Doc"}
                    </button>
                  </div>
                )}

                {canWrite && isMissingDoc && !showRejectForm && (
                  <div className="pt-1">
                    <button
                      onClick={() => setShowRejectForm(true)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-500/30 text-red-500 text-sm font-semibold hover:bg-red-500/5 transition-colors"
                    >
                      <XCircle size={14} />
                      Ask for the document
                    </button>
                  </div>
                )}

                {canWrite && (isPendingDoc || isMissingDoc) && showRejectForm && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-[rgb(var(--text-primary))]">Reason for rejection</p>
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Explain why this document is being rejected..."
                      rows={3}
                      className="input w-full resize-none text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setShowRejectForm(false); setRejectReason(""); }}
                        className="flex-1 py-2.5 rounded-xl border border-[rgb(var(--border))] text-sm text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))] transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => { if (rejectReason.trim()) onRejectDoc(rejectReason.trim()); }}
                        disabled={!rejectReason.trim() || processing}
                        className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-50"
                      >
                        {processing ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Confirm Rejection"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Shared Components ────────────────────────────────────────────────────────

function AvailabilityBadge({ available, docStatus }: { available: boolean; docStatus?: string }) {
  if (available) {
    return (
      <span className="badge-success gap-1 text-[10px]">
        <CheckCircle2 size={10} /> Available
      </span>
    );
  }
  if (docStatus && docStatus !== "verified") {
    return (
      <span className="badge-warning gap-1 text-[10px]">
        <Clock size={10} /> Pending Review
      </span>
    );
  }
  return (
    <span className="badge-neutral gap-1 text-[10px]">
      <XCircle size={10} /> Unavailable
    </span>
  );
}

function DocStatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: any; label: string }> = {
    verified: { cls: "badge-success", icon: ShieldCheck, label: "Doc Verified" },
    pending: { cls: "badge-warning", icon: Clock, label: "Doc Pending" },
    rejected: { cls: "badge-error", icon: ShieldOff, label: "Doc Rejected" },
    none: { cls: "badge-neutral", icon: FileText, label: "No Doc" },
  };
  const cfg = map[status] || map.none;
  return (
    <span className={cn(cfg.cls, "gap-1 text-[10px]")}>
      <cfg.icon size={10} />
      {cfg.label}
    </span>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-[rgb(var(--background))] flex items-center justify-center shrink-0">
        <Icon size={14} className="text-[rgb(var(--text-hint))]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-[rgb(var(--text-hint))]">{label}</p>
        <p className="text-sm text-[rgb(var(--text-primary))] truncate">{value}</p>
      </div>
    </div>
  );
}