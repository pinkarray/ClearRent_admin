import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";

export interface UserContact {
  name?: string;
  phone?: string;
  email?: string;
}

/** Read a user's name / phone / email for admin outreach. Admin claim passes
 * the users read rule. */
export async function fetchUserContact(
  uid: string
): Promise<UserContact | null> {
  try {
    const d = await getDoc(doc(db, "users", uid));
    if (!d.exists()) return null;
    const x = d.data();
    return {
      name: (x.fullName as string) || undefined,
      phone: (x.phone as string) || undefined,
      email: (x.email as string) || undefined,
    };
  } catch {
    return null;
  }
}

/** Normalize a (Nigerian) phone to wa.me digits — E.164 without the '+'. */
export function toWhatsApp(phone?: string): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "234" + digits.slice(1);
  else if (digits.length === 10) digits = "234" + digits; // 8012345678
  return digits || null;
}
