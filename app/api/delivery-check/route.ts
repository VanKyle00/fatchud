import { isOnGrubhub } from "@/lib/grubhub";
import { isOnUberEats } from "@/lib/ubereats";
import type { DeliveryAvailability } from "@/lib/types";

type Item = { id: string; name: string; lat: number; lng: number };
type Body = { restaurants?: Item[] };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!Array.isArray(body.restaurants)) {
    return Response.json({ error: "restaurants required" }, { status: 400 });
  }

  const checks = await Promise.all(
    body.restaurants.map(async (r) => {
      if (
        typeof r.id !== "string" ||
        typeof r.name !== "string" ||
        typeof r.lat !== "number" ||
        typeof r.lng !== "number"
      ) {
        return [r.id, { grubhub: false, ubereats: false, doordash: "unknown" }] as const;
      }
      const [grubhub, ubereats] = await Promise.all([
        isOnGrubhub(r.name, r.lat, r.lng),
        isOnUberEats(r.name, r.lat, r.lng),
      ]);
      // DoorDash availability is resolved separately and lazily via
      // /api/doordash-check (cycletls). Here it's "unknown" until that pass runs.
      return [r.id, { grubhub, ubereats, doordash: "unknown" }] as const;
    }),
  );

  const availability: Record<string, DeliveryAvailability> = {};
  for (const [id, value] of checks) availability[id] = value;
  return Response.json({ availability });
}
