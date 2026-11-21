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
//   GET /api/mileage/map?point=lat,lng&size=WxH
//   → image/png  (one place: a close satellite view with one pin; the info
//     card on the Miles full-screen map)
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
  const point = sp.get("point") ?? ""; // one place instead of a route (optional)
  const start = sp.get("start") ?? "";
  const end = sp.get("end") ?? "";
  const path = sp.get("path") ?? ""; // encoded polyline (optional)
  if (point ? !LATLNG.test(point) : !LATLNG.test(start) || !LATLNG.test(end)) {
    return new NextResponse("Valid start/end coordinates are required.", { status: 400 });
  }

  // Build the Static Maps URL server-side from whitelisted params only.
  const u = new URLSearchParams();
  if (point) {
    u.set("size", safeSize(sp.get("size")));
    u.set("scale", "2");
    u.set("maptype", "hybrid");
    u.set("zoom", "17");
    u.set("center", point);
    u.append("markers", `color:0xcf9803|${point}`);
    u.set("key", key);
    return relay(u);
  }
  u.set("size", safeSize(sp.get("size")));
  u.set("scale", "2");
  // The Miles map's look: dark ground, quiet roads, terrain relief.
  u.set("maptype", "terrain");
  for (const st of [
    "element:geometry|color:0x2b2926",
    "element:labels.text.fill|color:0x9a968d",
    "element:labels.text.stroke|color:0x1a1917",
    "feature:water|element:geometry|color:0x15130f",
    "feature:road|element:geometry|color:0x3a3733",
    "feature:road|element:labels|visibility:off",
    "feature:poi|visibility:off",
    "feature:transit|visibility:off",
    "feature:landscape.natural|element:geometry|color:0x34312c",
  ]) u.append("style", st);
  u.append("markers", `color:0x2e7d32|label:S|${start}`);
  u.append("markers", `color:0xc62828|label:E|${end}`);
  u.append("path", path ? `color:0xe8a33dee|weight:5|enc:${path}` : `color:0xe8a33dee|weight:5|${start}|${end}`);
  u.set("key", key);
  return relay(u);
}

async function relay(u: URLSearchParams) {
  try {
    const g = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${u.toString()}`);
    if (!g.ok) {
      const text = await g.text();
      // Plain text so opening this URL directly shows Google's actual reason
      // (most often: the Maps Static API isn't enabled, or isn't in the API
      // key's allowed-API restrictions).
      return new NextResponse(
        `Static Maps error (HTTP ${g.status}):\n\n${text.slice(0, 500)}`,
        { status: g.status, headers: { "Content-Type": "text/plain; charset=utf-8" } },
      );
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
