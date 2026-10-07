"use client";

import { useQuery } from "@tanstack/react-query";
import { useLookup } from "@/hooks/useLookup";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";

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

export function useFarmOptions(enabled = true) {
  return useLookup({
    queryKey: queryKeys.farms({ scope: "lookup" }),
    fetcher: resources.farms,
    labelOf: (f) => `${f.code} — ${f.name}`,
    enabled,
  });
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
