import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { arrayUnion, doc, serverTimestamp, setDoc } from "firebase/firestore";
import app, { db } from "./firebase";

/*
 * Admin web push.
 *
 * Registers this browser's FCM token into `admin_devices/{uid}`, which the
 * `onAdminAlertCreated` Cloud Function fans out to when an actionable alert is
 * raised. Admin identity is a custom claim, which Firestore cannot query, so
 * this registry is how the server knows where to send. See admin_push_ops.ts.
 *
 * Only `warning` and `critical` alerts push. Signups, inspection lifecycle and
 * rent payments are `info` — they stay in the feed and the daily digest rather
 * than interrupting someone.
 */

export type PushState =
  | "unsupported"
  | "denied"
  | "default"
  | "granted"
  | "error";

/**
 * Whether this browser can do web push at all.
 *
 * On iOS this is false in a normal Safari tab no matter the version — Apple
 * only exposes push to a site installed to the Home Screen (iOS 16.4+). That is
 * not a bug to chase; it is why the UI prompts to install first.
 */
export async function pushSupported(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    return false;
  }
  return isSupported();
}

/** True when the page is running as an installed PWA rather than a browser tab. */
export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari predates display-mode and uses a non-standard flag.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function currentPermission(): PushState {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission as PushState;
}

/**
 * Asks for permission, mints an FCM token, and records it against this admin.
 *
 * Returns null on success or a message to show. The permission prompt must be
 * triggered by a user gesture — browsers ignore it otherwise, and Safari
 * permanently denies a site that asks without one.
 */
export async function enableAdminPush(uid: string): Promise<string | null> {
  if (!(await pushSupported())) {
    return isInstalled()
      ? "This browser does not support notifications."
      : "Your browser needs this site installed to the Home Screen before it can send notifications.";
  }

  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    return "Push is not configured: NEXT_PUBLIC_FIREBASE_VAPID_KEY is missing. Generate a Web Push certificate in Firebase Console → Project settings → Cloud Messaging.";
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return permission === "denied"
      ? "Notifications are blocked for this site. Allow them in your browser settings, then try again."
      : "Notification permission was not granted.";
  }

  try {
    // Registered explicitly rather than relying on the SDK default, so the
    // scope is unambiguous and a failure here surfaces as an error instead of
    // silently producing a token that never receives anything.
    const registration = await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js",
      { scope: "/" }
    );

    const token = await getToken(getMessaging(app), {
      vapidKey,
      serviceWorkerRegistration: registration,
    });
    if (!token) return "The browser did not return a push token. Try again.";

    // arrayUnion, not a replace: one admin may use several browsers, and
    // signing in on a laptop must not silence their phone.
    await setDoc(
      doc(db, "admin_devices", uid),
      {
        tokens: arrayUnion(token),
        updatedAt: serverTimestamp(),
        userAgent: navigator.userAgent.slice(0, 300),
      },
      { merge: true }
    );
    return null;
  } catch (err) {
    return err instanceof Error
      ? err.message
      : "Could not enable notifications.";
  }
}

/**
 * Shows alerts that arrive while the dashboard is focused.
 *
 * The service worker only handles BACKGROUND messages; with the tab in the
 * foreground FCM hands the payload to the page instead and nothing is displayed
 * unless we do it. Returns an unsubscribe function.
 */
export async function watchForegroundAlerts(
  onAlert: (title: string, body: string) => void
): Promise<() => void> {
  if (!(await pushSupported())) return () => {};
  try {
    return onMessage(getMessaging(app), (payload) => {
      onAlert(
        payload.notification?.title ?? "ClearRent admin",
        payload.notification?.body ?? ""
      );
    });
  } catch {
    return () => {};
  }
}
