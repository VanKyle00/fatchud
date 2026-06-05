import { getUberEatsDeals } from "@/lib/ubereats";
import type { Deal } from "@/lib/deals";

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

  const entries = await Promise.all(
    body.restaurants.map(async (r) => {
      if (
        typeof r.id !== "string" ||
        typeof r.name !== "string" ||
        typeof r.lat !== "number" ||
        typeof r.lng !== "number"
      ) {
        return [r.id, [] as Deal[]] as const;
      }
      const deals = await getUberEatsDeals(r.name, r.lat, r.lng);
      return [r.id, deals] as const;
    }),
  );

  const deals: Record<string, Deal[]> = {};
  for (const [id, value] of entries) deals[id] = value;
  return Response.json({ deals });
}
