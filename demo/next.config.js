import path from "node:path";
import { fileURLToPath } from "node:url";
import { withBotId } from "botid/next/config";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The table engine is a native module: loaded from node_modules at run time, never bundled.
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
  outputFileTracingRoot: here,
  turbopack: { root: here },
  outputFileTracingIncludes: { "/api/ask": ["./core/**/*", "./node_modules/@duckdb/node-bindings-linux-x64/**/*"] },
  outputFileTracingExcludes: { "/api/ask": ["./node_modules/@duckdb/node-bindings-linux-x64-musl/**/*", "./node_modules/@duckdb/node-bindings-darwin-*/**/*"] },
  poweredByHeader: false,
};

export default withBotId(nextConfig);
