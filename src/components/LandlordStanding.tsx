"use client";

/**
 * LandlordStanding - a landlord's track record on answering issues, and the
 * suspension control that acts on it.
 *
 * The history is the `issue_unanswered` alerts issueResponseReminders raised
 * against this landlord: each one is an issue that reached the admin rung
 * (day 3 / 7 / 21 by urgency) with no response. Nothing new is stored for it.
 *
 * Suspension stops new listings and relisting (firestore.rules). The server
 * callable adminSetListingSuspension existed with no screen calling it, so
 * the only way to suspend was buried inside a deposit-dispute decision.
 */

import { useCallback, useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { AlertCircle, ShieldAlert } from "lucide-react";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { parseTimestamp } from "@/types";

type Escalation = {
  id: string;
  issueId: string;
  title: string;
  body: string;
  priority: string;
  status: string;
  createdAt?: Date;
};

type Standing = {
  suspended: boolean;
  until?: Date;
  reason: string;
  overdueNow: number;
  escalations: Escalation[];
};

const DURATIONS: Array<[days: number, label: string]> = [
  [7, "7 days"],
  [30, "30 days"],
  [-1, "Until lifted"],
];

function fmt(d?: Date) {
  return d ? d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "-";
}

async function loadStanding(uid: string): Promise<Standing> {
  const [u, alerts] = await Promise.all([
    getDoc(doc(db, "users", uid)),
    getDocs(query(
      collection(db, "admin_alerts"),
      where("type", "==", "issue_unanswered"),
      where("actors.landlordId", "==", uid),
    )),
  ]);
  const d = u.data() ?? {};
  const until = parseTimestamp(d.listingSuspendedUntil);
  // A timed suspension lapses on its own (rules compare to request.time), so
  // a past date is not a suspension any more.
  const suspended = d.listingSuspended === true && (!until || until > new Date());
  const escalations = alerts.docs
    .map((a) => {
      const x = a.data();
      return {
        id: a.id,
        issueId: String(x.targetId ?? ""),
        title: String(x.meta?.propertyTitle ?? "Issue"),
        body: String(x.body ?? ""),
        priority: String(x.meta?.priority ?? "medium"),
        status: String(x.status ?? "open"),
        createdAt: parseTimestamp(x.createdAt),
      };
    })
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  return {
    suspended,
    until: suspended ? until : undefined,
    reason: String(d.listingSuspendedReason ?? ""),
    overdueNow: Array.isArray(d.overdueUrgentIssues) ? d.overdueUrgentIssues.length : 0,
    escalations,
  };
}

export default function LandlordStanding({ uid }: { uid: string }) {
  const { canWrite } = useAuth();
  const [standing, setStanding] = useState<Standing | null>(null);
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      setStanding(await loadStanding(uid));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this landlord's standing.");
    }
  }, [uid]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const act = async (suspend: boolean) => {
    if (!reason.trim()) {
      setError("Give a reason. The landlord is shown it.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await httpsCallable(functions, "adminSetListingSuspension")({
        landlordId: uid,
        suspend,
        days,
        reason: reason.trim(),
      });
      setReason("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not go through.");
    } finally {
      setBusy(false);
    }
  };

  if (!standing) {
    return error ? <div className="card text-sm text-red-500">{error}</div> : null;
  }

  const urgent = standing.escalations.filter((e) => e.priority === "high").length;

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <ShieldAlert size={16} className="text-[rgb(var(--brand))]" />
        <h2 className="font-display font-semibold text-[rgb(var(--text-primary))]">Standing</h2>
      </div>

      <div className="flex flex-wrap gap-2">
        {standing.suspended ? (
          <span className="badge badge-error">
            Suspended {standing.until ? `until ${fmt(standing.until)}` : "until lifted"}
          </span>
        ) : (
          <span className="badge badge-success">Can list</span>
        )}
        {standing.overdueNow > 0 && (
          <span className="badge badge-warning">
            Blocked now: {standing.overdueNow} urgent issue{standing.overdueNow === 1 ? "" : "s"} unanswered
          </span>
        )}
        <span className="badge badge-neutral">
          Escalated to ClearRent: {standing.escalations.length}
          {urgent > 0 ? ` (${urgent} urgent)` : ""}
        </span>
        {standing.escalations[0] && (
          <span className="badge badge-neutral">Last: {fmt(standing.escalations[0].createdAt)}</span>
        )}
      </div>

      {standing.suspended && standing.reason && (
        <p className="text-sm text-[rgb(var(--text-secondary))]">Reason given: {standing.reason}</p>
      )}

      {standing.escalations.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[rgb(var(--text-hint))] mb-1">
            Issues that reached ClearRent unanswered
          </p>
          {standing.escalations.map((e) => (
            <div key={e.id} className="row">
              <div className="flex-1 min-w-0">
                <p className="row-title">{e.title}</p>
                <p className="row-sub">{e.body}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs capitalize text-[rgb(var(--text-secondary))]">{e.priority}</p>
                <p className="text-[11px] text-[rgb(var(--text-hint))]">{fmt(e.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {canWrite && (
        <div className="border-t border-[rgb(var(--border))] pt-4 space-y-3">
          <p className="text-sm text-[rgb(var(--text-secondary))]">
            {standing.suspended
              ? "Reinstating lets them publish and relist again. Their live listings were never hidden."
              : "Suspending stops new listings and relisting. Live listings stay up, so tenants are not affected."}
          </p>
          <textarea
            className="input w-full"
            rows={2}
            placeholder={standing.suspended ? "Why reinstate (shown to the landlord)" : "Why suspend (shown to the landlord)"}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            {!standing.suspended && (
              <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {DURATIONS.map(([d, label]) => (
                  <option key={d} value={d}>{label}</option>
                ))}
              </select>
            )}
            <button
              className={standing.suspended ? "btn-primary" : "btn-secondary"}
              disabled={busy}
              onClick={() => act(!standing.suspended)}
            >
              {busy ? "Saving…" : standing.suspended ? "Reinstate" : "Suspend listing"}
            </button>
          </div>
          {error && (
            <p className="flex items-center gap-1.5 text-sm text-red-500">
              <AlertCircle size={14} /> {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
