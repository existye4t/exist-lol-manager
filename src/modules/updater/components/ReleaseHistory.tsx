import { useEffect, useRef } from "react";

import { Button, Spinner } from "@/components";
import { describeError, m } from "@/i18n";
import type { AppError } from "@/lib/tauri";

import { useReleaseHistory } from "../api";
import { ReleaseSection } from "./ReleaseSection";

interface ReleaseHistoryProps {
  /** Whether the dialog holding the history is open, so a closed one fetches nothing. */
  enabled: boolean;
  /** The version the dialog already draws as the pending release, so it is never drawn twice. */
  excludeVersion?: string;
}

/** Every release before the one on offer, paged in as the reader scrolls. */
export function ReleaseHistory({ enabled, excludeVersion }: ReleaseHistoryProps) {
  const { releases, isPending, isFetchingNextPage, hasNextPage, error, fetchNextPage, refetch } =
    useReleaseHistory({ enabled, excludeVersion });

  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage || isFetchingNextPage || error) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) fetchNextPage();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, error, fetchNextPage]);

  return (
    <div
      data-ui="ReleaseHistory"
      className="flex flex-col divide-y divide-surface-700 border-t border-surface-700"
    >
      {releases.map((release) => (
        <ReleaseSection
          key={release.tag}
          version={release.version}
          body={release.body}
          publishedAt={release.publishedAt}
          prerelease={release.prerelease}
        />
      ))}
      {/* The foot holds a row's height in every state, so a page arriving moves nothing above it. */}
      <div
        ref={sentinel}
        data-ui="ReleaseHistory:foot"
        className="flex min-h-16 items-center justify-center py-3"
      >
        <HistoryFoot
          isPending={isPending}
          isFetchingNextPage={isFetchingNextPage}
          hasNextPage={hasNextPage}
          error={error}
          onRetry={refetch}
        />
      </div>
    </div>
  );
}

interface HistoryFootProps {
  isPending: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  error: AppError | null;
  onRetry: () => void;
}

/* Quiet, and without the describer's raw detail: the notes the dialog opened
   for are still on screen, and a rate limit is not a broken update. */
function HistoryFoot({
  isPending,
  isFetchingNextPage,
  hasNextPage,
  error,
  onRetry,
}: HistoryFootProps) {
  if (error) {
    const copy = describeError(error);
    return (
      <div className="flex flex-col items-center gap-1.5">
        <p className="text-xs text-surface-400">{m.updater_history_error_title()}</p>
        <p className="max-w-xs text-center text-xs text-surface-500 select-text">
          {copy.description ?? copy.title}
        </p>
        <Button variant="ghost" size="xs" compact onClick={onRetry}>
          {m.updater_history_retry_action()}
        </Button>
      </div>
    );
  }

  if (isPending || isFetchingNextPage) return <Spinner size="sm" />;

  if (!hasNextPage) {
    return <p className="text-xs text-surface-500">{m.updater_history_end_label()}</p>;
  }

  return null;
}
