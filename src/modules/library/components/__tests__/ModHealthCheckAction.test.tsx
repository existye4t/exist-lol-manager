// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HealthCheckReadiness } from "@/lib/tauri";

import { ModHealthCheckAction } from "../ModHealthCheckAction";

const useHealthCheckReadiness = vi.fn<() => HealthCheckReadiness>(() => "ready");
const sweep = vi.fn();

vi.mock("@/modules/library/api", () => ({
  useHealthCheckReadiness: () => useHealthCheckReadiness(),
  useSweepModHealth: () => ({ mutate: sweep, isPending: false }),
}));

const press = () => screen.getByRole("button", { name: "Check every mod" });

beforeEach(() => {
  vi.clearAllMocks();
  useHealthCheckReadiness.mockReturnValue("ready");
});

describe("ModHealthCheckAction", () => {
  /* The library-wide press names no mods, which is what makes it the library's
     rather than a selection's. */
  it("checks the whole library", async () => {
    render(<ModHealthCheckAction />);

    await userEvent.click(press());

    expect(sweep).toHaveBeenCalledWith(undefined);
  });

  /* Story: a live-looking control that refuses when clicked is how 1.15 taught
     users the command was broken. It answers before the press. */
  it("does not offer the press before the hashtables are there", () => {
    useHealthCheckReadiness.mockReturnValue("unsynced");
    render(<ModHealthCheckAction />);

    expect(press()).toBeDisabled();
  });

  it("does not offer the press while the tables are still landing", () => {
    useHealthCheckReadiness.mockReturnValue("syncing");
    render(<ModHealthCheckAction />);

    expect(press()).toBeDisabled();
  });
});
