import { type NextRequest } from "next/server";
import type { GeocodeResult } from "@/lib/types";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  if (!q) {
    return Response.json({ error: "missing q" }, { status: 400 });
  }

  const key = process.env.GOOGLE_API_KEY;
  if (!key) {
    return Response.json({ error: "GOOGLE_API_KEY not set" }, { status: 500 });
  }

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", q);
  url.searchParams.set("key", key);

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    return Response.json({ error: "geocode failed" }, { status: 502 });
  }

  const data = await res.json();
  if (data.status && data.status !== "OK") {
    return Response.json(
      { error: data.error_message ?? `geocode ${data.status}` },
      { status: data.status === "ZERO_RESULTS" ? 404 : 502 },
    );
  }
  const first = data.results?.[0];
  if (!first) {
    return Response.json({ error: "no results" }, { status: 404 });
  }

  const result: GeocodeResult = {
    location: { lat: first.geometry.location.lat, lng: first.geometry.location.lng },
    formattedAddress: first.formatted_address,
  };
  return Response.json(result);
}
