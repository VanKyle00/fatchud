import { isOnDoorDash } from "@/lib/doordash";
import { isOnGrubhub } from "@/lib/grubhub";
import { isOnUberEats } from "@/lib/ubereats";

type Item = { id: string; name: string; lat: number; lng: number };
type Body = { restaurants?: Item[] };

export type DeliveryAvailability = { grubhub: boolean; ubereats: boolean; doordash: boolean };

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
        return [r.id, { grubhub: false, ubereats: false, doordash: false }] as const;
      }
      const [grubhub, ubereats, doordash] = await Promise.all([
        isOnGrubhub(r.name, r.lat, r.lng),
        isOnUberEats(r.name, r.lat, r.lng),
        isOnDoorDash(r.name, r.lat, r.lng),
      ]);
      return [r.id, { grubhub, ubereats, doordash }] as const;
    }),
  );

  const availability: Record<string, DeliveryAvailability> = {};
  for (const [id, value] of checks) availability[id] = value;
  return Response.json({ availability });
}
