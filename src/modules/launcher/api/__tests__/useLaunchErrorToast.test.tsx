// @vitest-environment happy-dom

import { act, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { ToastProvider } from "@/components";
import type { AppError, LauncherError } from "@/lib/tauri";

import { useLaunchErrorToast } from "../useLaunchErrorToast";

function wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

function launchError(error: LauncherError): AppError {
  return { code: "LAUNCHER", error };
}

async function show(error: AppError) {
  const { result } = renderHook(() => useLaunchErrorToast(), { wrapper });
  await act(async () => result.current(error));
}

describe("useLaunchErrorToast", () => {
  /// The code says only that a launch failed, so every remedy is chosen from
  /// the error's `kind`.
  it.each([
    [{ kind: "RIOT_CLIENT_NOT_FOUND", installsPath: "C:/x.json" }, "Can't find your Riot Client"],
    [{ kind: "RIOT_CLIENT_UNREACHABLE", reason: "HTTP 404" }, "Couldn't reach the Riot Client"],
    [{ kind: "SPAWN_FAILED", reason: "access denied" }, "Couldn't start the Riot Client"],
    [{ kind: "UNSUPPORTED_PLATFORM" }, "Launching isn't supported here"],
  ] as [LauncherError, string][])("reads the remedy off %o", async (error, title) => {
    await show(launchError(error));

    expect(screen.getByText(title)).toBeInTheDocument();
  });

  /// Riot's own answer is the remedy, so a refusal it names gets our wording
  /// and one it does not gets Riot's prose through unedited.
  it("answers a refusal Riot explained", async () => {
    await show(
      launchError({
        kind: "REFUSED",
        riotErrorCode: "eula_not_accepted",
        message: "eula",
      }),
    );

    expect(screen.getByText("Riot's Terms of Service need accepting")).toBeInTheDocument();
  });

  it("passes a refusal it does not know through unedited", async () => {
    await show(
      launchError({
        kind: "REFUSED",
        riotErrorCode: "something_new",
        message: "The client said no.",
      }),
    );

    expect(screen.getByText("The Riot Client refused to launch League")).toBeInTheDocument();
    expect(screen.getByText("The client said no.")).toBeInTheDocument();
  });

  /// A cancel is the user's own doing. A toast saying the launch broke, behind
  /// a Cancel button they just pressed, is the one thing this must never do.
  it("says nothing about a launch the user cancelled", async () => {
    await show(launchError({ kind: "STOPPED" }));

    expect(screen.queryByText("Couldn't launch League")).not.toBeInTheDocument();
  });

  /// A launch can fail before the launcher is reached, and that failure still
  /// has to read as a launch failure.
  it("frames a failure that is not the launcher's", async () => {
    await show({ code: "IO", detail: "disk full" });

    expect(screen.getByText("Couldn't launch League")).toBeInTheDocument();
    expect(screen.getByText("disk full")).toBeInTheDocument();
  });
});
