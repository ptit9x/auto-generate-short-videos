import { sleep } from "./sleep.js";

export interface RetryOptions {
  /** Delay schedule in ms (default: [1000, 2000, 4000]) */
  delays?: number[];
  /** Function to decide if an error is retryable (default: always true) */
  isRetryable?: (err: unknown) => boolean;
  /** Optional label for log messages */
  label?: string;
}

/**
 * Retry an async function with exponential backoff.
 * Total attempts = delays.length + 1 (initial + retries).
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const delays = opts.delays ?? [1000, 2000, 4000];
  const isRetryable = opts.isRetryable ?? (() => true);
  let lastError: unknown;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < delays.length && isRetryable(err)) {
        await sleep(delays[attempt]);
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}
