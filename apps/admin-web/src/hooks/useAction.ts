"use client";

import { App } from "antd";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";

export interface UseActionOptions<TData> {
  /** Invalidate these query keys on success. */
  invalidate?: readonly (readonly unknown[])[];
  successMessage?: string;
  onSuccess?: (data: TData) => void;
}

/**
 * Wraps a mutation with consistent Vietnamese success/error feedback and
 * query invalidation. Errors surface the backend's business message (the API
 * client already sanitises technical text).
 */
export function useAction<TData, TVars = void>(
  mutationFn: (vars: TVars) => Promise<TData>,
  options: UseActionOptions<TData> = {},
): UseMutationResult<TData, Error, TVars> {
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  return useMutation<TData, Error, TVars>({
    mutationFn,
    onSuccess: (data) => {
      if (options.successMessage) message.success(options.successMessage);
      if (options.invalidate) {
        for (const key of options.invalidate) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
      }
      options.onSuccess?.(data);
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "Thao tác thất bại. Vui lòng thử lại.");
    },
  });
}
