"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  currentPermission,
  enableAdminPush,
  isInstalled,
  pushSupported,
  type PushState,
} from "@/lib/admin-push";

/*
 * Turns on out-of-dashboard alerts for this admin, on this device.
 *
 * "On this device" is the important part and is stated in the UI: the token is
 * per-browser, so enabling it on a laptop does nothing for a phone. That is
 * also why the server stores an array of tokens rather than one.
 */
export function PushToggle() {
  const { user, isAdmin } = useAuth();
  const [state, setState] = useState<PushState>("default");
  const [supported, setSupported] = useState<boolean | null>(null);
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      setSupported(await pushSupported());
      setInstalled(isInstalled());
      setState(currentPermission());
    })();
  }, []);

  if (!user || !isAdmin) return null;

  async function enable() {
    if (!user) return;
    setError(null);
    setBusy(true);
    const err = await enableAdminPush(user.uid);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setState("granted");
    setDone(true);
  }

  // iOS refuses push in a normal Safari tab regardless of version — the site
  // has to be on the Home Screen first. Say so plainly instead of showing a
  // button that cannot work.
  const iosNeedsInstall =
    supported === false &&
    !installed &&
    typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod/.test(navigator.userAgent);

  return (
    <div className="rounded-lg border p-5">
      <h3 className="font-semibold">Alerts on this device</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Get verification requests, disputes and other actionable alerts as
        notifications, without keeping the dashboard open. Routine events
        (signups, inspection updates, payments) stay in the feed and the daily
        summary instead.
      </p>

      {iosNeedsInstall ? (
        <p className="mt-4 text-sm">
          On iPhone, tap <strong>Share → Add to Home Screen</strong>, open
          ClearRent Admin from there, then enable notifications. iOS does not
          allow them in a normal Safari tab.
        </p>
      ) : supported === false ? (
        <p className="mt-4 text-sm text-muted-foreground">
          This browser does not support notifications.
        </p>
      ) : state === "denied" ? (
        <p className="mt-4 text-sm">
          Notifications are blocked for this site. Allow them in your browser
          settings, then reload.
        </p>
      ) : state === "granted" && !done ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-muted-foreground">
            Notifications are allowed. Re-register if you stopped receiving
            them — tokens expire when browser data is cleared.
          </p>
          <button
            className="rounded-md border px-4 py-2 text-sm"
            disabled={busy}
            onClick={enable}
          >
            {busy ? "Registering…" : "Re-register this device"}
          </button>
        </div>
      ) : (
        <button
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          disabled={busy || supported === null}
          onClick={enable}
        >
          {busy ? "Enabling…" : "Enable notifications"}
        </button>
      )}

      {done && (
        <p className="mt-3 text-sm text-emerald-600">
          Done — this device will now receive actionable alerts.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
