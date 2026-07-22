import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ascent Assistant",
    short_name: "Ascent",
    description: "JobTread coding, unbilled expenses, and invoice staging",
    start_url: "/",
    display: "standalone",
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
