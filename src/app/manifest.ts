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
    // The INSTALLED icon — what Chrome and Safari put on a home screen, a dock
    // or a taskbar. It is the REVERSED mark: white peak on a black square.
    //
    // It is one fixed piece of art on purpose. Neither surface can pick an icon
    // per theme: manifest `icons` entries carry no media query, and iOS reads a
    // single `apple-touch-icon`. So the icon cannot follow the device the way
    // `themeColor` and the palette do — it has to read correctly on a light
    // home screen AND a dark one, which the reversed mark does and the ochre
    // square did not. Its ground is the reversed lockup's own pure black, one
    // step off the off-black launch frame above, so tapping it opens into
    // roughly the ground it left.
    //
    // Art: `ascent_logo_icon_ochre@1x.png` (repo root, the 1080px brand asset)
    // recoloured ochre→black, cream→white, then resized. Sizes live in
    // `public/` for the manifest, and `src/app/apple-icon.png` (180px, iOS) +
    // `src/app/icon.png` (192px, favicon) for Next's file conventions. Redo all
    // four together or the install icon and the tab icon drift apart.
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // The logo mark sits well inside the safe zone, so the same art doubles
      // as the maskable icon (Android adaptive shapes crop the outer 10%).
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
