// @vitest-environment happy-dom

import type { Update } from "@tauri-apps/plugin-updater";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReleaseNote } from "@/lib/tauri";
import { useUpdaterStore } from "@/stores";
import { renderWithProviders } from "@/test/utils";

import type { ReleaseFeed, UseReleaseHistoryOptions } from "../../api";
import { UpdateChangelogDialog } from "../UpdateChangelogDialog";

const useReleaseHistory = vi.fn<(options: UseReleaseHistoryOptions) => ReleaseFeed>();

vi.mock("../../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api")>()),
  useReleaseHistory: (options: UseReleaseHistoryOptions) => useReleaseHistory(options),
}));

const UPDATE = {
  version: "1.15.0",
  currentVersion: "1.14.1",
  body: "## Fixes\n\n- The patcher lets go of the executable",
} as unknown as Update;

function release(version: string, body: string, over: Partial<ReleaseNote> = {}): ReleaseNote {
  return {
    version,
    tag: `v${version}`,
    body,
    publishedAt: "2026-07-04T12:00:00Z",
    prerelease: false,
    url: `https://github.com/LeagueToolkit/ltk-manager/releases/tag/v${version}`,
    ...over,
  };
}

function history(over: Partial<ReleaseFeed> = {}): ReleaseFeed {
  return {
    releases: [],
    isPending: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    error: null,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    ...over,
  };
}

describe("UpdateChangelogDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useReleaseHistory.mockReturnValue(history());
    useUpdaterStore.setState({
      update: UPDATE,
      dialogOpen: true,
      updating: false,
      progress: 0,
      error: null,
      skippedVersion: null,
    });
  });

  it("names the version on offer and what it changes", () => {
    renderWithProviders(<UpdateChangelogDialog />);

    expect(screen.getByRole("heading", { name: "What's New" })).toBeVisible();
    expect(screen.getByText("v1.14.1 → v1.15.0")).toBeVisible();
    expect(screen.getByText("The patcher lets go of the executable")).toBeVisible();
    expect(screen.getByRole("button", { name: "Update Now" })).toBeVisible();
  });

  /* The install replaces the running executable, so the dialog holds the user
     until it is over - there is nothing to close it with and nothing to skip. */
  it("offers no way out while the install runs", () => {
    useUpdaterStore.setState({ updating: true, progress: 40 });
    renderWithProviders(<UpdateChangelogDialog />);

    expect(screen.getByText("Installing update")).toBeVisible();
    expect(screen.getByText("40%")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Update Now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("turns a failed install into a retry", () => {
    useUpdaterStore.setState({ error: "signature mismatch" });
    renderWithProviders(<UpdateChangelogDialog />);

    expect(screen.getByRole("alert")).toHaveTextContent("Update failed");
    expect(screen.getByRole("alert")).toHaveTextContent("signature mismatch");
    expect(screen.getByRole("button", { name: "Retry Update" })).toBeVisible();
  });

  it("marks the offered release and reads it while the history is still loading", () => {
    useReleaseHistory.mockReturnValue(history({ isPending: true, hasNextPage: true }));
    renderWithProviders(<UpdateChangelogDialog />);

    expect(screen.getByRole("heading", { name: "v1.15.0" })).toBeVisible();
    expect(screen.getByText("New")).toBeVisible();
    expect(screen.getByText("The patcher lets go of the executable")).toBeVisible();
  });

  it("lists past releases under the one on offer", () => {
    useReleaseHistory.mockReturnValue(
      history({
        releases: [
          release("1.14.1", "- Zoom hotkeys survive a restart"),
          release("1.14.0-rc.1", "- An overlay that mounts nothing", { prerelease: true }),
        ],
      }),
    );
    renderWithProviders(<UpdateChangelogDialog />);

    expect(screen.getByRole("heading", { name: "v1.14.1" })).toBeVisible();
    expect(screen.getByText("Zoom hotkeys survive a restart")).toBeVisible();
    expect(screen.getByText("Pre-release")).toBeVisible();
    expect(screen.getByText("No older releases")).toBeVisible();
  });

  /* Being offline or rate-limited costs the reader the history, not the update
     the dialog was opened for. */
  it("keeps the pending notes and the install actions when the history fails", () => {
    const refetch = vi.fn();
    useReleaseHistory.mockReturnValue(
      history({
        error: { code: "RELEASES", kind: "OFFLINE", detail: "dns lookup failed" },
        refetch,
      }),
    );
    renderWithProviders(<UpdateChangelogDialog />);

    expect(screen.getByText("The patcher lets go of the executable")).toBeVisible();
    expect(screen.getByRole("button", { name: "Update Now" })).toBeVisible();
    expect(screen.getByText("Skip this version")).toBeVisible();

    expect(screen.getByText("Couldn't load older releases")).toBeVisible();
    expect(screen.getByText("Check your connection and try again.")).toBeVisible();
    expect(screen.queryByText("dns lookup failed")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    screen.getByRole("button", { name: "Retry" }).click();
    expect(refetch).toHaveBeenCalledOnce();
  });

  /* The offered release is drawn from the update itself, so the history is
     asked for everything but that version rather than filtering it twice. */
  it("keeps the offered version out of the history it asks for", () => {
    renderWithProviders(<UpdateChangelogDialog />);

    expect(useReleaseHistory).toHaveBeenCalledWith({ enabled: true, excludeVersion: "1.15.0" });
  });
});
