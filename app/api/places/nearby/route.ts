import { searchNearby } from "@/lib/google-places";

type Body = { lat?: number; lng?: number; radius?: number };

export async function POST(request: Request) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) {
    return Response.json({ error: "GOOGLE_API_KEY not set" }, { status: 500 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  if (typeof body.lat !== "number" || typeof body.lng !== "number") {
    return Response.json({ error: "lat and lng required" }, { status: 400 });
  }

  try {
    const restaurants = await searchNearby(
      { lat: body.lat, lng: body.lng },
      body.radius ?? 5000,
      key,
    );
    return Response.json({ restaurants });
  } catch (err) {
    const message = err instanceof Error ? err.message : "places search failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
