import type { NextConfig } from "next";

/**
 * Customer Web config.
 *
 * `images.unoptimized` is intentional. Catalog photos are served by the API
 * itself from `/uploads/products/` (the seed copies real local files there and
 * points every product image row at `PUBLIC_API_BASE_URL`), so the host varies
 * per environment and the Next optimizer is never in the path. Product imagery
 * renders through plain `<img>` with a clean client-side fallback; `next/image`
 * is only used for bundled design assets under `/public/design`.
 */
const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
