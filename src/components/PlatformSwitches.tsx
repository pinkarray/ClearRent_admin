"use client";

/**
 * PlatformSwitches - platform-wide switches an admin can flip without a
 * release.
 *
 *   config/security.lockUserProfiles  firestore.rules closes users/{uid} to
 *     its owner + admins. Safe only once every supported app build reads
 *     other people from public_profiles (build 19 and later); older builds
 *     read users/{uid} directly and would lose names, ratings and handlers.
 *   config/features.publicLandlordRecord  listings show how the landlord
 *     answers tenants' issues.
 *   config/features.publicLandlordRatings  listings show the stars tenants
 *     gave the landlord when their tenancy ended.
 *
 * The two public ones were held back until the marketplace has the volume
 * for a fair picture; this is where they are turned on, and off again.
 */

import { useEffect, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { AlertTriangle, Loader2 } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

/** First app build that reads other people from public_profiles. */
const PUBLIC_PROFILE_BUILD = 19;

type Switch = {
  docId: "security" | "features";
  field: string;
  label: string;
  desc: string;
};

const SWITCHES: Switch[] = [
  {
    docId: "security",
    field: "lockUserProfiles",
    label: "Lock user profiles",
    desc: "Only the owner and admins can read a user's full profile (email, phone, employer, income, ID documents). Everyone else sees the public profile.",
  },
  {
    docId: "features",
    field: "publicLandlordRecord",
    label: "Show landlords' issue response record",
    desc: "Every landlord's listings show how many tenant issues they answered in time. To name one landlord only, leave this off and use the switch on their profile's Standing card.",
  },
  {
    docId: "features",
    field: "publicLandlordRatings",
    label: "Show tenants' ratings of landlords",
    desc: "Listings show the stars tenants gave the landlord when their tenancy ended.",
  },
];

export default function PlatformSwitches() {
  const { canWrite, user } = useAuth();
  const [values, setValues] = useState<Record<string, boolean> | null>(null);
  const [minBuild, setMinBuild] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const [sec, feat, ver] = await Promise.all([
        getDoc(doc(db, "config", "security")),
        getDoc(doc(db, "config", "features")),
        getDoc(doc(db, "config", "app_version")),
      ]);
      const v: Record<string, boolean> = {};
      for (const s of SWITCHES) {
        const d = (s.docId === "security" ? sec : feat).data() ?? {};
        v[`${s.docId}.${s.field}`] = d[s.field] === true;
      }
      setValues(v);
      const m = ver.data()?.minSupportedBuild;
      setMinBuild(typeof m === "number" ? m : 0);
    })();
  }, []);

  const flip = async (s: Switch) => {
    if (!values) return;
    const key = `${s.docId}.${s.field}`;
    const next = !values[key];
    if (
      next &&
      s.field === "lockUserProfiles" &&
      (minBuild ?? 0) < PUBLIC_PROFILE_BUILD &&
      !window.confirm(
        `The minimum supported app build is ${minBuild}. Builds before ${PUBLIC_PROFILE_BUILD} ` +
          "read other people's profiles directly and will stop showing names, ratings and " +
          "handlers. Lock anyway?",
      )
    ) {
      return;
    }
    setBusy(key);
    setError("");
    try {
      await setDoc(
        doc(db, "config", s.docId),
        { [s.field]: next, [`${s.field}ChangedBy`]: user?.uid ?? null, [`${s.field}ChangedAt`]: serverTimestamp() },
        { merge: true },
      );
      setValues({ ...values, [key]: next });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card space-y-5">
      <div>
        <h2 className="font-display font-semibold text-[rgb(var(--text-primary))]">Platform</h2>
        <p className="text-sm text-[rgb(var(--text-secondary))] mt-0.5">
          Switches that take effect straight away, with no app release.
        </p>
      </div>

      {!values ? (
        <Loader2 className="w-5 h-5 animate-spin text-[rgb(var(--brand))]" />
      ) : (
        SWITCHES.map((s) => {
          const key = `${s.docId}.${s.field}`;
          const on = values[key];
          const risky = s.field === "lockUserProfiles" && !on && (minBuild ?? 0) < PUBLIC_PROFILE_BUILD;
          return (
            <div key={key} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[rgb(var(--text-primary))]">{s.label}</p>
                <p className="text-xs text-[rgb(var(--text-secondary))] mt-0.5">{s.desc}</p>
                {risky && (
                  <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500 mt-1">
                    <AlertTriangle size={12} /> Minimum supported build is {minBuild}; wait until it is{" "}
                    {PUBLIC_PROFILE_BUILD} or later.
                  </p>
                )}
              </div>
              <button
                role="switch"
                aria-checked={on}
                aria-label={s.label}
                disabled={!canWrite || busy === key}
                onClick={() => flip(s)}
                className={cn(
                  "relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50",
                  on ? "bg-[rgb(var(--brand))]" : "bg-[rgb(var(--border))]",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all",
                    on ? "left-[22px]" : "left-0.5",
                  )}
                />
              </button>
            </div>
          );
        })
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
