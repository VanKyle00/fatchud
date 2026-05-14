import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  // cycletls ships platform binaries that aren't statically detected by
  // @vercel/nft (the path is computed at runtime). Force-include only the
  // Linux x64 binary (~19MB) and explicitly exclude the others (~95MB total)
  // so the function bundle stays well under Vercel's size limits.
  outputFileTracingIncludes: {
    "/api/delivery-check": ["./node_modules/cycletls/dist/index"],
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
