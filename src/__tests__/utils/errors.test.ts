import type { AppError } from "@/lib/bindings";
import { hasErrorCode, isAppError } from "@/utils/errors";

describe("hasErrorCode", () => {
  it("is true when the codes match", () => {
    const error: AppError = { code: "INVALID_PATH", path: "/some/path" };
    expect(hasErrorCode(error, "INVALID_PATH")).toBe(true);
  });

  it("is false when the codes differ", () => {
    const error: AppError = { code: "IO", detail: "disk full" };
    expect(hasErrorCode(error, "INVALID_PATH")).toBe(false);
  });

  it("narrows to the variant's own fields", () => {
    const error: AppError = { code: "MOD_NOT_FOUND", modId: "test-mod" };
    if (!hasErrorCode(error, "MOD_NOT_FOUND")) throw new Error("expected a MOD_NOT_FOUND error");
    expect(error.modId).toBe("test-mod");
  });
});

describe("isAppError", () => {
  it("tells a backend error from a JS Error", () => {
    expect(isAppError({ code: "IO", detail: "disk full" })).toBe(true);
    expect(isAppError(new Error("boom"))).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError("IO")).toBe(false);
  });
});
