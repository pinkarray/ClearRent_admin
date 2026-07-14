"use client";

import { useEffect, useState, useMemo } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { fetchBankDetails, type BankDetails } from "@/lib/bank";
import {
  fetchUserContact,
  toWhatsApp,
  type UserContact,
} from "@/lib/contact";
import { cn, timeAgo } from "@/lib/utils";
import {
  ClipboardCheck,
  Search,
  X,
  Loader2,
  CheckCircle2,
  Undo2,
  Home,
  User,
  CalendarClock,
  Flag,
  Ban,
  MessageSquare,
  Phone,
  Mail,
  Send,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AwaitingInspection {
  id: string;
  tenantId: string;
  propertyTitle: string;
  tenantName: string;
  agentId: string | null;
  agentName: string | null;
  landlordId: string | null;
  landlordName: string | null;
  requestedDate: Date | null;
  requestedTimeSlot: string;
  tenantArrived: boolean;
  handlerArrived: boolean;
  totalFee: number;
  updatedAt: Date | null;
  // Tenant-filed dispute ("Report a problem"). A disputed *completed*
  // inspection stays completed (not awaitingOutcome), so it's picked up by a
  // second listener keyed on disputeStatus.
  disputed: boolean;
  disputeCategory: string | null;
  disputeDetails: string | null;
}

function toDate(v: unknown): Date | null {
  if (v instanceof Timestamp) return v.toDate();
  return null;
}

function mapInspection(
  id: string,
  x: Record<string, unknown>
): AwaitingInspection {
  return {
    id,
    tenantId: (x.tenantId as string) ?? "",
    propertyTitle: (x.propertyTitle as string) ?? "Property",
    tenantName: (x.tenantName as string) ?? "Tenant",
    agentId: (x.agentId as string) ?? null,
    agentName: (x.agentName as string) ?? null,
    landlordId: (x.landlordId as string) ?? null,
    landlordName: (x.landlordName as string) ?? null,
    requestedDate: toDate(x.requestedDate),
    requestedTimeSlot: (x.requestedTimeSlot as string) ?? "",
    tenantArrived: x.tenantArrived === true,
    handlerArrived: x.handlerArrived === true,
    totalFee: (x.totalFee as number) ?? 0,
    updatedAt: toDate(x.updatedAt),
    disputed: x.disputed === true,
    disputeCategory: (x.disputeCategory as string) ?? null,
    disputeDetails: (x.disputeDetails as string) ?? null,
  };
}

// Human labels for the dispute categories the tenant app sends.
const DISPUTE_LABEL: Record<string, string> = {
  misrepresented: "Property misrepresented",
  no_show: "Handler no-show",
  unprofessional: "Unprofessional conduct",
  safety: "Safety concern",
  refund_request: "Refund request",
};

function formatNaira(amount: number) {
  return `₦${(amount ?? 0).toLocaleString("en-NG")}`;
}

// ClearRent's flat, non-refundable cut of the inspection fee — retained on an
// ambiguous outcome. A confirmed handler no-show still refunds the full fee.
const CLEARRENT_CUT = 3000;

function formatDate(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleDateString("en-NG", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function InspectionReviewsPage() {
  const { canWrite } = useAuth();
  const [awaiting, setAwaiting] = useState<AwaitingInspection[]>([]);
  const [disputed, setDisputed] = useState<AwaitingInspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refundItem, setRefundItem] = useState<AwaitingInspection | null>(null);
  const [refundInput, setRefundInput] = useState<string>("");
  const [refundBank, setRefundBank] = useState<BankDetails | null>(null);
  const [refundBankLoading, setRefundBankLoading] = useState(false);

  // Contact-parties modal (reach out about a dispute).
  const [contactItem, setContactItem] = useState<AwaitingInspection | null>(
    null
  );
  const [tenantContact, setTenantContact] = useState<UserContact | null>(null);
  const [handlerContact, setHandlerContact] = useState<UserContact | null>(
    null
  );
  const [contactLoading, setContactLoading] = useState(false);
  const [messageTarget, setMessageTarget] = useState<
    "tenant" | "handler" | "both"
  >("both");
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);

  // Inspections with no clear outcome (the day-of/sweep flow).
  useEffect(() => {
    const q = query(
      collection(db, "inspection_requests"),
      where("status", "==", "awaitingOutcome")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setAwaiting(snap.docs.map((d) => mapInspection(d.id, d.data())));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  // Tenant-filed disputes still open (includes disputed *completed*
  // inspections, which never enter awaitingOutcome).
  useEffect(() => {
    const q = query(
      collection(db, "inspection_requests"),
      where("disputeStatus", "==", "open")
    );
    const unsub = onSnapshot(
      q,
      (snap) => setDisputed(snap.docs.map((d) => mapInspection(d.id, d.data()))),
      () => {}
    );
    return () => unsub();
  }, []);

  // Union of both listeners, deduped by id (a disputed approved inspection
  // appears in both). Disputed items float to the top.
  const items = useMemo(() => {
    const byId = new Map<string, AwaitingInspection>();
    awaiting.forEach((it) => byId.set(it.id, it));
    disputed.forEach((it) => byId.set(it.id, it));
    const arr = Array.from(byId.values());
    arr.sort((a, b) => {
      if (a.disputed !== b.disputed) return a.disputed ? -1 : 1;
      return (
        (a.requestedDate?.getTime() ?? 0) - (b.requestedDate?.getTime() ?? 0)
      );
    });
    return arr;
  }, [awaiting, disputed]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.propertyTitle.toLowerCase().includes(q) ||
        i.tenantName.toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  function openRefund(item: AwaitingInspection) {
    setRefundItem(item);
    setRefundInput(String(item.totalFee));
    setRefundBank(null);
    if (item.tenantId) {
      setRefundBankLoading(true);
      fetchBankDetails(item.tenantId)
        .then((b) => setRefundBank(b))
        .finally(() => setRefundBankLoading(false));
    }
  }

  async function submitRefund() {
    if (!canWrite || !refundItem) return;
    const full = refundItem.totalFee;
    const amount = Number(refundInput);
    if (!Number.isFinite(amount) || amount <= 0 || amount > full) {
      alert(`Enter a refund amount between ₦1 and ${formatNaira(full)}.`);
      return;
    }
    setBusyId(refundItem.id);
    try {
      // Routed through the CF so the resolution is written to the immutable
      // admin_audit_log (and the refund amount is re-validated server-side).
      const fn = httpsCallable<
        { requestId: string; action: string; refundAmount: number },
        { success: boolean }
      >(functions, "adminResolveInspection");
      await fn({ requestId: refundItem.id, action: "refund", refundAmount: amount });
      setRefundItem(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Refund failed. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function markCompleted(item: AwaitingInspection) {
    if (!canWrite) return;
    if (
      !confirm(
        `Mark "${item.propertyTitle}" as completed? The handler is paid their ₦7,000 fee; the tenant is not refunded.`
      )
    )
      return;
    setBusyId(item.id);
    try {
      const fn = httpsCallable<
        { requestId: string; action: string },
        { success: boolean }
      >(functions, "adminResolveInspection");
      await fn({ requestId: item.id, action: "complete" });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Action failed. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  // Dismiss an unfounded dispute: closes it + its alert, no money moves and the
  // inspection status is untouched.
  async function dismissDispute(item: AwaitingInspection) {
    if (!canWrite) return;
    if (
      !confirm(
        `Dismiss the dispute on "${item.propertyTitle}"? No refund is issued and the inspection is left as-is.`
      )
    )
      return;
    setBusyId(item.id);
    try {
      const fn = httpsCallable<
        { requestId: string; action: string },
        { success: boolean }
      >(functions, "adminResolveInspection");
      await fn({ requestId: item.id, action: "dismiss" });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Action failed. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  // Open the "reach out" modal and load both parties' contact details.
  function openContact(item: AwaitingInspection) {
    setContactItem(item);
    setTenantContact(null);
    setHandlerContact(null);
    setMessageText("");
    setMessageTarget("both");
    setContactLoading(true);
    const handlerId = item.agentId ?? item.landlordId;
    Promise.all([
      item.tenantId ? fetchUserContact(item.tenantId) : Promise.resolve(null),
      handlerId ? fetchUserContact(handlerId) : Promise.resolve(null),
    ])
      .then(([t, h]) => {
        setTenantContact(t);
        setHandlerContact(h);
      })
      .finally(() => setContactLoading(false));
  }

  async function sendMessage() {
    if (!canWrite || !contactItem || !messageText.trim()) return;
    setSending(true);
    try {
      const fn = httpsCallable<
        { inspectionId: string; target: string; message: string },
        { ok: boolean; sent: number }
      >(functions, "messageInspectionParties");
      const res = await fn({
        inspectionId: contactItem.id,
        target: messageTarget,
        message: messageText.trim(),
      });
      alert(`Message sent to ${res.data.sent} recipient(s).`);
      setMessageText("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't send. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl lg:text-3xl font-display font-bold text-[rgb(var(--text-primary))]">
            Inspection Reviews
          </h1>
          <p className="text-sm text-[rgb(var(--text-secondary))] mt-1">
            Inspections with no clear outcome, plus tenant-filed disputes —
            refund, complete, or dismiss.
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
            placeholder="Search property or tenant"
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
          <ClipboardCheck
            size={36}
            className="mx-auto text-[rgb(var(--text-hint))]"
          />
          <p className="mt-3 text-sm text-[rgb(var(--text-secondary))]">
            Nothing to review — no inspections awaiting an outcome or disputed.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const handler = item.agentId
              ? item.agentName ?? "Agent"
              : item.landlordName ?? "Landlord";
            const busy = busyId === item.id;
            return (
              <div key={item.id} className="card">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Home size={15} className="text-[rgb(var(--brand))]" />
                      <span className="font-semibold text-sm text-[rgb(var(--text-primary))]">
                        {item.propertyTitle}
                      </span>
                      {item.disputed && (
                        <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/30">
                          <Flag size={11} />
                          Disputed:{" "}
                          {DISPUTE_LABEL[item.disputeCategory ?? ""] ??
                            "reported"}
                        </span>
                      )}
                    </div>
                    {item.disputed && item.disputeDetails && (
                      <p className="text-xs text-[rgb(var(--text-secondary))] italic">
                        “{item.disputeDetails}”
                      </p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[rgb(var(--text-secondary))]">
                      <span className="flex items-center gap-1">
                        <User size={12} /> {item.tenantName} (tenant)
                      </span>
                      <span className="flex items-center gap-1">
                        <User size={12} /> {handler} (handler)
                      </span>
                      <span className="flex items-center gap-1">
                        <CalendarClock size={12} />
                        {formatDate(item.requestedDate)}{" "}
                        {item.requestedTimeSlot}
                      </span>
                      <span>{formatNaira(item.totalFee)}</span>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <span
                        className={cn(
                          "text-[11px] px-2 py-0.5 rounded-full",
                          item.tenantArrived
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-red-500/10 text-red-600 dark:text-red-400"
                        )}
                      >
                        Tenant {item.tenantArrived ? "arrived" : "no-show"}
                      </span>
                      <span
                        className={cn(
                          "text-[11px] px-2 py-0.5 rounded-full",
                          item.handlerArrived
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-red-500/10 text-red-600 dark:text-red-400"
                        )}
                      >
                        Handler {item.handlerArrived ? "arrived" : "no-show"}
                      </span>
                      {item.updatedAt && (
                        <span className="text-[11px] text-[rgb(var(--text-hint))]">
                          flagged {timeAgo(item.updatedAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  {canWrite && (
                    <div className="flex gap-2">
                      <button
                        disabled={busy}
                        onClick={() => openRefund(item)}
                        className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))] disabled:opacity-50"
                      >
                        {busy ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Undo2 size={14} />
                        )}
                        Refund tenant
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => markCompleted(item)}
                        className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl bg-[rgb(var(--brand))] text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {busy ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <CheckCircle2 size={14} />
                        )}
                        Mark completed
                      </button>
                      {item.disputed && (
                        <>
                          <button
                            onClick={() => openContact(item)}
                            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))]"
                          >
                            <MessageSquare size={14} />
                            Contact parties
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => dismissDispute(item)}
                            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))] disabled:opacity-50"
                          >
                            {busy ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Ban size={14} />
                            )}
                            Dismiss dispute
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {refundItem && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => {
              if (!busyId) setRefundItem(null);
            }}
          />
          <div className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-6 shadow-2xl space-y-4">
            <div>
              <h3 className="font-display font-semibold text-[rgb(var(--text-primary))]">
                Refund tenant
              </h3>
              <p className="mt-1 text-sm text-[rgb(var(--text-secondary))]">
                {refundItem.tenantName} · {refundItem.propertyTitle}
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[rgb(var(--text-hint))]">
                Refund amount (fee paid: {formatNaira(refundItem.totalFee)})
              </label>
              <input
                type="number"
                min={1}
                max={refundItem.totalFee}
                value={refundInput}
                onChange={(e) => setRefundInput(e.target.value)}
                className="w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] px-3 py-2 text-sm focus:border-[rgb(var(--brand))] focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRefundInput(String(refundItem.totalFee))}
                  className="rounded-lg border border-[rgb(var(--border))] px-2.5 py-1 text-xs text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))]"
                >
                  Full refund
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setRefundInput(
                      String(Math.max(refundItem.totalFee - CLEARRENT_CUT, 0))
                    )
                  }
                  className="rounded-lg border border-[rgb(var(--border))] px-2.5 py-1 text-xs text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))]"
                >
                  Minus ₦{CLEARRENT_CUT.toLocaleString("en-NG")} cut
                </button>
              </div>
              <p className="text-xs text-[rgb(var(--text-hint))]">
                Full fee for a confirmed handler no-show. For an unclear outcome,
                use &quot;Minus ₦{CLEARRENT_CUT.toLocaleString("en-NG")} cut&quot;
                — ClearRent keeps its {formatNaira(CLEARRENT_CUT)} share.
              </p>
            </div>
            <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] p-3 space-y-1.5">
              <p className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
                Refund goes to
              </p>
              {refundBankLoading ? (
                <p className="flex items-center gap-1.5 text-xs text-[rgb(var(--text-hint))]">
                  <Loader2 size={12} className="animate-spin" /> Loading bank
                  details…
                </p>
              ) : refundBank &&
                (refundBank.accountNumber || refundBank.accountName) ? (
                <>
                  {refundBank.accountName && (
                    <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">
                      {refundBank.accountName}
                    </p>
                  )}
                  <p className="text-sm text-[rgb(var(--text-secondary))]">
                    {refundBank.bankName || "Bank —"}
                    {refundBank.accountNumber
                      ? ` · ${refundBank.accountNumber}`
                      : ""}
                  </p>
                </>
              ) : (
                <p className="text-xs text-amber-500">
                  No bank details on file — the tenant must add them before you
                  can pay.
                </p>
              )}
              <p className="pt-1 text-[11px] text-[rgb(var(--text-hint))]">
                Confirming queues a pending refund in the{" "}
                <span className="font-medium">Refunds</span> tab, where you
                complete the transfer and mark it paid.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                disabled={!!busyId}
                onClick={() => setRefundItem(null)}
                className="rounded-xl border border-[rgb(var(--border))] px-3 py-2 text-sm text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                disabled={!!busyId}
                onClick={submitRefund}
                className="flex items-center gap-1.5 rounded-xl bg-[rgb(var(--brand))] px-3 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
              >
                {busyId ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Undo2 size={14} />
                )}
                Confirm refund
              </button>
            </div>
          </div>
        </>
      )}

      {contactItem && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => {
              if (!sending) setContactItem(null);
            }}
          />
          <div className="fixed left-1/2 top-1/2 z-50 w-[min(94vw,32rem)] max-h-[90vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-display font-semibold text-[rgb(var(--text-primary))]">
                  Contact parties
                </h3>
                <p className="mt-1 text-sm text-[rgb(var(--text-secondary))]">
                  {contactItem.propertyTitle}
                </p>
              </div>
              <button
                onClick={() => !sending && setContactItem(null)}
                className="text-[rgb(var(--text-hint))] hover:text-[rgb(var(--text-primary))]"
              >
                <X size={18} />
              </button>
            </div>

            {/* Contact cards */}
            {contactLoading ? (
              <p className="flex items-center gap-1.5 text-xs text-[rgb(var(--text-hint))]">
                <Loader2 size={12} className="animate-spin" /> Loading contact
                details…
              </p>
            ) : (
              <div className="space-y-2">
                {[
                  {
                    role: "Tenant",
                    name: contactItem.tenantName,
                    c: tenantContact,
                  },
                  {
                    role: contactItem.agentId ? "Agent (handler)" : "Landlord (handler)",
                    name:
                      contactItem.agentName ??
                      contactItem.landlordName ??
                      "Handler",
                    c: handlerContact,
                  },
                ].map((party) => {
                  const wa = toWhatsApp(party.c?.phone);
                  return (
                    <div
                      key={party.role}
                      className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] p-3"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs uppercase tracking-wider text-[rgb(var(--text-hint))]">
                            {party.role}
                          </p>
                          <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">
                            {party.c?.name || party.name}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {party.c?.phone ? (
                          <>
                            <a
                              href={`tel:${party.c.phone}`}
                              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--surface))]"
                            >
                              <Phone size={13} /> {party.c.phone}
                            </a>
                            {wa && (
                              <a
                                href={`https://wa.me/${wa}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                              >
                                <MessageSquare size={13} /> WhatsApp
                              </a>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-[rgb(var(--text-hint))]">
                            No phone on file
                          </span>
                        )}
                        {party.c?.email && (
                          <a
                            href={`mailto:${party.c.email}`}
                            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--surface))]"
                          >
                            <Mail size={13} /> {party.c.email}
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* In-app message */}
            {canWrite && (
              <div className="space-y-2 border-t border-[rgb(var(--border))] pt-4">
                <p className="text-xs font-medium text-[rgb(var(--text-hint))] uppercase tracking-wider">
                  Send an in-app message
                </p>
                <div className="flex gap-2">
                  {(["tenant", "handler", "both"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setMessageTarget(t)}
                      className={cn(
                        "text-xs px-2.5 py-1 rounded-lg border capitalize",
                        messageTarget === t
                          ? "border-[rgb(var(--brand))] bg-[rgb(var(--brand))]/10 text-[rgb(var(--brand))]"
                          : "border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--background))]"
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <textarea
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  rows={3}
                  placeholder="e.g. We're reviewing your report — please reply with any photos or details."
                  className="w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] px-3 py-2 text-sm focus:border-[rgb(var(--brand))] focus:outline-none"
                />
                <div className="flex justify-end">
                  <button
                    disabled={sending || !messageText.trim()}
                    onClick={sendMessage}
                    className="flex items-center gap-1.5 rounded-xl bg-[rgb(var(--brand))] px-3 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {sending ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Send size={14} />
                    )}
                    Send message
                  </button>
                </div>
                <p className="text-[11px] text-[rgb(var(--text-hint))]">
                  Delivered as a push + in-app notification. Sending is
                  audit-logged.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
