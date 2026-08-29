import { dispatchNotification, type ProjectConfig } from "@actalk/castor-core";
import { loadConfig, logError } from "./utils.js";

export interface CliNotifyMessage {
  readonly title: string;
  readonly body: string;
}

/**
 * Send a command-level notification (--notify) to the project's configured
 * notify channels. Callers guard with the --notify flag before invoking so
 * message strings are only assembled when a notification will be attempted.
 *
 * - Uses the caller's already-loaded project config when provided; otherwise
 *   loads it here (failure paths may fail before the command loaded it).
 * - Never throws: notification delivery must not change the command's exit
 *   code, so every failure is written to stderr as a warning instead.
 */
export async function sendCommandNotification(
  message: CliNotifyMessage,
  config?: ProjectConfig,
): Promise<void> {
  try {
    const resolved = config ?? (await loadConfig());
    const channels = resolved.notify ?? [];
    if (channels.length === 0) {
      logError("--notify: no notify channels configured in project config (notify: []), skipping notification");
      return;
    }
    await dispatchNotification(channels, message);
  } catch (e) {
    logError(`--notify: failed to send notification: ${e}`);
  }
}
