"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

/**
 * Wrapper around `useQuery` for a single detail record.
 */
export function useDetailQuery<T>(
  queryKey: readonly unknown[],
  fetcher: () => Promise<T>,
  enabled = true,
): UseQueryResult<T, Error> {
  return useQuery<T, Error>({
    queryKey,
    queryFn: fetcher,
    enabled,
  });
}
