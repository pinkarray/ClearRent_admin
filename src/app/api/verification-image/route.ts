import { NextRequest } from "next/server";
import { getAdminAuth, getAdminStorage } from "@/lib/firebase-admin";
// Streams a private verification document from Firebase Storage.
// Auth: requires a valid Firebase ID token (Authorization: Bearer <token>)
// belonging to an admin (admin OR superAdmin custom claim — mirrors
// isAdmin() in firestore.rules / storage.rules). The image bytes are
// streamed through this route; no public or signed URL is ever exposed.
export async function GET(req: NextRequest) {
  // 1. Verify the caller's ID token.
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  let claims;
  try {
    claims = await getAdminAuth().verifyIdToken(token);
  } catch (err) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Admin gate — same claim model as Firestore/Storage rules.
  if (claims.admin !== true && claims.superAdmin !== true) {
    return new Response("Forbidden", { status: 403 });
  }

  // 3. Validate the path. Only private verification/*, ownership/* (C of O /
  // deed) and agreements/* objects are servable here — all admin-readable PII.
  const path = req.nextUrl.searchParams.get("path");
  if (
    !path ||
    (!path.startsWith("verification/") &&
      !path.startsWith("ownership/") &&
      !path.startsWith("agreements/"))
  ) {
    return new Response("Bad Request", { status: 400 });
  }

  // 4. Stream the object bytes.
  try {
    const file = getAdminStorage().bucket().file(path);
    const [exists] = await file.exists();
    if (!exists) {
      return new Response("Not Found", { status: 404 });
    }
    const [buffer] = await file.download();
    const [metadata] = await file.getMetadata();
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response("Internal Server Error", { status: 500 });
  }
}