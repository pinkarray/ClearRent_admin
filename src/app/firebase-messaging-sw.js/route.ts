/*
 * Serves the FCM service worker at `/firebase-messaging-sw.js`.
 *
 * WHY A ROUTE AND NOT A FILE IN public/. The worker needs the Firebase config,
 * but a static file in public/ has no access to environment variables — the
 * usual workarounds are hardcoding the project (breaks on a project change) or
 * adding a build-time substitution step (a silent failure when it is skipped).
 * Generating it here keeps one source of truth for the config.
 *
 * The path matters: the Firebase SDK registers `/firebase-messaging-sw.js` by
 * convention, and a service worker can only control pages at or below its own
 * scope. Served from the root it controls the whole dashboard; moved into a
 * subdirectory it would silently stop receiving background messages.
 *
 * The values below are public client identifiers — the same ones already
 * shipped in the JS bundle — not secrets.
 */

export const dynamic = "force-static";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function GET() {
  // `compat` builds, deliberately: a classic service worker (which is what
  // Firebase registers) cannot use ES module imports.
  const body = `
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp(${JSON.stringify(config)});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  // Collapse by alert type: five verifications arriving in a minute should be
  // one badge to act on, not five banners to dismiss.
  self.registration.showNotification(
    payload.notification?.title || "ClearRent admin",
    {
      body: payload.notification?.body || "",
      icon: "/logos/clearrent_mark_color.svg",
      badge: "/logos/clearrent_mark_color.svg",
      tag: data.type || "admin_alert",
      renotify: true,
      data,
    }
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = "/dashboard/alerts";
  // Focus an open dashboard tab rather than opening a second one.
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.includes("/dashboard") && "focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});
`.trim();

  return new Response(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
      // The config changes only on redeploy, and a stale worker is worse than
      // a re-fetch — browsers re-check the worker script on navigation anyway.
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
