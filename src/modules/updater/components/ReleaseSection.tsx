import { twMerge } from "tailwind-merge";

import { m } from "@/i18n";

import { stripReleasePreamble } from "../api";
import { ChangelogContent } from "./ChangelogContent";

const CHIP =
  "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[0.625rem] leading-tight font-medium";

/* Accent marks the release on offer, and a pre-release names no status: DS-KIND-HUE. */
const PENDING_CHIP = "bg-accent-500/15 text-accent-400";
const PRERELEASE_CHIP = "bg-surface-700 text-surface-300";

interface ReleaseSectionProps {
  /** The release's version, without a leading `v`. */
  version: string;
  /** The release's own markdown, preamble and all. */
  body: string | undefined;
  /** When the release shipped, RFC 3339, or `null` for one with no date to show. */
  publishedAt?: string | null;
  prerelease?: boolean;
  /** The release the dialog offers to install, which opens the scroll. */
  pending?: boolean;
}

/** One release: which version it is, when it shipped, and what it changed. */
export function ReleaseSection({
  version,
  body,
  publishedAt,
  prerelease = false,
  pending = false,
}: ReleaseSectionProps) {
  const date = releaseDate(publishedAt);

  return (
    <section data-ui="ReleaseSection" className="py-4">
      <header className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-surface-100 select-text">v{version}</h3>
        {pending && (
          <span className={twMerge(CHIP, PENDING_CHIP)}>{m.updater_release_pending_label()}</span>
        )}
        {prerelease && (
          <span className={twMerge(CHIP, PRERELEASE_CHIP)}>
            {m.updater_release_prerelease_label()}
          </span>
        )}
        {date && (
          <time dateTime={publishedAt ?? undefined} className="ml-auto text-xs text-surface-500">
            {date}
          </time>
        )}
      </header>
      <div className="select-text">
        <ChangelogContent body={stripReleasePreamble(body)} />
      </div>
    </section>
  );
}

/** The day a release shipped, in the reader's locale, or `null` for a date nothing can parse. */
function releaseDate(publishedAt: string | null | undefined): string | null {
  if (!publishedAt) return null;

  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
