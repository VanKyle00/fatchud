import type { LatLng } from "@/lib/types";

type Provider = {
  name: string;
  url: string;
  parse: (data: unknown) => LatLng | null;
};

const PROVIDERS: Provider[] = [
  {
    name: "ipapi.co",
    url: "https://ipapi.co/json/",
    parse: (data) => {
      const d = data as { latitude?: number; longitude?: number; error?: boolean };
      if (d.error) return null;
      if (typeof d.latitude !== "number" || typeof d.longitude !== "number") return null;
      return { lat: d.latitude, lng: d.longitude };
    },
  },
  {
    name: "geojs.io",
    url: "https://get.geojs.io/v1/ip/geo.json",
    parse: (data) => {
      const d = data as { latitude?: string; longitude?: string };
      const lat = d.latitude !== undefined ? parseFloat(d.latitude) : NaN;
      const lng = d.longitude !== undefined ? parseFloat(d.longitude) : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
    },
  },
  {
    name: "ipwho.is",
    url: "https://ipwho.is/",
    parse: (data) => {
      const d = data as { success?: boolean; latitude?: number; longitude?: number };
      if (d.success === false) return null;
      if (typeof d.latitude !== "number" || typeof d.longitude !== "number") return null;
      return { lat: d.latitude, lng: d.longitude };
    },
  },
];

export async function fetchIpLocation(): Promise<LatLng | null> {
  for (const p of PROVIDERS) {
    try {
      const res = await fetch(p.url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      const loc = p.parse(data);
      if (loc) return loc;
    } catch {
      // try next provider
    }
  }
  return null;
}
