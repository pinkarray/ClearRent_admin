"use client";

import { useEffect, useState, useMemo } from "react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
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

type TypeFilter = "all" | "flat" | "duplex" | "selfContain" | "bungalow" | "room" | "shop" | "office";
type DocStatusFilter = "all" | "pending" | "verified" | "rejected" | "none";

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
  ownershipDocStatus: string; // none | pending | verified | rejected
  ownershipDocRejectionReason?: string;
  // Stats
  viewCount: number;
  inquiryCount: number;
  // Inspection
  inspectionHandler: string;
  assignedAgentName?: string;
  createdAt: Date;
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PropertiesPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [docStatusFilter, setDocStatusFilter] = useState<DocStatusFilter>("all");
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
          viewCount: data.viewCount || 0,
          inquiryCount: data.inquiryCount || 0,
          inspectionHandler: data.inspectionHandler || "self",
          assignedAgentName: data.assignedAgentName,
          createdAt: parseTimestamp(data.createdAt) || new Date(),
        };
      });
      setProperties(parsed);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // ── Counts ─────────────────────────────────────────────────────────────────

  const pendingDocCount = properties.filter(
    (p) => p.ownershipDocStatus === "pending"
  ).length;
  const totalCount = properties.length;
  const availableCount = properties.filter((p) => p.isAvailable).length;

  // ── Filtering ──────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return properties.filter((p) => {
      if (typeFilter !== "all" && p.propertyType !== typeFilter) return false;
      if (docStatusFilter !== "all" && p.ownershipDocStatus !== docStatusFilter)
        return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          p.title.toLowerCase().includes(q) ||
          p.address.toLowerCase().includes(q) ||
          p.city.toLowerCase().includes(q) ||
          (p.landlordName && p.landlordName.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [properties, typeFilter, docStatusFilter, searchQuery]);

  // ── Doc actions ────────────────────────────────────────────────────────────

  const verifyDoc = async (property: Property) => {
    if (processing.has(property.id)) return;
    setProcessing((s) => new Set(s).add(property.id));
    try {
      await updateDoc(doc(db, "properties", property.id), {
        ownershipDocStatus: "verified",
        isVerified: true,
        isAvailable: true, // Approving doc = publishing the listing
        updatedAt: serverTimestamp(),
      });
      if (selectedProperty?.id === property.id) setSelectedProperty(null);
    } finally {
      setProcessing((s) => { const n = new Set(s); n.delete(property.id); return n; });
    }
  };

  const rejectDoc = async (property: Property, reason: string) => {
    if (processing.has(property.id)) return;
    setProcessing((s) => new Set(s).add(property.id));
    try {
      await updateDoc(doc(db, "properties", property.id), {
        ownershipDocStatus: "rejected",
        isVerified: false,
        isAvailable: false, // Rejected = stays hidden
        ownershipDocRejectionReason: reason,
        updatedAt: serverTimestamp(),
      });
      if (selectedProperty?.id === property.id) setSelectedProperty(null);
    } finally {
      setProcessing((s) => { const n = new Set(s); n.delete(property.id); return n; });
    }
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
        {(["all", "flat", "duplex", "selfContain", "bungalow", "room", "shop", "office"] as TypeFilter[]).map((t) => {
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
              {t === "all" ? "All" : t === "selfContain" ? "Self Contain" : capitalize(t)}
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
            placeholder="Search by title, address, city, or landlord..."
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
          processing={processing.has(selectedProperty.id)}
          onClose={() => setSelectedProperty(null)}
          onVerifyDoc={() => verifyDoc(selectedProperty)}
          onRejectDoc={(reason) => rejectDoc(selectedProperty, reason)}
        />
      )}
    </div>
  );
}

// ─── Property Card ────────────────────────────────────────────────────────────

function PropertyCard({
  property,
  processing,
  onView,
  onVerifyDoc,
}: {
  property: Property;
  processing: boolean;
  onView: () => void;
  onVerifyDoc: () => void;
}) {
  const hasPendingDoc = property.ownershipDocStatus === "pending";

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
          <AvailabilityBadge available={property.isAvailable} docStatus={property.ownershipDocStatus} />
        </div>
        <div className="absolute top-2 right-2">
          <DocStatusBadge status={property.ownershipDocStatus} />
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-[rgb(var(--text-primary))] truncate">
            {property.title}
          </p>
          <div className="flex items-center gap-1 mt-0.5">
            <MapPin size={11} className="text-[rgb(var(--text-hint))] shrink-0" />
            <p className="text-xs text-[rgb(var(--text-hint))] truncate">
              {property.address}, {property.city}
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
        {hasPendingDoc && (
          <div
            className="flex items-center gap-2 pt-1 border-t border-[rgb(var(--border))]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs text-amber-500 flex-1">Doc pending review</p>
            <button
              onClick={onVerifyDoc}
              disabled={processing}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
            >
              {processing ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={11} />}
              Verify
            </button>
            <button
              onClick={() => {}} // opens panel for rejection reason
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
  processing,
  onClose,
  onVerifyDoc,
  onRejectDoc,
}: {
  property: Property;
  processing: boolean;
  onClose: () => void;
  onVerifyDoc: () => void;
  onRejectDoc: (reason: string) => void;
}) {
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const isPendingDoc = property.ownershipDocStatus === "pending";

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
                {property.propertyType === "selfContain" ? "Self Contain" : capitalize(property.propertyType)}
              </span>
              <AvailabilityBadge available={property.isAvailable} docStatus={property.ownershipDocStatus} />
              <DocStatusBadge status={property.ownershipDocStatus} />
            </div>
          </div>

          {/* Location */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">Location</h4>
            <DetailRow icon={MapPin} label="Address" value={property.address} />
            <DetailRow icon={MapPin} label="City" value={`${property.city}, ${property.state}`} />
          </div>

          {/* Specs */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">Details</h4>
            <DetailRow icon={BedDouble} label="Bedrooms" value={`${property.bedrooms}`} />
            <DetailRow icon={Bath} label="Bathrooms" value={`${property.bathrooms}`} />
            <DetailRow icon={Users} label="Occupancy" value={`${property.currentTenantsCount || 0} / ${property.maxTenants} tenants`} />
            <DetailRow icon={Home} label="Rent" value={`${formatNaira(property.rent)} / ${property.rentFrequency === "yearly" ? "year" : "month"}`} />
            <DetailRow icon={User} label="Inspection" value={property.inspectionHandler === "agent" ? `Agent: ${property.assignedAgentName || "Assigned"}` : "Self-handled"} />
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
            {property.ownershipDocStatus === "none" || !property.ownershipDocUrl ? (
              <div className="p-4 rounded-xl bg-[rgb(var(--background))] border border-[rgb(var(--border))] text-center">
                <FileText size={24} className="mx-auto text-[rgb(var(--text-hint))] mb-2" />
                <p className="text-sm text-[rgb(var(--text-hint))]">No document uploaded</p>
              </div>
            ) : (
              <>
                <div className="p-3 rounded-xl bg-[rgb(var(--background))] border border-[rgb(var(--border))]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-[rgb(var(--text-secondary))]">
                      {property.ownershipDocType === "c_of_o" ? "Certificate of Occupancy" :
                       property.ownershipDocType === "deed" ? "Deed of Assignment" : "Property Document"}
                    </span>
                    <DocStatusBadge status={property.ownershipDocStatus} />
                  </div>
                  <a
                    href={property.ownershipDocUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-[rgb(var(--brand))] hover:underline"
                  >
                    <ExternalLink size={12} />
                    Open document
                  </a>
                </div>

                {/* Rejection reason */}
                {property.ownershipDocStatus === "rejected" && property.ownershipDocRejectionReason && (
                  <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/20">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle size={13} className="text-red-500" />
                      <span className="text-xs font-semibold text-red-500">Rejection Reason</span>
                    </div>
                    <p className="text-sm text-[rgb(var(--text-secondary))]">{property.ownershipDocRejectionReason}</p>
                  </div>
                )}

                {/* Actions for pending docs */}
                {isPendingDoc && !showRejectForm && (
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={onVerifyDoc}
                      disabled={processing}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 transition-colors disabled:opacity-50"
                    >
                      {processing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                      Approve & Publish
                    </button>
                    <button
                      onClick={() => setShowRejectForm(true)}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-500/30 text-red-500 text-sm font-semibold hover:bg-red-500/5 transition-colors"
                    >
                      <XCircle size={14} />
                      Reject Doc
                    </button>
                  </div>
                )}

                {isPendingDoc && showRejectForm && (
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