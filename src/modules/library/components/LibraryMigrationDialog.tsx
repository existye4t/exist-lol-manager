import { PackageIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";

import { Accordion, Button, Dialog, ShockedPoroDuotoneIcon } from "@/components";
import { type FailedConversion } from "@/lib/tauri";
import { useQueuedDialog } from "@/stores";

import { useLayoutMigration } from "../api";

/**
 * What the library upgrade could not move.
 *
 * The upgrade itself is two renames per mod and runs unasked, reporting through
 * a toast. This is the failure half: what stayed in the legacy layout and will
 * be retried next launch — ADR-0008. Anatomy and tone per DS-REPORT-PANEL, at
 * warning because the retry is already scheduled.
 */
export function LibraryMigrationDialog() {
  const report = useLayoutMigration();
  const [dismissed, setDismissed] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const failed = !dismissed && report !== null && report.failed.length > 0;
  const showing = useQueuedDialog("library-migration", failed);

  if (!showing || !report) return null;

  const groups = groupByError(report.failed);
  const plural = report.failed.length === 1 ? "mod" : "mods";

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Backdrop />
        {/* Focus starts on the panel rather than on the first group's press,
            so the dialog opens saying what happened, not wearing a ring. */}
        {/* The height is fixed rather than fit, so a group folding open
            scrolls the list instead of reshaping the dialog. */}
        <Dialog.Overlay
          ref={panel}
          size="lg"
          initialFocus={panel}
          data-ui="LibraryMigrationDialog"
          aria-label="Mods the library upgrade could not move"
          className="flex h-[70vh] max-w-[38.5rem] flex-col overflow-hidden"
        >
          <header className="relative flex shrink-0 items-start gap-2.5 bg-linear-to-r from-warning/15 to-warning/0 px-3 py-2.5 select-none">
            <ShockedPoroDuotoneIcon className="h-10 w-10 shrink-0 text-warning-text" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-medium text-surface-100">
                {report.failed.length} {plural} could not be upgraded
              </h2>
              <p className="text-xs text-surface-300">
                They still work and stay in your library. Moving them is tried again the next time
                the app starts.
              </p>
            </div>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-linear-to-r from-warning/50 to-warning/0"
            />
          </header>

          {/* Every group opens open: the list is the report, and collapsing is
              for wrangling it, not for finding out what it says. */}
          <div className="mx-2 my-2 min-h-0 flex-1 overflow-y-auto rounded-xl border border-surface-700 bg-surface-950/30 scrollbar-md">
            <Accordion.Root variant="filled" multiple defaultValue={groups.map(([error]) => error)}>
              {groups.map(([error, failures]) => (
                <FailureGroup key={error} error={error} failures={failures} />
              ))}
            </Accordion.Root>
          </div>

          <div className="flex shrink-0 justify-end gap-2 px-3 pt-0 pb-2.5 select-none">
            <Button variant="filled" size="sm" onClick={() => setDismissed(true)}>
              Done
            </Button>
          </div>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * One error and the mods that failed with it.
 *
 * The error leads and the mods hang under it, so ten mods stuck on one locked
 * file read as one problem rather than ten repeats of the same sentence.
 */
function FailureGroup({ error, failures }: { error: string; failures: FailedConversion[] }) {
  return (
    <Accordion.Item variant="filled" value={error}>
      <Accordion.Trigger variant="filled">
        <WarningCircleIcon
          weight="duotone"
          className="mt-0.5 h-4 w-4 shrink-0 self-start text-warning-text"
        />
        <span className="min-w-0 flex-1 text-sm font-medium text-warning-text">{error}</span>
        <span className="shrink-0 text-meta text-surface-400 tabular-nums">{failures.length}</span>
      </Accordion.Trigger>
      <Accordion.Panel variant="filled">
        <ul className="flex flex-col py-1 select-none">
          {failures.map((failure) => (
            <li
              key={failure.id}
              className="flex items-center gap-2 px-3 py-1.5 text-row hover:bg-surface-veil-soft"
            >
              <PackageIcon weight="duotone" className="h-4 w-4 shrink-0 text-surface-400" />
              <span className="min-w-0 flex-1 truncate font-medium text-surface-100 select-text">
                {failure.displayName}
              </span>
            </li>
          ))}
        </ul>
      </Accordion.Panel>
    </Accordion.Item>
  );
}

/** The failures folded by their error line, in the order the report lists them. */
function groupByError(failures: FailedConversion[]): [string, FailedConversion[]][] {
  const groups = new Map<string, FailedConversion[]>();
  for (const failure of failures) {
    const group = groups.get(failure.error);
    if (group) group.push(failure);
    else groups.set(failure.error, [failure]);
  }
  return [...groups];
}
