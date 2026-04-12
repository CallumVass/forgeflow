interface ListedSkill {
  slug: string;
  description: string;
}

function stripAnsi(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index++) {
    const current = value[index];
    if (current === "\u001b" && value[index + 1] === "[") {
      index += 2;
      while (index < value.length) {
        const code = value.charCodeAt(index);
        if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) break;
        index++;
      }
      continue;
    }
    out += current;
  }
  return out;
}

export function parseSkillsListOutput(output: string): ListedSkill[] {
  const lines = stripAnsi(output).split("\n");
  const entries: ListedSkill[] = [];
  let inAvailableSkills = false;
  let pendingSlug: string | undefined;
  let pendingDescription: string[] = [];

  const flushPending = () => {
    if (!pendingSlug) return;
    entries.push({
      slug: pendingSlug,
      description: pendingDescription.join(" ").trim(),
    });
    pendingSlug = undefined;
    pendingDescription = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r/g, "").replace(/\s+$/, "");
    const body = line.replace(/^[│└◇]\s?/, "");
    const trimmed = body.trim();
    if (!trimmed) continue;

    if (!inAvailableSkills) {
      if (trimmed === "Available Skills") inAvailableSkills = true;
      continue;
    }

    if (trimmed.startsWith("Use --skill ")) break;

    const indent = body.match(/^\s*/)?.[0].length ?? 0;
    if (indent >= 3 && !trimmed.includes(" ")) {
      flushPending();
      pendingSlug = trimmed;
      continue;
    }

    if (pendingSlug && indent >= 5) {
      pendingDescription.push(trimmed);
    }
  }

  flushPending();
  return entries.filter((entry) => entry.description.length > 0);
}
