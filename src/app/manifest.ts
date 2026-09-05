import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ascent Assistant",
    short_name: "Ascent",
    description: "JobTread coding, unbilled expenses, and invoice staging",
    start_url: "/",
    display: "standalone",
    // The LAUNCH screen the OS paints for the installed app, before any of our
    // HTML runs. Cream, to hand over to the app's own loading screen with no
    // color change — that screen used to be black, which made the open a
    // black-then-cream flash. One value has to serve both themes (a manifest
    // cannot carry a media query), so this follows `theme_color` and the light
    // default; a device on dark still gets one brief cream frame here.
    background_color: "#FAF7EE",
    theme_color: "#FAF7EE",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // The logo mark sits well inside the safe zone, so the same art doubles
      // as the maskable icon (Android adaptive shapes crop the outer 10%).
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
