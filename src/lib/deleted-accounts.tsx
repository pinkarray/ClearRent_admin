"use client";

// Deleted-account registry.
//
// Financial records outlive the account that created them — a rental interest
// where the tenant paid and then deleted their account keeps its `tenantId` and
// its denormalized `tenantName` forever. Screens that render those names had no
// way to tell a live party from a departed one, so a queue like Rent Attention
// would show a tenant who has been gone for months as though someone were
// waiting on the other end.
//
// `deleted_accounts/{uid}` is written by deleteMyAccount as the account goes
// (and backfilled for older deletions by scripts/backfill-deleted-accounts.mjs).
// The collection is tiny and read-only, so it is subscribed once here and shared
// rather than re-fetched per row.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useMemo,
} from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { toDate } from "@/lib/format";

export interface DeletedAccount {
  uid: string;
  /** Name at deletion time. Null when it could not be recovered by backfill. */
  fullName: string | null;
  accountType: string | null;
  /** Null for backfilled rows — the real deletion time is unrecoverable. */
  deletedAt: Date | null;
}

interface DeletedAccountsContextType {
  /** The tombstone for `uid`, or null if the account is live (or uid is empty). */
  lookup: (uid: string | null | undefined) => DeletedAccount | null;
  /** False until the registry has loaded — avoids flashing "deleted" on every row. */
  ready: boolean;
}

const DeletedAccountsContext = createContext<DeletedAccountsContextType>({
  lookup: () => null,
  ready: false,
});

export function DeletedAccountsProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Map<string, DeletedAccount>>(new Map());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "deleted_accounts"),
      (snap) => {
        const next = new Map<string, DeletedAccount>();
        for (const d of snap.docs) {
          const x = d.data();
          next.set(d.id, {
            uid: d.id,
            fullName: (x.fullName as string) ?? null,
            accountType: (x.accountType as string) ?? null,
            deletedAt: toDate(x.deletedAt),
          });
        }
        setAccounts(next);
        setReady(true);
      },
      // A read failure must not make live accounts look deleted, so we stay
      // empty and mark ready — screens fall back to the denormalized name.
      () => setReady(true)
    );
    return unsub;
  }, []);

  const value = useMemo<DeletedAccountsContextType>(
    () => ({
      lookup: (uid) => (uid ? accounts.get(uid) ?? null : null),
      ready,
    }),
    [accounts, ready]
  );

  return (
    <DeletedAccountsContext.Provider value={value}>
      {children}
    </DeletedAccountsContext.Provider>
  );
}

export const useDeletedAccounts = () => useContext(DeletedAccountsContext);

/**
 * Resolve one party for display.
 *
 * `name` is the denormalized name carried on the record. When the uid has a
 * tombstone we prefer the name captured at deletion time, since the
 * denormalized copy can be older still.
 */
export function useParty(uid: string | null | undefined, name?: string | null) {
  const { lookup, ready } = useDeletedAccounts();
  const tombstone = lookup(uid);
  return {
    uid: uid ?? "",
    displayName: tombstone?.fullName || name || "Unknown",
    isDeleted: tombstone !== null,
    deletedAt: tombstone?.deletedAt ?? null,
    ready,
  };
}
