"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, query, where, onSnapshot, Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Loader2,
  Clock,
  Home,
  User,
  ShieldQuestion,
  Gavel,
  CheckCircle2,
  Hourglass,
} from "lucide-react";

// ─── Rent Attention (money-flow gaps G1/G3/G4) ───────────────────────────────
// Surfaces the two rent states where money is stuck and a human needs to act:
//   • Stranded — tenant paid + admin-verified, but the landlord never accepted
//     (rental_interests at payment_verified). The strand sweep flags the aged
//     ones; admin chases the landlord or refunds the tenant out-of-band.
//   • Disputed — the tenant is disputing the tenancy agreement (active_rentals
//     agreementStatus == disputed). The payout gate HOLDS the landlord/agent
//     money until resolved; admin can force-finalize once settled.

interface Stranded {
  id: string;
  tenantId: string;
  tenantName: string;
  landlordId: string;
  landlordName: string;
  propertyTitle: string;
  rentAmount: number;
  verifiedAt: Date | null;
  strandedForReview: boolean;
}

interface Disputed {
  id: string;
  tenantId: string;
  tenantName: string;
  landlordId: string;
  landlordName: string;
  propertyTitle: string;
  disputeReason: string;
  landlordPayout: number;
  landlordPayoutStatus: string;
}

function toDate(v: unknown): Date | null {
  return v instanceof Timestamp ? v.toDate() : null;
}

function daysSince(d: Date | null): number {
  if (!d) return 0;
  return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
}

function naira(n: number) {
  return `₦${(n || 0).toLocaleString("en-NG")}`;
}

export default function RentAttentionPage() {
  const router = useRouter();
  const [stranded, setStranded] = useState<Stranded[]>([]);
  const [disputed, setDisputed] = useState<Disputed[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubStranded = onSnapshot(
      query(collection(db, "rental_interests"), where("status", "==", "payment_verified")),
      (snap) => {
        setStranded(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              tenantId: (x.tenantId as string) ?? "",
              tenantName: (x.tenantName as string) || "Tenant",
              landlordId: (x.landlordId as string) ?? "",
              landlordName: (x.landlordName as string) || "Landlord",
              propertyTitle: (x.propertyTitle as string) || "Property",
              rentAmount: (x.rentAmount as number) ?? (x.paymentAmount as number) ?? 0,
              verifiedAt: toDate(x.paymentVerifiedAt) ?? toDate(x.updatedAt),
              strandedForReview: x.strandedForReview === true,
            };
          })
        );
        setLoading(false);
      },
      () => setLoading(false)
    );

    const unsubDisputed = onSnapshot(
      query(collection(db, "active_rentals"), where("agreementStatus", "==", "disputed")),
      (snap) => {
        setDisputed(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              tenantId: (x.tenantId as string) ?? "",
              tenantName: (x.tenantName as string) || "Tenant",
              landlordId: (x.landlordId as string) ?? "",
              landlordName: (x.landlordName as string) || "Landlord",
              propertyTitle: (x.propertyTitle as string) || "Property",
              disputeReason: (x.tenantDisputeReason as string) || "No reason given",
              landlordPayout: (x.landlordPayout as number) ?? 0,
              landlordPayoutStatus: (x.landlordPayoutStatus as string) ?? "pending",
            };
          })
        );
      },
      () => {}
    );

    return () => {
      unsubStranded();
      unsubDisputed();
    };
  }, []);

  // Stranded first by longest-waiting; flagged ones float up.
  const strandedSorted = useMemo(
    () =>
      [...stranded].sort(
        (a, b) =>
          Number(b.strandedForReview) - Number(a.strandedForReview) ||
          (a.verifiedAt?.getTime() ?? 0) - (b.verifiedAt?.getTime() ?? 0)
      ),
    [stranded]
  );

  const flaggedCount = stranded.filter((s) => s.strandedForReview).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl lg:text-3xl font-display font-bold text-[rgb(var(--text-primary))]">
          Rent Attention
        </h1>
        <p className="text-sm text-[rgb(var(--text-secondary))] mt-1">
          Rentals where money is stuck and needs a human: tenants who paid but
          the landlord never accepted, and disputed agreements holding a payout.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatTile label="Awaiting landlord" value={stranded.length} tone="amber" icon={Hourglass} />
        <StatTile label="Stranded (flagged)" value={flaggedCount} tone="red" icon={AlertTriangle} />
        <StatTile label="Disputed (payout held)" value={disputed.length} tone="red" icon={Gavel} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-[rgb(var(--brand))]" />
        </div>
      ) : (
        <div className="space-y-8">
          {/* Stranded */}
          <section className="space-y-3">
            <SectionHeader
              icon={Hourglass}
              title="Paid — awaiting landlord acceptance"
              count={strandedSorted.length}
            />
            {strandedSorted.length === 0 ? (
              <EmptyNote text="No tenants waiting on a landlord right now." />
            ) : (
              strandedSorted.map((s) => (
                <StrandedCard key={s.id} item={s} router={router} />
              ))
            )}
          </section>

          {/* Disputed */}
          <section className="space-y-3">
            <SectionHeader icon={Gavel} title="Disputed agreements — payout held" count={disputed.length} />
            {disputed.length === 0 ? (
              <EmptyNote text="No open agreement disputes." />
            ) : (
              disputed.map((d) => <DisputedCard key={d.id} item={d} router={router} />)
            )}
          </section>
        </div>
      )}
    </div>
  );
}

// ─── Cards ───────────────────────────────────────────────────────────────────

function StrandedCard({ item, router }: { item: Stranded; router: ReturnType<typeof useRouter> }) {
  const waiting = daysSince(item.verifiedAt);
  return (
    <div className={cn("card", item.strandedForReview && "border-red-500/30")}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2 min-w-0">
          <div className="flex items-center gap-2">
            <Home size={15} className="text-[rgb(var(--brand))] shrink-0" />
            <span className="font-semibold text-sm text-[rgb(var(--text-primary))]">
              {item.propertyTitle}
            </span>
            {item.strandedForReview && (
              <span className="badge-error gap-1 text-[10px]">
                <AlertTriangle size={10} /> Stranded
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[rgb(var(--text-secondary))]">
            <PersonBtn label="tenant (paid)" uid={item.tenantId} name={item.tenantName} router={router} />
            <PersonBtn label="landlord (not accepted)" uid={item.landlordId} name={item.landlordName} router={router} />
            <span className="flex items-center gap-1">
              <Clock size={12} /> waiting {waiting} day{waiting === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="font-mono font-semibold text-sm text-[rgb(var(--text-primary))]">
            {naira(item.rentAmount)}
          </p>
          <p className="text-[11px] text-[rgb(var(--text-hint))]">tenant paid</p>
        </div>
      </div>
      <p className="mt-3 pt-3 border-t border-[rgb(var(--border))] text-xs text-[rgb(var(--text-hint))] flex items-start gap-1.5">
        <ShieldQuestion size={13} className="shrink-0 mt-0.5" />
        Chase the landlord to accept, or refund the tenant. No money moves
        automatically — this is a review queue.
      </p>
    </div>
  );
}

function DisputedCard({ item, router }: { item: Disputed; router: ReturnType<typeof useRouter> }) {
  const { canWrite } = useAuth();
  const [reason, setReason] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function forceFinalize() {
    if (!canWrite || !reason.trim()) return;
    setBusy(true);
    try {
      const fn = httpsCallable<{ docId: string; reason: string }, { success: boolean }>(
        functions,
        "adminForceFinalizeAgreement"
      );
      await fn({ docId: item.id, reason: reason.trim() });
      setDone(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not finalize. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card border-red-500/30">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2 min-w-0">
          <div className="flex items-center gap-2">
            <Home size={15} className="text-[rgb(var(--brand))] shrink-0" />
            <span className="font-semibold text-sm text-[rgb(var(--text-primary))]">
              {item.propertyTitle}
            </span>
            <span className="badge-error gap-1 text-[10px]">
              <Gavel size={10} /> Disputed
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[rgb(var(--text-secondary))]">
            <PersonBtn label="tenant" uid={item.tenantId} name={item.tenantName} router={router} />
            <PersonBtn label="landlord" uid={item.landlordId} name={item.landlordName} router={router} />
          </div>
          <div className="text-xs text-[rgb(var(--text-secondary))] bg-red-500/5 border border-red-500/20 rounded-lg p-2.5">
            <span className="font-medium text-red-500">Tenant&apos;s reason: </span>
            {item.disputeReason}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="font-mono font-semibold text-sm text-[rgb(var(--text-primary))]">
            {naira(item.landlordPayout)}
          </p>
          <p className="text-[11px] text-amber-500">payout held</p>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-[rgb(var(--border))]">
        {done ? (
          <p className="flex items-center gap-1.5 text-xs text-emerald-500">
            <CheckCircle2 size={13} /> Agreement finalized — the payout can now be sent from Rent Payouts.
          </p>
        ) : !canWrite ? (
          <p className="text-xs text-[rgb(var(--text-hint))]">
            Read-only — resolving disputes requires a full admin account.
          </p>
        ) : !showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="text-xs px-3 py-1.5 rounded-lg bg-[rgb(var(--brand))]/10 text-[rgb(var(--brand))] hover:bg-[rgb(var(--brand))]/20"
          >
            Resolve &amp; force-finalize
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] text-[rgb(var(--text-hint))]">
              Only after the dispute is settled off-app. This unblocks the
              payout; it&apos;s audit-logged with your reason.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="How was the dispute resolved? (required)"
              rows={2}
              className="w-full text-xs p-2 rounded-lg bg-[rgb(var(--background))] border border-[rgb(var(--border))] focus:outline-none focus:border-[rgb(var(--brand))]"
            />
            <div className="flex gap-2">
              <button
                onClick={forceFinalize}
                disabled={!reason.trim() || busy}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[rgb(var(--brand))] text-white disabled:opacity-50"
              >
                {busy && <Loader2 size={12} className="animate-spin" />}
                Force-finalize
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="text-xs px-3 py-1.5 rounded-lg border border-[rgb(var(--border))] text-[rgb(var(--text-secondary))]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Bits ────────────────────────────────────────────────────────────────────

function PersonBtn({
  label,
  uid,
  name,
  router,
}: {
  label: string;
  uid: string;
  name: string;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <button
      onClick={() => uid && router.push(`/dashboard/users/${uid}`)}
      className="flex items-center gap-1 hover:text-[rgb(var(--brand))]"
    >
      <User size={12} /> {name} <span className="text-[rgb(var(--text-hint))]">({label})</span>
    </button>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  count,
}: {
  icon: typeof Home;
  title: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={15} className="text-[rgb(var(--text-secondary))]" />
      <h2 className="text-sm font-display font-semibold uppercase tracking-wider text-[rgb(var(--text-secondary))]">
        {title}
      </h2>
      <span className="text-xs text-[rgb(var(--text-hint))]">({count})</span>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div className="card text-center py-10 text-sm text-[rgb(var(--text-secondary))]">
      {text}
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone: "amber" | "red" | "brand";
  icon: typeof Home;
}) {
  const color =
    tone === "red" ? "text-red-500" : tone === "amber" ? "text-amber-500" : "text-[rgb(var(--brand))]";
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <Icon size={16} className={color} />
        <span className="text-xs text-[rgb(var(--text-secondary))]">{label}</span>
      </div>
      <p className={cn("text-2xl font-display font-bold mt-1", color)}>{value}</p>
    </div>
  );
}
