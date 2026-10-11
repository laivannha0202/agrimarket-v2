"use client";

/**
 * Evidence photo gallery for the Admin moderation views.
 *
 * WHY IT FETCHES INSTEAD OF USING <img src>
 *
 * Evidence files are private: `GET /evidence/:id/file` authorises every read,
 * and an `<img>` tag sends no `Authorization` header. The bytes are therefore
 * fetched with the admin's session and rendered as object URLs, which are
 * revoked on unmount so a long moderation session cannot leak memory.
 *
 * An ADMIN may read every image, including the photos of a review that is still
 * PENDING — which is the point: the moderator has to see the evidence to decide
 * whether it should become public.
 */

import { Image, Space, Spin } from "antd";
import { useEffect, useState } from "react";
import { fetchEvidenceBlobUrl } from "@/lib/api/client";
import type { EvidenceImage } from "@/types/api";

export interface EvidenceGalleryProps {
  images?: EvidenceImage[] | null;
  label?: string;
}

export function EvidenceGallery({ images, label = "Ảnh minh chứng" }: EvidenceGalleryProps) {
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const key = (images ?? []).map((i) => i.id).join(",");

  // With no ids there is nothing to load: the effect stays out of the way and
  // the render below reports the empty state. (Clearing the map from inside the
  // effect body is what React flags as a cascading render.)
  useEffect(() => {
    if (!key) return;
    const ids = key.split(",").map(Number);

    let cancelled = false;
    const created: string[] = [];

    void (async () => {
      // Set inside the async body: the request is genuinely in flight from
      // here, and it keeps the state write out of the synchronous effect body.
      setLoading(true);
      const next: Record<number, string> = {};
      for (const id of ids) {
        const url = await fetchEvidenceBlobUrl(id);
        if (!url) continue;
        next[id] = url;
        created.push(url);
      }
      if (cancelled) {
        created.forEach((u) => URL.revokeObjectURL(u));
        return;
      }
      setUrls(next);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [key]);

  if (!images || images.length === 0) {
    return <span style={{ color: "rgba(0,0,0,0.45)" }}>Không có ảnh</span>;
  }

  // The map only describes the current ids, so an empty selection must not
  // render a stale thumbnail.
  const visibleUrls = key ? urls : {};

  return (
    <div>
      <div style={{ marginBottom: 8, color: "rgba(0,0,0,0.65)", fontSize: 13 }}>
        {label} ({images.length})
      </div>
      <Space wrap size={8}>
        {loading && Object.keys(visibleUrls).length === 0 ? <Spin size="small" /> : null}
        {images.map((img) => {
          const url = visibleUrls[img.id];
          return (
            <div
              key={img.id}
              style={{
                width: 88,
                height: 88,
                border: "1px solid #d9d9d9",
                borderRadius: 6,
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#fafafa",
              }}
            >
              {url ? (
                <Image src={url} alt="Ảnh minh chứng" width={88} height={88} style={{ objectFit: "cover" }} />
              ) : (
                <Spin size="small" />
              )}
            </div>
          );
        })}
      </Space>
    </div>
  );
}
