import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Send a message to the Pi chat UI.
 */
export function sendChat(pi: ExtensionAPI, text: string, triggerTurn = false) {
  pi.sendMessage(
    { customType: "forgeflow", content: text, display: true },
    { triggerTurn }
  );
}

/**
 * Send an error message to the Pi chat UI.
 */
export function sendError(pi: ExtensionAPI, text: string) {
  pi.sendMessage(
    { customType: "forgeflow-error", content: text, display: true },
    { triggerTurn: false }
  );
}
