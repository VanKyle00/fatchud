import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  // cycletls (used by lib/doordash.ts for the Chrome JA3 handshake) spawns a Go
  // subprocess. Mark it external so Turbopack doesn't bundle it and its runtime
  // __dirname resolves to node_modules/cycletls for the correct spawn path.
  serverExternalPackages: ["cycletls"],
  // The Go binary path is computed at runtime via os.arch(), invisible to the
  // tracer — force-include dist/, then drop binaries for platforms we don't
  // deploy to so the function bundle doesn't balloon ~95MB.
  outputFileTracingIncludes: {
    "/api/deals": ["./node_modules/cycletls/dist/**"],
    "/api/doordash-check": ["./node_modules/cycletls/dist/**"],
  },
  outputFileTracingExcludes: {
    "/api/deals": [
      "./node_modules/cycletls/dist/index-arm",
      "./node_modules/cycletls/dist/index-arm64",
      "./node_modules/cycletls/dist/index-freebsd",
      "./node_modules/cycletls/dist/index-mac",
      "./node_modules/cycletls/dist/index-mac-arm64",
      "./node_modules/cycletls/dist/index.exe",
    ],
    "/api/doordash-check": [
      "./node_modules/cycletls/dist/index-arm",
      "./node_modules/cycletls/dist/index-arm64",
      "./node_modules/cycletls/dist/index-freebsd",
      "./node_modules/cycletls/dist/index-mac",
      "./node_modules/cycletls/dist/index-mac-arm64",
      "./node_modules/cycletls/dist/index.exe",
    ],
  },
};

export default nextConfig;
