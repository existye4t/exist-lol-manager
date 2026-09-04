// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrokenMods } from "@/modules/library";
import { useModHealthDrawerStore } from "@/stores";

import { ModHealthSweepDrawer } from "../ModHealthSweepDrawer";
import { brokenMods, installedMod, verdict } from "./modHealthFixtures";

const useBrokenMods = vi.fn<() => BrokenMods>();
const onClose = vi.fn();

/* The panel inside the sheet is `ModHealthSweepPanel`'s to test, so these mocks
   only have to keep it drawing something. */
vi.mock("../../api", () => ({
  useModHealthVerdicts: () => ({ data: {} }),
  useBrokenMods: () => useBrokenMods(),
  useInstalledMods: () => ({ data: [installedMod("a", "Charizard Smolder")] }),
  useRepairMod: () => ({ mutate: vi.fn(), isPending: false }),
  useRepairMods: () => ({ repair: vi.fn(), isRepairing: false, progress: null }),
  useCancelModHealthRun: () => ({ mutate: vi.fn(), isPending: false }),
  useRepairTargets: () => {
    const all = useBrokenMods().repairable;
    return { enabled: all, all };
  },
}));

function show() {
  useBrokenMods.mockReturnValue(brokenMods({ repairable: [verdict("a", "repairable")] }));
  render(<ModHealthSweepDrawer open onClose={onClose} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  // The width outlives a close, so it outlives a test too.
  useModHealthDrawerStore.setState({ width: 380 });
});

describe("ModHealthSweepDrawer", () => {
  it("draws what the sweep found", () => {
    show();

    expect(screen.getByRole("heading", { name: "Detected issues with mods" })).toBeInTheDocument();
    expect(screen.getByText("Charizard Smolder")).toBeInTheDocument();
  });

  it("widens from its own edge, and gives the width back", () => {
    show();
    const panel = screen.getByRole("dialog", { name: "What the check found" });
    const handle = screen.getByRole("separator");
    const start = panel.style.width;

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    const wider = panel.style.width;
    fireEvent.keyDown(handle, { key: "ArrowRight" });

    expect(wider).not.toBe(start);
    expect(panel.style.width).toBe(start);
  });

  /* The handle is the one control that changes nothing but the panel's shape, so
     opening on it lights a bar down the edge and says nothing about why. */
  it("does not open focused on the resize handle", () => {
    show();

    expect(screen.getByRole("separator")).not.toHaveFocus();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    show();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledOnce();
  });
});
