import type { ActionResult } from "@/lib/types";

type DbError = { code?: string; message?: string } | null | undefined;

/**
 * Turns a database error into something safe to show. Messages raised by our
 * own triggers are already written for people; everything else is logged and
 * replaced, so raw SQL errors never reach the screen.
 */
export function friendlyError(error: DbError, fallback = "Something went wrong. Please try again.") {
  if (!error) {
    return fallback;
  }
  const message = error.message ?? "";
  const isPolicyError = /row-level security|permission denied/i.test(message);

  switch (error.code) {
    case "42501":
      return isPolicyError || !message ? "You don't have permission to do that." : message;
    case "23505":
      return "That already exists. Please use a different value.";
    case "23503":
      return "This record is still in use, so it can't be removed.";
    case "23514":
      return /violates check constraint/i.test(message) ? "One of the values isn't allowed." : message;
    case "P0002":
      return message || "That record could not be found.";
    case "PGRST116":
      return "That record could not be found, or you don't have access to it.";
    default:
      console.error("Database error:", describeError(error));
      return fallback;
  }
}

export function fail(error: DbError | string, fallback?: string): ActionResult<never> {
  return { ok: false, error: typeof error === "string" ? error : friendlyError(error, fallback) };
}

type Failure = { ok: false; error: string };

export const NOT_ALLOWED: Failure = {
  ok: false,
  error: "You don't have permission to do that.",
};

export const INVALID_INPUT: Failure = {
  ok: false,
  error: "Please check the form and try again.",
};

/**
 * Supabase errors are Error objects, which print as `{}` in the dev log.
 * This pulls out the parts worth reading.
 */
export function describeError(error: unknown) {
  if (!error || typeof error !== "object") {
    return String(error);
  }
  const { code, message, details, hint } = error as Record<string, unknown>;
  return [code && `[${code}]`, message, details, hint && `hint: ${hint}`].filter(Boolean).join(" ") || "Unknown error";
}