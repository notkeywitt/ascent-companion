import { NextRequest, NextResponse } from "next/server";

// Static map image for a trip route. The Maps Static API key must stay
// server-side, so the page points an <img> at this proxy (with only the trip's
// geometry) and we add the key here, then stream back the PNG.
//
// Requires the **Maps Static API** enabled on the project (and added to the
// key's API restrictions).
//
//   GET /api/mileage/map?start=lat,lng&end=lat,lng&path=<encodedPolyline>&size=WxH
//   → image/png  (a route line + S/E markers)
export const dynamic = "force-dynamic";

const LATLNG = /^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/;

function safeSize(raw: string | null): string {
  if (raw && /^\d{2,4}x\d{2,4}$/.test(raw)) {
    const [w, h] = raw.split("x").map(Number);
    if (w <= 1280 && h <= 1280) return raw;
  }
  return "600x300";
}

export async function GET(req: NextRequest) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return new NextResponse("GOOGLE_MAPS_API_KEY is not set.", { status: 400 });

  const sp = req.nextUrl.searchParams;
  const start = sp.get("start") ?? "";
  const end = sp.get("end") ?? "";
  const path = sp.get("path") ?? ""; // encoded polyline (optional)
  if (!LATLNG.test(start) || !LATLNG.test(end)) {
    return new NextResponse("Valid start/end coordinates are required.", { status: 400 });
  }

  // Build the Static Maps URL server-side from whitelisted params only.
  const u = new URLSearchParams();
  u.set("size", safeSize(sp.get("size")));
  u.set("scale", "2");
  u.append("markers", `color:0x2e7d32|label:S|${start}`);
  u.append("markers", `color:0xc62828|label:E|${end}`);
  u.append("path", path ? `color:0x1a73e8cc|weight:4|enc:${path}` : `color:0x1a73e8cc|weight:4|${start}|${end}`);
  u.set("key", key);

  try {
    const g = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${u.toString()}`);
    if (!g.ok) {
      const text = await g.text();
      return new NextResponse(`Static Maps error (HTTP ${g.status}): ${text.slice(0, 200)}`, { status: g.status });
    }
    const buf = await g.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": g.headers.get("Content-Type") || "image/png",
        // A trip's route never changes — cache aggressively.
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : "Map request failed.", { status: 502 });
  }
}
