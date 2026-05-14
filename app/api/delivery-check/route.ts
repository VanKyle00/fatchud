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
      const [grubhub, ubereats] = await Promise.all([
        isOnGrubhub(r.name, r.lat, r.lng),
        isOnUberEats(r.name, r.lat, r.lng),
      ]);
      // DoorDash is not verified — Cloudflare blocks every scrape attempt from
      // datacenter IPs even through residential proxies + TLS impersonation.
      // The DoorDash order button still renders unconditionally (best-effort
      // deep link to their search). availability.doordash stays false so it
      // doesn't count toward the "any platform confirmed" filter.
      return [r.id, { grubhub, ubereats, doordash: false }] as const;
    }),
  );

  const availability: Record<string, DeliveryAvailability> = {};
  for (const [id, value] of checks) availability[id] = value;
  return Response.json({ availability });
}
