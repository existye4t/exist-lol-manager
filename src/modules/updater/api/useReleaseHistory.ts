import { type InfiniteData, useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";

import { api, type AppError, type ReleaseNote, type ReleasePage } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { updaterKeys } from "./keys";

/** Half an hour, because the history only moves when a release ships. */
const HISTORY_STALE_MS = 30 * 60 * 1000;

export interface UseReleaseHistoryOptions {
  /** The history loads only while the surface showing it is open. */
  enabled: boolean;
  /** A version already drawn by the caller, kept out of the list. */
  excludeVersion?: string;
}

export interface ReleaseFeed {
  releases: ReleaseNote[];
  /** No page has arrived yet. */
  isPending: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  error: AppError | null;
  fetchNextPage: () => void;
  refetch: () => void;
}

/** Every past release, a page at a time, newest first. */
export function useReleaseHistory({
  enabled,
  excludeVersion,
}: UseReleaseHistoryOptions): ReleaseFeed {
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isPending,
    refetch,
  } = useInfiniteQuery<
    ReleasePage,
    AppError,
    InfiniteData<ReleasePage>,
    ReturnType<typeof updaterKeys.releases>,
    number
  >({
    queryKey: updaterKeys.releases(),
    queryFn: async ({ pageParam }) => unwrapForQuery(await api.listReleases(pageParam)),
    initialPageParam: 1,
    getNextPageParam: (last) => last.nextPage ?? undefined,
    staleTime: HISTORY_STALE_MS,
    retry: 1,
    enabled,
  });

  const pages = data?.pages;
  const { releases, newestPageAdded } = useMemo(
    () => collectReleases(pages, excludeVersion),
    [pages, excludeVersion],
  );

  /* A page can filter down to nothing, and the sentinel the caller pages on
     does not fire again while its intersection is unchanged. */
  useEffect(() => {
    if (!enabled || isFetching || error !== null) return;
    if (!hasNextPage || pages === undefined || newestPageAdded > 0) return;
    void fetchNextPage();
  }, [enabled, error, fetchNextPage, hasNextPage, isFetching, newestPageAdded, pages]);

  const loadNextPage = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  const reload = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    releases,
    isPending,
    isFetchingNextPage,
    hasNextPage,
    error,
    fetchNextPage: loadNextPage,
    refetch: reload,
  };
}

/** The releases worth drawing, and how many of them the newest page brought. */
function collectReleases(
  pages: ReleasePage[] = [],
  excludeVersion?: string,
): { releases: ReleaseNote[]; newestPageAdded: number } {
  const tags = new Set<string>();
  const releases: ReleaseNote[] = [];
  let newestPageAdded = 0;

  pages.forEach((page, index) => {
    for (const release of page.releases) {
      if (release.version === excludeVersion || tags.has(release.tag)) continue;
      tags.add(release.tag);
      releases.push(release);
      if (index === pages.length - 1) newestPageAdded += 1;
    }
  });

  return { releases, newestPageAdded };
}
