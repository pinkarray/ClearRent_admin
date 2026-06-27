import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";

export interface BankDetails {
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
}

/**
 * Read a user's bank details.
 *
 * C1: bank data now lives in the locked `users/{uid}/private/bank`
 * subcollection (owner + admin readable). Falls back to the legacy
 * `users/{uid}.bankDetails` / top-level fields for any record not yet
 * migrated, so this is safe to deploy BEFORE the migration runs. The admin
 * client carries the `admin` claim, so the subcollection read passes the
 * `isAdmin()` rule.
 */
export async function fetchBankDetails(
  uid: string
): Promise<BankDetails | null> {
  // Preferred: the locked subcollection.
  try {
    const bankDoc = await getDoc(doc(db, "users", uid, "private", "bank"));
    if (bankDoc.exists()) {
      const b = bankDoc.data();
      if (b.bankName || b.accountNumber || b.accountName) {
        return {
          bankName: b.bankName,
          accountName: b.accountName,
          accountNumber: b.accountNumber,
        };
      }
    }
  } catch {
    // fall through to the legacy location
  }

  // Legacy fallback — records not yet migrated off the user doc.
  try {
    const userDoc = await getDoc(doc(db, "users", uid));
    if (userDoc.exists()) {
      const d = userDoc.data();
      return {
        bankName: d.bankName || d.bankDetails?.bankName,
        accountName: d.accountName || d.bankDetails?.accountName,
        accountNumber: d.accountNumber || d.bankDetails?.accountNumber,
      };
    }
  } catch {
    // ignore — caller treats null as "no bank on file"
  }

  return null;
}
