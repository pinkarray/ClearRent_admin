// Reconcile records that outlived the account they point at.
//
// Until the deleteMyAccount fix (functions/src/account_ops.ts in ~/clearrent),
// deleting an account left records behind that still referenced the dead uid:
// rental interests, agent ratings, maintenance logs and buildings were never
// cascaded, and no tombstone was written. The dashboard reads the denormalized
// name off those records, so a deleted user kept rendering as a live party —
// e.g. a paid-but-unaccepted rental sitting in Rent Attention for months with
// nobody on the other end.
//
// This script finds those uids and does two things:
//   • writes a `deleted_accounts/{uid}` tombstone, recovering the person's name
//     from whatever the record denormalized, so the dashboard can label them
//     honestly instead of guessing;
//   • deletes records that only existed to serve that user and have no
//     financial meaning.
//
// Financial records (money-touched rental interests, transactions, refunds) are
// NEVER deleted here — they stay for audit and are resolved via the tombstone.
//
// Usage:
//   node scripts/backfill-deleted-accounts.mjs           # dry run, changes nothing
//   node scripts/backfill-deleted-accounts.mjs --apply   # write tombstones + delete
//
// Reads FIREBASE_SERVICE_ACCOUNT (base64 service-account JSON) from the
// environment or .env.local, same as scripts/set-role.mjs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// Every place a uid is referenced, and the field holding the denormalized name
// for that party (used to recover who the tombstone is for).
const REFERENCES = [
  { collection: "rental_interests", uid: "tenantId", name: "tenantName" },
  { collection: "rental_interests", uid: "landlordId", name: "landlordName" },
  { collection: "active_rentals", uid: "tenantId", name: "tenantName" },
  { collection: "active_rentals", uid: "landlordId", name: "landlordName" },
  { collection: "inspection_requests", uid: "tenantId", name: "tenantName" },
  { collection: "inspection_requests", uid: "landlordId", name: "landlordName" },
  { collection: "inspection_requests", uid: "agentId", name: "agentName" },
  { collection: "rent_review_requests", uid: "tenantId", name: "tenantName" },
  { collection: "rent_review_requests", uid: "landlordId", name: "landlordName" },
  { collection: "issues", uid: "tenantId", name: "tenantName" },
  { collection: "issues", uid: "landlordId", name: "landlordName" },
  { collection: "properties", uid: "landlordId", name: "landlordName" },
  { collection: "refunds", uid: "beneficiaryId", name: "beneficiaryName" },
  { collection: "transactions", uid: "tenantId", name: "tenantName" },
  { collection: "transactions", uid: "landlordId", name: "landlordName" },
  { collection: "transactions", uid: "agentId", name: "agentName" },
  { collection: "agent_ratings", uid: "agentId", name: null },
  { collection: "agent_ratings", uid: "raterId", name: null },
  { collection: "maintenance_logs", uid: "landlordId", name: null },
  { collection: "buildings", uid: "landlordId", name: null },
];

// Records that only serve their owner — safe to remove once the owner is gone.
// `statuses: null` means every doc qualifies; a list restricts to those states.
const SWEEPABLE = [
  { collection: "agent_ratings", fields: ["agentId", "raterId"], statuses: null },
  { collection: "maintenance_logs", fields: ["landlordId"], statuses: null },
  { collection: "buildings", fields: ["landlordId"], statuses: null },
  {
    collection: "rental_interests",
    fields: ["tenantId", "landlordId"],
    // Mirrors NO_MONEY_INTEREST in account_ops.ts. `accepted` and `payment_*`
    // are financial records and are deliberately excluded.
    statuses: ["interested", "pending", "rejected", "cancelled"],
  },
];

function loadServiceAccount() {
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    try {
      const here = dirname(fileURLToPath(import.meta.url));
      const contents = readFileSync(join(here, "..", ".env.local"), "utf8");
      for (const line of contents.split(/\r?\n/)) {
        const m = line.match(/^\s*FIREBASE_SERVICE_ACCOUNT\s*=\s*(.+)\s*$/);
        if (m) {
          raw = m[1].trim();
          break;
        }
      }
    } catch {
      /* no .env.local — fall through to the error below */
    }
  }
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT is not set (checked env and .env.local)."
    );
  }
  return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
}

async function main() {
  const apply = process.argv.includes("--apply");

  initializeApp({ credential: cert(loadServiceAccount()) });
  const db = getFirestore();

  console.log(
    apply
      ? "APPLY mode — tombstones will be written and orphans deleted.\n"
      : "DRY RUN — nothing will be written. Re-run with --apply to commit.\n"
  );

  // ── 1. Collect every referenced uid, with the best name we can recover ──
  // A uid appears across many records; keep the first non-empty name seen.
  const referenced = new Map(); // uid -> { name, sightings: [] }
  for (const ref of REFERENCES) {
    let snap;
    try {
      snap = await db.collection(ref.collection).get();
    } catch (e) {
      console.warn(`  ! could not read ${ref.collection}: ${e.message}`);
      continue;
    }
    for (const doc of snap.docs) {
      const uid = doc.get(ref.uid);
      if (typeof uid !== "string" || !uid) continue;
      const entry = referenced.get(uid) ?? { name: null, sightings: [] };
      if (!entry.name && ref.name) {
        const n = doc.get(ref.name);
        if (typeof n === "string" && n.trim()) entry.name = n.trim();
      }
      entry.sightings.push(`${ref.collection}/${doc.id} (${ref.uid})`);
      referenced.set(uid, entry);
    }
  }
  console.log(`Found ${referenced.size} distinct uids referenced across records.`);

  // ── 2. Which of those no longer have a users/{uid} doc? ──
  const uids = [...referenced.keys()];
  const missing = [];
  for (let i = 0; i < uids.length; i += 100) {
    const chunk = uids.slice(i, i + 100);
    const snaps = await db.getAll(
      ...chunk.map((u) => db.collection("users").doc(u))
    );
    snaps.forEach((s, idx) => {
      if (!s.exists) missing.push(chunk[idx]);
    });
  }

  if (missing.length === 0) {
    console.log("\nNo dangling references — every referenced uid still exists.");
    return;
  }

  console.log(`\n${missing.length} uid(s) referenced but no longer in users/:\n`);

  // ── 3. Tombstone each one, then sweep the records that only served them ──
  let tombstoned = 0;
  let deleted = 0;

  for (const uid of missing) {
    const { name, sightings } = referenced.get(uid);
    const existing = await db.collection("deleted_accounts").doc(uid).get();

    console.log(`  ${uid}  ${name ? `"${name}"` : "(name unrecoverable)"}`);
    console.log(
      `    referenced by ${sightings.length} record(s): ` +
        sightings.slice(0, 4).join(", ") +
        (sightings.length > 4 ? `, +${sightings.length - 4} more` : "")
    );

    if (existing.exists) {
      console.log("    tombstone: already present, leaving as is");
    } else {
      console.log(`    tombstone: ${apply ? "writing" : "would write"}`);
      if (apply) {
        await db.collection("deleted_accounts").doc(uid).set({
          uid,
          fullName: name,
          accountType: null,
          // The real deletion time is unrecoverable for these — they predate
          // the tombstone. Null distinguishes "we don't know" from a real date.
          deletedAt: null,
          backfilledAt: FieldValue.serverTimestamp(),
        });
        tombstoned++;
      }
    }

    for (const sweep of SWEEPABLE) {
      for (const field of sweep.fields) {
        const snap = await db
          .collection(sweep.collection)
          .where(field, "==", uid)
          .get();
        const targets = sweep.statuses
          ? snap.docs.filter((d) => sweep.statuses.includes(d.get("status")))
          : snap.docs;
        if (targets.length === 0) continue;
        console.log(
          `    ${apply ? "deleting" : "would delete"} ${targets.length} ` +
            `${sweep.collection} (${field})`
        );
        if (apply) {
          for (let i = 0; i < targets.length; i += 400) {
            const batch = db.batch();
            for (const d of targets.slice(i, i + 400)) batch.delete(d.ref);
            await batch.commit();
          }
          deleted += targets.length;
        }
      }
    }
    console.log("");
  }

  if (apply) {
    console.log(
      `Done. ${tombstoned} tombstone(s) written, ${deleted} orphan record(s) deleted.`
    );
    console.log(
      "Money-touched records were retained for audit — they now resolve to a " +
        "tombstone in the dashboard."
    );
  } else {
    console.log("Dry run complete. Re-run with --apply to commit these changes.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
