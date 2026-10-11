"use client";

/**
 * Debounce wrapper.
 *
 * `@mantine/hooks` provides the implementation; this wrapper keeps the call-site
 * API obvious and gives one place to change the default delay. The full
 * Mantine return value (value + cancel + flush handlers) is passed through.
 */

import {
  useDebouncedValue as useMantineDebouncedValue,
  type UseDebouncedValueReturnValue,
} from "@mantine/hooks";

export function useDebouncedValue<T>(
  value: T,
  delay = 300,
): UseDebouncedValueReturnValue<T> {
  return useMantineDebouncedValue(value, delay);
}

/** Convenience wrapper when only the debounced value is needed. */
export function useDebounced<T>(value: T, delay = 300): T {
  return useDebouncedValue(value, delay)[0];
}
