"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { parseTimestamp } from "@/types";
import { cn, timeAgo } from "@/lib/utils";
import {
  Loader2,
  Save,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Info,
} from "lucide-react";

// Mirrors DEFAULT_PRICING in functions/src/pricing.ts and PlatformPricing
// .fallback in the app. Shown until the document loads.
const FALLBACK = {
  verificationTenantInitial: 5000,
  verificationTenantRenewal: 3000,
  verificationLandlordInitial: 15000,
  verificationLandlordRenewal: 12000,
  verificationAgentInitial: 10000,
  verificationAgentRenewal: 7000,
  listing: 10000,
  inspectionTotal: 10000,
  dealFee: 5000,
  minRent: 10000,
};

type FieldKey = keyof typeof FALLBACK;

// Verification is priced in pairs, so it renders as its own two-column block
// rather than as six unrelated rows.
const VERIFICATION_ROLES: {
  label: string;
  initial: FieldKey;
  renewal: FieldKey;
}[] = [
  {
    label: "Tenant",
    initial: "verificationTenantInitial",
    renewal: "verificationTenantRenewal",
  },
  {
    label: "Landlord",
    initial: "verificationLandlordInitial",
    renewal: "verificationLandlordRenewal",
  },
  {
    label: "Agent",
    initial: "verificationAgentInitial",
    renewal: "verificationAgentRenewal",
  },
];

/** Accepts a bare number (the pre-split shape) or an {initial, renewal} pair. */
const roleFee = (
  raw: unknown,
  which: "initial" | "renewal",
  fallback: number
): string => {
  if (typeof raw === "number") return String(raw);
  if (raw && typeof raw === "object") {
    const v = (raw as Record<string, unknown>)[which];
    if (typeof v === "number") return String(v);
  }
  return String(fallback);
};

const FIELDS: { key: FieldKey; label: string; hint: string }[] = [
  {
    key: "listing",
    label: "Property listing fee",
    hint: "Charged per additional listing (first is free)",
  },
  {
    key: "inspectionTotal",
    label: "Inspection booking fee",
    hint: "Total the tenant pays to book an inspection",
  },
  {
    key: "dealFee",
    label: "Deal completion fee",
    hint: "Per party on a completed rental — also sets the tenant's rent total",
  },
  {
    key: "minRent",
    label: "Minimum rent",
    hint:
      "Lowest rent a listing may be published at. Below the deal fee the " +
      "landlord nets nothing, so the deal can never pay out. Enforced in " +
      "firestore.rules — lower it to test with small charges.",
  },
];

export default function PricingPage() {
  const { canWrite } = useAuth();
  const [values, setValues] = useState<Record<FieldKey, string>>(
    Object.fromEntries(
      Object.entries(FALLBACK).map(([k, v]) => [k, String(v)])
    ) as Record<FieldKey, string>
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | undefined>();
  const [updatedBy, setUpdatedBy] = useState<string>("");

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "config", "pricing"),
      (snap) => {
        const d = snap.data();
        if (d) {
          setValues({
            verificationTenantInitial: roleFee(
              d.verification?.tenant,
              "initial",
              FALLBACK.verificationTenantInitial
            ),
            verificationTenantRenewal: roleFee(
              d.verification?.tenant,
              "renewal",
              FALLBACK.verificationTenantRenewal
            ),
            verificationLandlordInitial: roleFee(
              d.verification?.landlord,
              "initial",
              FALLBACK.verificationLandlordInitial
            ),
            verificationLandlordRenewal: roleFee(
              d.verification?.landlord,
              "renewal",
              FALLBACK.verificationLandlordRenewal
            ),
            verificationAgentInitial: roleFee(
              d.verification?.agent,
              "initial",
              FALLBACK.verificationAgentInitial
            ),
            verificationAgentRenewal: roleFee(
              d.verification?.agent,
              "renewal",
              FALLBACK.verificationAgentRenewal
            ),
            listing: String(d.listing ?? FALLBACK.listing),
            inspectionTotal: String(
              d.inspection?.total ?? FALLBACK.inspectionTotal
            ),
            dealFee: String(d.dealFee ?? FALLBACK.dealFee),
            minRent: String(d.minRent ?? FALLBACK.minRent),
          });
          setUpdatedAt(parseTimestamp(d.updatedAt));
          setUpdatedBy(d.updatedBy || "");
        }
        setLoading(false);
      },
      (err) => {
        console.error("pricing load failed", err);
        setError("Could not load pricing.");
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const invalid = (Object.keys(FALLBACK) as FieldKey[]).filter((k) => {
    const n = Number(values[k]);
    return !Number.isFinite(n) || n < 0;
  });

  const handleSave = async () => {
    if (!canWrite || invalid.length > 0) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await setDoc(
        doc(db, "config", "pricing"),
        {
          verification: {
            tenant: {
              initial: Number(values.verificationTenantInitial),
              renewal: Number(values.verificationTenantRenewal),
            },
            landlord: {
              initial: Number(values.verificationLandlordInitial),
              renewal: Number(values.verificationLandlordRenewal),
            },
            agent: {
              initial: Number(values.verificationAgentInitial),
              renewal: Number(values.verificationAgentRenewal),
            },
          },
          listing: Number(values.listing),
          inspection: { total: Number(values.inspectionTotal) },
          dealFee: Number(values.dealFee),
          minRent: Number(values.minRent),
          updatedAt: serverTimestamp(),
          updatedBy: "admin-dashboard",
        },
        { merge: true }
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      console.error("pricing save failed", err);
      setError("Save failed — check you have admin rights.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-[rgb(var(--brand))]" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-display font-bold text-[rgb(var(--text-primary))]">
          Pricing
        </h1>
        <p className="text-sm text-[rgb(var(--text-secondary))] mt-1">
          Platform fees. Changes take effect immediately — no app release
          needed.
        </p>
      </div>

      {/* How this behaves */}
      <div className="card border-blue-500/30 bg-blue-500/5 flex items-start gap-3">
        <Info size={18} className="text-blue-500 shrink-0 mt-0.5" />
        <div className="text-xs text-[rgb(var(--text-secondary))] space-y-1">
          <p>
            The <strong>server</strong> charges these amounts — a tampered app
            cannot change what a user is billed.
          </p>
          <p>
            The mobile app reads these for <strong>display</strong> when it
            opens the relevant screen, so a user already mid-flow may see the
            previous price until they reopen it.
          </p>
        </div>
      </div>

      {/* Verification — priced per role, first time vs every year after */}
      <div className="card space-y-4">
        <div>
          <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">
            Verification
          </p>
          <p className="text-xs text-[rgb(var(--text-hint))]">
            Renewal re-collects the role proof only — the NIN is permanent and
            carried forward — so it is priced lower. The server decides which
            applies from whether the user has ever been verified; it is not
            something the app can claim.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex-1 min-w-0" />
          <span className="w-32 text-right text-xs font-medium text-[rgb(var(--text-hint))] shrink-0">
            First time
          </span>
          <span className="w-32 text-right text-xs font-medium text-[rgb(var(--text-hint))] shrink-0">
            Renewal / year
          </span>
        </div>

        {VERIFICATION_ROLES.map((r) => (
          <div key={r.label} className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[rgb(var(--text-primary))]">
                {r.label}
              </p>
            </div>
            {([r.initial, r.renewal] as FieldKey[]).map((key) => (
              <div
                key={key}
                className="flex items-center gap-2 shrink-0 w-32"
              >
                <span className="text-[rgb(var(--text-hint))]">₦</span>
                <input
                  type="number"
                  min={0}
                  step={500}
                  disabled={!canWrite}
                  value={values[key]}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [key]: e.target.value }))
                  }
                  className={cn(
                    "input w-full text-right font-mono",
                    Number(values[key]) < 0 && "border-red-500"
                  )}
                />
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Editable fees */}
      <div className="card space-y-4">
        {FIELDS.map((f) => (
          <div key={f.key} className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[rgb(var(--text-primary))]">
                {f.label}
              </p>
              <p className="text-xs text-[rgb(var(--text-hint))]">{f.hint}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[rgb(var(--text-hint))]">₦</span>
              <input
                type="number"
                min={0}
                step={500}
                disabled={!canWrite}
                value={values[f.key]}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.key]: e.target.value }))
                }
                className={cn(
                  "input w-32 text-right font-mono",
                  Number(values[f.key]) < 0 && "border-red-500"
                )}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Inspection split — deliberately not editable yet */}
      <div className="card border-amber-500/30 bg-amber-500/5 flex items-start gap-3">
        <Lock size={18} className="text-amber-500 shrink-0 mt-0.5" />
        <div className="text-xs text-[rgb(var(--text-secondary))]">
          <p className="font-semibold text-[rgb(var(--text-primary))] mb-1">
            Inspection split (₦7,000 handler / ₦3,000 platform) is not editable
            here
          </p>
          <p>
            The handler payout and the non-refundable platform charge are still
            hardcoded server-side (<code>creditInspectionEarnings</code> and the
            refund logic). Making them editable before those read this config
            would let a mismatch pay handlers the wrong amount.
          </p>
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!canWrite || saving || invalid.length > 0}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[rgb(var(--brand))] text-white text-sm font-semibold disabled:opacity-50 transition-opacity"
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          Save pricing
        </button>

        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={15} /> Saved
          </span>
        )}
        {invalid.length > 0 && (
          <span className="flex items-center gap-1.5 text-sm text-amber-500">
            <AlertTriangle size={15} /> Enter a valid amount
          </span>
        )}
        {error && (
          <span className="flex items-center gap-1.5 text-sm text-red-500">
            <AlertTriangle size={15} /> {error}
          </span>
        )}
        {!canWrite && (
          <span className="text-xs text-[rgb(var(--text-hint))]">
            Read-only access
          </span>
        )}
      </div>

      {updatedAt && (
        <p className="text-xs text-[rgb(var(--text-hint))]">
          Last changed {timeAgo(updatedAt)}
          {updatedBy ? ` by ${updatedBy}` : ""}
        </p>
      )}
    </div>
  );
}
