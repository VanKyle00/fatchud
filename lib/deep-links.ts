export type Platform = "doordash" | "ubereats" | "grubhub";

export const PLATFORM_LABELS: Record<Platform, string> = {
  doordash: "DoorDash",
  ubereats: "UberEats",
  grubhub: "Grubhub",
};

export function orderUrl(platform: Platform, name: string): string {
  const q = encodeURIComponent(name);
  switch (platform) {
    case "doordash":
      return `https://www.doordash.com/search/store/${q}/`;
    case "ubereats":
      return `https://www.ubereats.com/search?q=${q}`;
    case "grubhub":
      return `https://www.grubhub.com/search?queryText=${q}`;
  }
}

export const PLATFORMS: Platform[] = ["doordash", "ubereats", "grubhub"];
