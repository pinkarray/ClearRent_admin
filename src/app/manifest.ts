import type { MetadataRoute } from "next";

/*
 * Makes the dashboard installable.
 *
 * This is not cosmetic — it is a hard requirement for push on iPhone. iOS only
 * exposes the Web Push API to a site added to the Home Screen (iOS 16.4+); in a
 * normal Safari tab the permission prompt is not even offered. Android does not
 * need the install, but gets a better experience with it.
 *
 * `display: standalone` is what makes iOS treat it as installable.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ClearRent Admin",
    short_name: "ClearRent",
    description: "ClearRent Platform Administration Dashboard",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0A7B6C",
    icons: [
      {
        src: "/logos/clearrent_mark_color.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
