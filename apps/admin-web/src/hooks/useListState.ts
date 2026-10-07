"use client";

import { useCallback, useMemo, useState } from "react";
import { useDebouncedValue } from "./useDebouncedValue";
import type { ListParams } from "@/types/api";

export interface UseListStateOptions {
  initialLimit?: number;
  initialFilters?: Record<string, string | undefined>;
}

export interface ListState {
  page: number;
  limit: number;
  search: string;
  filters: Record<string, string | undefined>;
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  setSearch: (search: string) => void;
  setFilter: (key: string, value: string | undefined) => void;
  reset: () => void;
  /** Params ready to pass to the API (search debounced, page reset on change). */
  params: ListParams;
}

/**
 * Manages list-page state: search (debounced), filters and pagination.
 * Any change to search/filters resets the page to 1.
 */
export function useListState(options: UseListStateOptions = {}): ListState {
  const { initialLimit = 20, initialFilters = {} } = options;
  const [page, setPage] = useState(1);
  const [limit, setLimitState] = useState(initialLimit);
  const [search, setSearchState] = useState("");
  const [filters, setFilters] = useState<Record<string, string | undefined>>(initialFilters);

  const debouncedSearch = useDebouncedValue(search, 300);

  const setSearch = useCallback((value: string) => {
    setSearchState(value);
    setPage(1);
  }, []);

  const setFilter = useCallback((key: string, value: string | undefined) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }, []);

  const setLimit = useCallback((value: number) => {
    setLimitState(value);
    setPage(1);
  }, []);

  const reset = useCallback(() => {
    setSearchState("");
    setFilters(initialFilters);
    setPage(1);
  }, [initialFilters]);

  const params = useMemo<ListParams>(() => {
    const out: ListParams = { page, limit };
    if (debouncedSearch.trim()) out.search = debouncedSearch.trim();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== "") out[k] = v;
    }
    return out;
  }, [page, limit, debouncedSearch, filters]);

  return {
    page,
    limit,
    search,
    filters,
    setPage,
    setLimit,
    setSearch,
    setFilter,
    reset,
    params,
  };
}
