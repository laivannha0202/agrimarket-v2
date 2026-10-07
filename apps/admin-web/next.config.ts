import type { NextConfig } from "next";

// The admin console is a fully client-rendered SPA: every route is a Client
// Component that authenticates from localStorage and loads data with React
// Query. Cache Components (and its Partial Prefetching) prerenders a static
// shell on the server, but Ant Design's cssinjs runtime reads `Math.random()`
// at module scope and its registry triggers a React browser bailout, neither
// of which can be prerendered. Since there is nothing to cache for a
// client-only dashboard, Cache Components is disabled.
const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
