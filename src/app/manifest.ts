import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ascent Assistant",
    short_name: "Ascent",
    description: "JobTread coding, unbilled expenses, and invoice staging",
    start_url: "/",
    display: "standalone",
    // The LAUNCH screen the OS paints for the installed app, before any of our
    // HTML runs. It hands over to the app's own loading screen, which wears the
    // theme — so the ideal value is whichever ground that screen is about to
    // paint, and a manifest cannot carry a media query to know. Off-black by
    // the owner's call (2026-09-05): a bright frame before a dark app is the
    // worse of the two misses, since it flashes in the dark rather than merely
    // reading dim in the light. A device on light gets one brief dark frame.
    // `theme_color` stays cream for the status-bar chrome; the real per-theme
    // status colors are the `themeColor` media queries in app/layout.tsx.
    background_color: "#1B1B17",
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
