"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ListParams, Paginated } from "@/types/api";

export interface LookupOption {
  label: string;
  value: number;
}

export interface UseLookupOptions<T> {
  queryKey: readonly unknown[];
  fetcher: (params: ListParams) => Promise<Paginated<T>>;
  labelOf: (item: T) => string;
  enabled?: boolean;
}

/**
 * Fetches a short list (≤100 rows) to populate a `Select` with real backend
 * values. The admin dataset is small, so a single page is enough for lookups.
 */
export function useLookup<T extends { id: number }>(
  options: UseLookupOptions<T>,
): UseQueryResult<LookupOption[], Error> {
  return useQuery<LookupOption[], Error>({
    queryKey: options.queryKey,
    enabled: options.enabled ?? true,
    queryFn: async () => {
      const res = await options.fetcher({ limit: 100 });
      return res.data.map((item) => ({ label: options.labelOf(item), value: item.id }));
    },
  });
}
