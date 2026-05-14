import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  // cycletls spawns a Go subprocess. Marking it as external keeps it out of
  // the Turbopack bundle so its __dirname resolves to node_modules/cycletls
  // at runtime and the spawn path is correct.
  serverExternalPackages: ["cycletls"],
  // The Go binary path is computed at runtime via os.arch() so the tracer
  // can't see it statically — force-include the whole dist/ folder, then
  // exclude the binaries for platforms we don't deploy to so the function
  // bundle doesn't balloon ~95MB beyond what we need.
  outputFileTracingIncludes: {
    "/api/delivery-check": ["./node_modules/cycletls/dist/**"],
  },
  outputFileTracingExcludes: {
    "/api/delivery-check": [
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
