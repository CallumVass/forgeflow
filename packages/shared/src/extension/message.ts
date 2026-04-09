// ─── Message template builder ────────────────────────────────────────

/** Build the sendUserMessage template string for a command invocation. */
export function buildSendMessage(
  toolName: string,
  pipeline: string,
  params: Record<string, string | number | boolean | undefined>,
  suffix?: string,
): string {
  let msg = `Call the ${toolName} tool now with these exact parameters: pipeline="${pipeline}"`;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      msg += `, ${key}="${value}"`;
    } else {
      msg += `, ${key}=${value}`;
    }
  }
  msg += ".";
  if (suffix) msg += ` ${suffix}`;
  return msg;
}
