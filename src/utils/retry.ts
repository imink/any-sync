import * as vscode from 'vscode';

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in ms before first retry (default: 1000) */
  initialDelay?: number;
  /** Maximum delay in ms (default: 30000) */
  maxDelay?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Optional output channel for logging */
  outputChannel?: vscode.OutputChannel;
}

/**
 * Determine if an error is retryable.
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Network errors
    if (msg.includes('econnreset') || msg.includes('econnrefused') ||
        msg.includes('etimedout') || msg.includes('enotfound') ||
        msg.includes('socket hang up') || msg.includes('network')) {
      return true;
    }
    // Rate limit errors (HTTP 403 or 429)
    if (msg.includes('rate limit') || msg.includes('429') || msg.includes('secondary rate')) {
      return true;
    }
    // Server errors (5xx)
    if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) {
      return true;
    }
  }

  // Check for status property (Octokit errors)
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: number }).status;
    if (status === 429 || status >= 500) {
      return true;
    }
  }

  return false;
}

/**
 * Execute an async function with exponential backoff retry.
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration
 * @returns The function's return value
 * @throws The last error if all retries fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    outputChannel,
  } = options;

  let lastError: unknown;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries || !isRetryableError(error)) {
        throw error;
      }

      const errMsg = error instanceof Error ? error.message : String(error);
      outputChannel?.appendLine(
        `GitHub Sync: Request failed (attempt ${attempt + 1}/${maxRetries + 1}): ${errMsg}. Retrying in ${delay}ms...`,
      );

      // Wait with jitter
      const jitter = Math.random() * delay * 0.1;
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));

      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }

  throw lastError;
}
