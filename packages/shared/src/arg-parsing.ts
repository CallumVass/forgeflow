export interface FlagSpecs {
  boolean?: string[];
  value?: string[];
}

export interface FlagResult {
  flags: Record<string, string | true>;
  rest: string;
}

/** Extract --flag pairs from a raw args string. Returns extracted flags and remaining positional text. */
export function extractFlags(args: string, specs: FlagSpecs): FlagResult {
  const flags: Record<string, string | true> = {};
  let remaining = args;

  for (const flag of specs.value ?? []) {
    const regex = new RegExp(`${flag}\\s+(\\S+)`);
    const match = remaining.match(regex);
    if (match) {
      flags[flag] = match[1] ?? "";
      remaining = remaining.replace(match[0], "");
    }
  }

  for (const flag of specs.boolean ?? []) {
    if (remaining.includes(flag)) {
      flags[flag] = true;
      remaining = remaining.replaceAll(flag, "");
    }
  }

  return { flags, rest: remaining.replace(/\s+/g, " ").trim() };
}

/** Split a string into its first whitespace-delimited token and the rest. */
export function splitFirstToken(input: string): { first: string; rest: string } {
  const trimmed = input.trim();
  if (!trimmed) return { first: "", rest: "" };
  const idx = trimmed.indexOf(" ");
  if (idx === -1) return { first: trimmed, rest: "" };
  return { first: trimmed.slice(0, idx), rest: trimmed.slice(idx + 1).trim() };
}

/** Strip surrounding double quotes from a string. */
export function unquote(s: string): string {
  return s.replace(/^"(.*)"$/, "$1");
}
