import { HeartbeatIcon } from "@phosphor-icons/react";

import { IconButton, Tooltip } from "@/components";
import type { HealthCheckReadiness } from "@/lib/tauri";
import { useHealthCheckReadiness, useSweepModHealth } from "@/modules/library/api";

interface ModHealthCheckActionProps {
  /** Disable while the patcher is active or the library is still loading. */
  disabled?: boolean;
}

/**
 * Check every mod in the library, from the toolbar.
 *
 * Per "Checking the library by hand" in docs/ux/MOD_HEALTH.md.
 */
export function ModHealthCheckAction({ disabled }: ModHealthCheckActionProps) {
  const readiness = useHealthCheckReadiness();
  const sweep = useSweepModHealth();

  return (
    <Tooltip content={HINTS[readiness]}>
      <IconButton
        icon={<HeartbeatIcon weight="bold" className="h-4 w-4" />}
        variant="outline"
        size="sm"
        loading={sweep.isPending}
        disabled={disabled || readiness !== "ready"}
        aria-label="Check every mod"
        onClick={() => sweep.mutate(undefined)}
      />
    </Tooltip>
  );
}

/** What the press will do, or what it is waiting on before it can. */
const HINTS: Record<HealthCheckReadiness, string> = {
  ready: "Check every mod in the library for problems",
  syncing: "Syncing the hashtables a check needs. Try again in a moment.",
  unsynced: "The hashtables a check needs are not synced. Sync them in Settings.",
};
