// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components";
import type { HealthCheckReadiness } from "@/lib/tauri";
import { useLibrarySelectionStore } from "@/stores";

import { SelectionActionBar } from "../SelectionActionBar";
import { installedMod } from "./modHealthFixtures";

const useHealthCheckReadiness = vi.fn<() => HealthCheckReadiness>(() => "ready");
/* Mirrors the mutation's own shape, so a test can reach the caller's onSuccess. */
const sweep = vi.fn((_ids?: string[], options?: { onSuccess?: () => void }) =>
  options?.onSuccess?.(),
);

vi.mock("@/modules/library/api", () => ({
  useHealthCheckReadiness: () => useHealthCheckReadiness(),
  useSweepModHealth: () => ({ mutate: sweep, isPending: false }),
  useBulkUninstallMods: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useInstalledMods: () => ({
    data: [installedMod("a", "Charizard Smolder"), installedMod("b", "Pengu Graves")],
  }),
}));

vi.mock("@/modules/patcher", () => ({
  usePatcherStatus: () => ({ data: { running: false } }),
}));

const press = () => screen.getByRole("button", { name: /Check health/ });

function show(selected: string[]) {
  useLibrarySelectionStore.setState({ selectMode: true, selectedIds: new Set(selected) });
  render(
    <ToastProvider>
      <SelectionActionBar visibleMods={[]} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useHealthCheckReadiness.mockReturnValue("ready");
});

describe("SelectionActionBar", () => {
  it("checks the mods the reader picked, and nothing else", async () => {
    show(["b"]);

    await userEvent.click(press());

    expect(sweep.mock.calls[0][0]).toEqual(["b"]);
  });

  /* The picks are spent once the run has taken them, the same way an uninstall
     leaves the mode when it lands. */
  it("leaves select mode once the check has taken the picks", async () => {
    show(["a", "b"]);

    await userEvent.click(press());

    expect(useLibrarySelectionStore.getState().selectMode).toBe(false);
    expect(useLibrarySelectionStore.getState().selectedIds.size).toBe(0);
  });

  it("has nothing to check with an empty selection", () => {
    show([]);

    expect(press()).toBeDisabled();
  });

  it("does not offer the press before the hashtables are there", () => {
    useHealthCheckReadiness.mockReturnValue("unsynced");
    show(["a"]);

    expect(press()).toBeDisabled();
  });
});
