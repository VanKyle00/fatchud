import { doordashState } from "@/lib/doordash";
import type { DoorDashState } from "@/lib/types";

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
        return [r.id, "unknown" as DoorDashState] as const;
      }
      return [r.id, await doordashState(r.name, r.lat, r.lng)] as const;
    }),
  );

  const doordash: Record<string, DoorDashState> = {};
  for (const [id, value] of entries) doordash[id] = value;
  return Response.json({ doordash });
}
