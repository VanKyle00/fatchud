import { ProxyAgent } from "undici";

// Shared residential-proxy agent for scrapers that need a non-datacenter egress
// IP: UberEats geolocates by requesting IP, DoorDash gates on IP reputation.
// PROXY_URL is the canonical var; UBEREATS_PROXY_URL is kept for back-compat.
// Format: http://user:pass@gate.example.com:port
let proxyAgent: ProxyAgent | null | undefined;

export function getProxyAgent(): ProxyAgent | null {
  if (proxyAgent !== undefined) return proxyAgent;
  const url = process.env.PROXY_URL ?? process.env.UBEREATS_PROXY_URL;
  proxyAgent = url ? new ProxyAgent(url) : null;
  return proxyAgent;
}
