import axios from 'axios';

/**
 * Extract the backend-provided error string (`{ error: string }`) from an axios
 * error response, if present. Returns undefined for non-axios errors or when the
 * response carries no `error` field.
 */
export function apiErrorText(err: unknown): string | undefined {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string } | undefined;
    return data?.error ?? undefined;
  }
  return undefined;
}

/** Best-effort message from any thrown value. */
export function errorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}
