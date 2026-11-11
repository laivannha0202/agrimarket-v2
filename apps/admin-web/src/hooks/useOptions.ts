"use client";

import { useQuery } from "@tanstack/react-query";
import { useLookup } from "@/hooks/useLookup";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import type { Partner } from "@/types/api";

/** Minimal partner fields needed by the farm creation selector. */
export type FarmPartnerOption = Pick<
  Partner,
  "id" | "code" | "name" | "status"
>;

interface PublicPartnerPage {
  data: FarmPartnerOption[];
  meta: { totalPages: number };
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1";

/** Read the public partner projection without attaching the ADMIN bearer token. */
async function fetchPublicPartnerPage(
  params: Record<string, string | number>,
  signal?: AbortSignal,
): Promise<PublicPartnerPage> {
  const url = new URL(`${API_BASE_URL.replace(/\/+$/, "")}/partners`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
    cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? (body as { message?: unknown }).message
        : undefined;
    throw new Error(
      Array.isArray(message)
        ? message.filter((item): item is string => typeof item === "string").join(" ")
        : typeof message === "string" && message.trim()
          ? message
          : "Không tải được danh sách đối tác.",
    );
  }

  return body as PublicPartnerPage;
}

/** Select options backed by real backend lookups (max 100 rows each). */
export function useCategoryOptions(enabled = true) {
  return useLookup({
    queryKey: queryKeys.categories({ scope: "lookup" }),
    fetcher: resources.categories,
    labelOf: (c) => c.name,
    enabled,
  });
}

export function usePartnerOptions(enabled = true) {
  return useLookup({
    queryKey: queryKeys.partners({ scope: "lookup" }),
    fetcher: resources.partners,
    labelOf: (p) => `${p.code} — ${p.name}`,
    enabled,
  });
}

/**
 * Farm creation needs every partner so draft farms can reference partners in
 * any review/business state. The API caps each page at 100 rows, so read every
 * page and keep only the non-confidential fields used by this selector.
 */
export function useFarmPartnerOptions(enabled = true, eligibleOnly = false) {
  return useQuery<FarmPartnerOption[], Error>({
    queryKey: queryKeys.partners({ scope: "farm-create-lookup", eligibleOnly }),
    enabled,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      // The public endpoint applies the verification filter in the database
      // while its Prisma projection excludes legal and banking columns.
      const filters: Record<string, string | number> =
        eligibleOnly
          ? { status: "ACTIVE", verificationStatus: "VERIFIED" }
          : {};
      const firstPage = await fetchPublicPartnerPage(
        { page: 1, limit: 100, ...filters },
        signal,
      );
      const partners = [...firstPage.data];
      let totalPages = firstPage.meta.totalPages;

      for (let page = 2; page <= totalPages; page += 1) {
        const result = await fetchPublicPartnerPage(
          { page, limit: 100, ...filters },
          signal,
        );
        partners.push(...result.data);
        totalPages = Math.max(totalPages, result.meta.totalPages);
      }

      return partners.map(({ id, code, name, status }) => ({ id, code, name, status }));
    },
  });
}

export function useFarmOptions(enabled = true) {
  return useLookup({
    queryKey: queryKeys.farms({ scope: "lookup" }),
    fetcher: resources.farms,
    labelOf: (f) => `${f.code} — ${f.name}`,
    enabled,
  });
}

/**
 * Farms restricted to one selling partner, used by the product form so a
 * cross-partner farm cannot be picked (the backend rejects it anyway). With no
 * partner selected yet the list is empty, since a product must have a seller.
 */
export function useFarmsForPartner(partnerId?: number): {
  data: { label: string; value: number }[];
  isLoading: boolean;
} {
  const query = useQuery({
    queryKey: queryKeys.farms({ scope: "lookup", partnerId: partnerId ?? "" }),
    enabled: partnerId !== undefined && partnerId !== null,
    queryFn: async () => {
      const res = await resources.farms({ partnerId, limit: 100 });
      return res.data.map((f) => ({ label: `${f.code} — ${f.name}`, value: f.id }));
    },
  });
  return { data: query.data ?? [], isLoading: query.isLoading };
}

export function useWarehouseOptions(enabled = true) {
  return useLookup({
    queryKey: queryKeys.warehouses({ scope: "lookup" }),
    fetcher: resources.warehouses,
    labelOf: (w) => `${w.code} — ${w.name}`,
    enabled,
  });
}

export function useSeasonOptions(enabled = true) {
  return useLookup({
    queryKey: queryKeys.seasons({ scope: "lookup" }),
    fetcher: resources.seasons,
    labelOf: (s) => `#${s.id} — ${s.cropName}`,
    enabled,
  });
}

export function useHarvestOptions(enabled = true) {
  return useLookup({
    queryKey: queryKeys.harvests({ scope: "lookup" }),
    fetcher: resources.harvests,
    labelOf: (h) => `#${h.id} — ${h.grade} (${h.quantity} ${h.unit})`,
    enabled,
  });
}

export function useLotOptions(enabled = true) {
  return useLookup({
    queryKey: queryKeys.lots({ scope: "lookup" }),
    fetcher: resources.lots,
    labelOf: (l) => `${l.code} — ${l.product?.name ?? ""}`,
    enabled,
  });
}

export function useProductOptions(enabled = true) {
  return useLookup({
    queryKey: queryKeys.products({ scope: "lookup" }),
    fetcher: resources.products,
    labelOf: (p) => p.name,
    enabled,
  });
}

/**
 * Variant options built from the product list (each product row already
 * includes its variants). Used by promotion forms that reference a variant.
 */
export function useVariantOptions(enabled = true): {
  data: { label: string; value: number }[] | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const query = useQuery({
    queryKey: queryKeys.products({ scope: "variant-lookup" }),
    enabled,
    queryFn: async () => {
      const res = await resources.products({ limit: 100 });
      const options: { label: string; value: number }[] = [];
      for (const p of res.data) {
        for (const v of p.variants ?? []) {
          options.push({ label: `${p.name} — ${v.name} (${v.sku})`, value: v.id });
        }
      }
      return options;
    },
  });
  return { data: query.data, isLoading: query.isLoading, isError: query.isError };
}
