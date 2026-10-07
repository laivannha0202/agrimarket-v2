"use client";

import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ListParams, Paginated } from "@/types/api";
import type { ListState } from "./useListState";

export interface UseClientListOptions<T> {
  /**
   * Stable React Query key. It must NOT include page/limit/filters: the whole
   * dataset is fetched once and then filtered/paginated on the client.
   */
  queryKey: readonly unknown[];
  fetcher: (params: ListParams) => Promise<Paginated<T>>;
  /** List state from `useListState` (page/limit/search/filters). */
  state: ListState;
  /** Lower-cased haystack used by the search box; omit to disable search. */
  searchText?: (item: T) => string;
  /** Predicate for the select filters; receives the current filters map. */
  filter?: (item: T, filters: Record<string, string | undefined>) => boolean;
  /** Max rows to pull from the server (defaults to 100, the API maximum). */
  fetchLimit?: number;
}

export interface ClientListResult<T> {
  /** Rows for the current page only. */
  data: T[];
  /** Total rows after client-side filtering. */
  total: number;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * List helper for endpoints whose server-side filtering is limited: the
 * backend only whitelists `page`, `limit`, `search` and `status`, so extra
 * filters (category, partner, warehouse, lot, type, role, ...) are rejected.
 * The admin dataset is small, so we fetch the first 100 rows once and apply
 * search + filters + pagination in the browser.
 */
export function useClientList<T extends object>(
  options: UseClientListOptions<T>,
): ClientListResult<T> {
  const { queryKey, fetcher, state, searchText, filter, fetchLimit = 100 } = options;

  const query = useQuery<Paginated<T>, Error>({
    queryKey,
    queryFn: () => fetcher({ limit: fetchLimit }),
    placeholderData: keepPreviousData,
  });

  const filtered = useMemo(() => {
    const rows = query.data?.data ?? [];
    const search = state.search.trim().toLowerCase();
    let out = rows;
    if (filter) out = out.filter((item) => filter(item, state.filters));
    if (searchText && search.length > 0) {
      out = out.filter((item) => searchText(item).toLowerCase().includes(search));
    }
    return out;
  }, [query.data, state.search, state.filters, searchText, filter]);

  const start = (state.page - 1) * state.limit;
  const data = useMemo(
    () => filtered.slice(start, start + state.limit),
    [filtered, start, state.limit],
  );

  return {
    data,
    total: filtered.length,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
