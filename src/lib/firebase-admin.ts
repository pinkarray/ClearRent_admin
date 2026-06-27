import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { getAuth } from "firebase-admin/auth";

// Service account JSON, base64-encoded, in env (set on Vercel).
function getAdminApp(): App {
  if (getApps().length > 0) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT not set");
  const serviceAccount = JSON.parse(
    Buffer.from(raw, "base64").toString("utf8")
  );
  return initializeApp({
    credential: cert(serviceAccount),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  });
}

export function getAdminStorage() {
  return getStorage(getAdminApp());
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}