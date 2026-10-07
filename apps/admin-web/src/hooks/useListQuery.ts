"use client";

import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ListParams, Paginated } from "@/types/api";

/**
 * Thin wrapper around `useQuery` for paginated list endpoints.
 *
 * - keeps the previous page's data while the next page loads (no layout jump)
 * - the caller supplies the query key (already including params) and fetcher
 */
export function useListQuery<T>(
  queryKey: readonly unknown[],
  fetcher: (params: ListParams) => Promise<Paginated<T>>,
  params: ListParams,
): UseQueryResult<Paginated<T>, Error> {
  return useQuery<Paginated<T>, Error>({
    queryKey,
    queryFn: () => fetcher(params),
    placeholderData: keepPreviousData,
  });
}
