import type { AppError } from "@/lib/bindings";

export type { AppError, OverlayErrorCategory } from "@/lib/bindings";

/** The `code` tag of an `AppError`, the name a caller branches on. */
export type ErrorCode = AppError["code"];

/** Narrows `error` to the variant tagged `code`, so its fields are in reach. */
export function hasErrorCode<T extends ErrorCode>(
  error: AppError,
  code: T,
): error is Extract<AppError, { code: T }> {
  return error.code === code;
}

/** Whether a thrown value is a backend error rather than a JS `Error`. */
export function isAppError(error: unknown): error is AppError {
  return (
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
  );
}

/** Extract a human-readable message from an AppError. */
export function getAppErrorMessage(error: AppError): string {
  return "detail" in error ? error.detail : error.code;
}
