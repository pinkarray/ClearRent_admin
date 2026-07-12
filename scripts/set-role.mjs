// Provision an admin-panel account and/or set its role claim.
//
// Roles: superAdmin | admin | viewer (read-only)
//
// Usage:
//   node scripts/set-role.mjs <email> <role> [password]
//
// Examples:
//   # Create (or update) a read-only viewer, setting an initial password:
//   node scripts/set-role.mjs viewer@clearrent.ng viewer "S0me-Strong-Pass"
//
//   # Promote/downgrade an existing user (no password change):
//   node scripts/set-role.mjs someone@clearrent.ng admin
//
//   # Revoke all admin-panel access:
//   node scripts/set-role.mjs someone@clearrent.ng none
//
// Reads FIREBASE_SERVICE_ACCOUNT (base64 service-account JSON) from the
// environment or from .env.local at the repo root — the same variable the
// app uses in src/lib/firebase-admin.ts.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const VALID_ROLES = ["superAdmin", "admin", "viewer", "none"];

function loadServiceAccount() {
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    // Fall back to .env.local at the repo root.
    try {
      const here = dirname(fileURLToPath(import.meta.url));
      const envPath = join(here, "..", ".env.local");
      const contents = readFileSync(envPath, "utf8");
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
  const [email, role, password] = process.argv.slice(2);

  if (!email || !role) {
    console.error("Usage: node scripts/set-role.mjs <email> <role> [password]");
    console.error(`Roles: ${VALID_ROLES.join(" | ")}`);
    process.exit(1);
  }
  if (!VALID_ROLES.includes(role)) {
    console.error(`Invalid role "${role}". Use one of: ${VALID_ROLES.join(" | ")}`);
    process.exit(1);
  }

  initializeApp({ credential: cert(loadServiceAccount()) });
  const auth = getAuth();

  // Find or create the user.
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
    console.log(`Found existing user ${email} (${userRecord.uid}).`);
    if (password) {
      await auth.updateUser(userRecord.uid, { password });
      console.log("Password updated.");
    }
  } catch (err) {
    if (err?.code === "auth/user-not-found") {
      if (!password) {
        console.error(
          `No user with email ${email}. Pass a password as the 3rd argument to create one.`
        );
        process.exit(1);
      }
      userRecord = await auth.createUser({ email, password, emailVerified: true });
      console.log(`Created new user ${email} (${userRecord.uid}).`);
    } else {
      throw err;
    }
  }

  // Merge the role into existing claims: clear the three panel roles, then set
  // the requested one. "none" leaves the user with no panel access.
  const existing = userRecord.customClaims || {};
  const nextClaims = { ...existing };
  delete nextClaims.superAdmin;
  delete nextClaims.admin;
  delete nextClaims.viewer;
  if (role !== "none") nextClaims[role] = true;

  await auth.setCustomUserClaims(userRecord.uid, nextClaims);
  // Force existing sessions to pick up the new claim on next token refresh.
  await auth.revokeRefreshTokens(userRecord.uid);

  console.log(
    role === "none"
      ? `Revoked admin-panel access for ${email}.`
      : `Set role "${role}" for ${email}.`
  );
  console.log("Claims are now:", JSON.stringify(nextClaims));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
