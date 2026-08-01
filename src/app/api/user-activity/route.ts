import { NextRequest } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";

// Returns Firebase Auth sign-in metadata for the requested users.
//
// Last login comes from Auth itself (`metadata.lastSignInTime`), not from a
// field the app writes. That matters: it is recorded server-side by Firebase on
// every real authentication, works retroactively for accounts that existed
// before any of this was built, and cannot be forged by a modified client —
// unlike `lastSeenAt`, which the user's own device writes.
//
// Auth: same gate as /api/verification-image — a valid ID token belonging to an
// admin, superAdmin, or read-only viewer. This is PII-adjacent (when someone
// last used the product), so it is never public.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  let claims;
  try {
    claims = await getAdminAuth().verifyIdToken(token);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  if (
    claims.admin !== true &&
    claims.superAdmin !== true &&
    claims.viewer !== true
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  let uids: string[];
  try {
    const body = await req.json();
    uids = Array.isArray(body?.uids) ? body.uids : [];
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // getUsers caps at 100 identifiers per call.
  const unique = Array.from(
    new Set(uids.filter((u) => typeof u === "string"))
  );
  if (unique.length === 0) {
    return Response.json({ users: {} });
  }

  try {
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += 100) {
      chunks.push(unique.slice(i, i + 100));
    }

    const results = await Promise.all(
      chunks.map((chunk) =>
        getAdminAuth().getUsers(chunk.map((uid) => ({ uid })))
      )
    );

    const users: Record<
      string,
      {
        lastSignInTime: string | null;
        creationTime: string | null;
        disabled: boolean;
      }
    > = {};

    for (const result of results) {
      for (const u of result.users) {
        users[u.uid] = {
          lastSignInTime: u.metadata.lastSignInTime || null,
          creationTime: u.metadata.creationTime || null,
          disabled: u.disabled,
        };
      }
    }

    return Response.json({ users });
  } catch {
    return new Response("Internal Server Error", { status: 500 });
  }
}
