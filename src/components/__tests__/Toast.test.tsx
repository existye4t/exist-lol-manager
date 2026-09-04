// @vitest-environment happy-dom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { useToast } from "../Toast";
import { ToastProvider } from "../ToastProvider";

/** Raises one toast on mount, which is how every caller reaches the manager. */
function Raise({ action, timeout }: { action?: () => void; timeout?: number }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        toast.toast({
          title: "Detected issues with mods",
          timeout,
          action: action && { label: "Show me", onClick: action },
        })
      }
    >
      Raise
    </button>
  );
}

async function raise(props: { action?: () => void; timeout?: number } = {}) {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <Raise {...props} />
    </ToastProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Raise" }));
  return user;
}

const line = () => screen.queryByText("Detected issues with mods");

describe("ToastItem", () => {
  /* Story: the reader pressed Show me, the panel opened, and the toast stayed
     sitting over it - the same press asked for twice. */
  it("closes itself when its action is taken", async () => {
    const action = vi.fn();
    const user = await raise({ action });
    expect(line()).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show me" }));

    expect(action).toHaveBeenCalled();
    await waitFor(() => expect(line()).not.toBeInTheDocument());
  });

  it("goes away when its countdown runs out", async () => {
    await raise({ timeout: 200 });
    expect(line()).toBeInTheDocument();

    await waitFor(() => expect(line()).not.toBeInTheDocument(), { timeout: 3000 });
  });
});
