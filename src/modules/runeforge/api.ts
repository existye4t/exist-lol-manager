import { keepPreviousData, useQuery } from "@tanstack/react-query";

import {
  api,
  type AppError,
  type RuneforgeCatalog,
  type RuneforgeCatalogQuery,
  type RuneforgeChampions,
} from "@/lib/tauri";

function resultOrThrow<T>(result: { ok: true; value: T } | { ok: false; error: AppError }): T {
  if (result.ok) return result.value;
  const error = result.error;
  const message = "detail" in error ? error.detail : error.code;
  throw new Error(message);
}

export function useRuneforgeCatalog(query: RuneforgeCatalogQuery) {
  return useQuery<RuneforgeCatalog, Error>({
    queryKey: ["runeforge", "catalog", query],
    queryFn: async () => resultOrThrow(await api.getRuneforgeCatalog(query)),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: 1,
  });
}

export function useRuneforgeChampions() {
  return useQuery<RuneforgeChampions, Error>({
    queryKey: ["runeforge", "champions"],
    queryFn: async () => resultOrThrow(await api.getRuneforgeChampions()),
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    retry: 1,
  });
}

export function useRuneforgeThumbnail(thumbnailKey: string | null) {
  return useQuery<string | null, Error>({
    queryKey: ["runeforge", "thumbnail", thumbnailKey],
    queryFn: async () => resultOrThrow(await api.getRuneforgeThumbnail(thumbnailKey!)),
    enabled: Boolean(thumbnailKey),
    staleTime: Infinity,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    retry: 1,
  });
}
