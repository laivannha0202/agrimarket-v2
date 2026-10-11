import type { NextConfig } from "next";

/**
 * Customer Web config.
 *
 * `images.unoptimized` is intentional. The catalog image URLs come from the
 * seeded `cdn.agrimarket.vn` host, which is not a reachable image CDN in this
 * project. Leaving the optimizer on would only turn every product image into a
 * failing `/_next/image` request. `next/image` is still used for its API
 * (lazy loading, `sizes`, aspect-ratio handling) and every image has a clean
 * client-side fallback.
 */
const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "cdn.agrimarket.vn" },
      { protocol: "http", hostname: "cdn.agrimarket.vn" },
    ],
  },
};

export default nextConfig;
