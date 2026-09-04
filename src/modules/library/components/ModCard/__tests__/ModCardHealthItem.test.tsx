// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Menu, ToastProvider } from "@/components";
import type { HealthCheckReadiness, ModHealthVerdict } from "@/lib/tauri";
import { verdict } from "@/modules/library/components/__tests__/modHealthFixtures";
import { useModHealthDrawerStore } from "@/stores";

import { ModCardHealthItem } from "../ModCardParts";

const readiness = vi.fn<() => HealthCheckReadiness>(() => "ready");
/* Mirrors the mutation's own shape, so a test can answer the caller's
   onSuccess with the verdict the check came back with. */
const checkOne = vi.fn(
  (_modId: string, options?: { onSuccess?: (verdict: ModHealthVerdict) => void }) =>
    options?.onSuccess?.(checked),
);
let checked: ModHealthVerdict;

vi.mock("@/modules/library/api", () => ({
  useModEffectiveCategories: () => ({
    derivedTags: [],
    derivedChampions: [],
    derivedMaps: [],
    primaryDerivedChampion: null,
  }),
  useHealthCheckReadiness: () => readiness(),
  useCheckModHealth: () => ({ mutate: checkOne, isPending: false }),
}));

vi.mock("@/modules/settings", () => ({
  useSettings: () => ({ data: { showModTags: true } }),
}));

function show(state: HealthCheckReadiness) {
  readiness.mockReturnValue(state);
  render(
    <ToastProvider>
      <Menu.Root open>
        <Menu.Portal>
          <Menu.Positioner>
            <Menu.Popup>
              <ModCardHealthItem modId="a" />
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  checked = verdict("a", "healthy", { findings: 0 });
  useModHealthDrawerStore.setState({ open: false, focusModId: null });
});

describe("ModCardHealthItem", () => {
  it("offers the check on a machine whose tables are open", async () => {
    show("ready");

    await userEvent.click(screen.getByRole("menuitem", { name: "Check Health" }));

    expect(checkOne).toHaveBeenCalledWith("a", expect.anything());
  });

  /* Story: a mod whose findings are all informative was answered with a count
     in a toast, which named the findings without showing them. The panel is
     where a finding is read. */
  it("opens the panel on the mod when the check found something worth knowing", async () => {
    checked = verdict("a", "healthy", { findings: 3, severity: "info" });
    show("ready");

    await userEvent.click(screen.getByRole("menuitem", { name: "Check Health" }));

    expect(useModHealthDrawerStore.getState().open).toBe(true);
    expect(useModHealthDrawerStore.getState().focusModId).toBe("a");
  });

  /* Nothing was found, so there is nothing to open a panel over. */
  it("answers a clean check in a line, and opens nothing", async () => {
    show("ready");

    await userEvent.click(screen.getByRole("menuitem", { name: "Check Health" }));

    expect(await screen.findByText("No problems found")).toBeInTheDocument();
    expect(useModHealthDrawerStore.getState().open).toBe(false);
  });

  /* The window the row exists for: pressing here would only earn a refusal. */
  it("says what it is waiting for while the hashtables are still coming", () => {
    show("syncing");

    expect(screen.getByRole("menuitem", { name: /syncing hashtables/i })).toHaveAttribute(
      "data-disabled",
    );
    expect(screen.queryByRole("menuitem", { name: "Check Health" })).not.toBeInTheDocument();
  });

  it("names the missing tables once nothing is fetching them", () => {
    show("unsynced");

    expect(screen.getByRole("menuitem", { name: /hashtables not synced/i })).toHaveAttribute(
      "data-disabled",
    );
  });

  it("does not run a check from a row that is only saying it cannot", async () => {
    show("unsynced");

    await userEvent.click(screen.getByRole("menuitem", { name: /hashtables not synced/i }));

    expect(checkOne).not.toHaveBeenCalled();
  });
});
