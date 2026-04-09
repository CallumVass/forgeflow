function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractText(value: unknown): string {
  if (!isRecord(value)) return "";
  const type = typeof value.type === "string" ? value.type : "";
  const children = Array.isArray(value.content) ? value.content : [];

  switch (type) {
    case "doc":
      return children.map(extractText).join("");
    case "paragraph":
      return `${children.map(extractText).join("")}\n\n`;
    case "heading": {
      const attrs = isRecord(value.attrs) ? value.attrs : undefined;
      const level = typeof attrs?.level === "number" ? attrs.level : 1;
      return `${"#".repeat(Math.max(1, Math.min(level, 6)))} ${children.map(extractText).join("")}\n\n`;
    }
    case "text": {
      let text = typeof value.text === "string" ? value.text : "";
      const marks = Array.isArray(value.marks) ? value.marks : [];
      for (const mark of marks) {
        if (!isRecord(mark) || typeof mark.type !== "string") continue;
        if (mark.type === "strong") text = `**${text}**`;
        else if (mark.type === "em") text = `*${text}*`;
        else if (mark.type === "code") text = `\`${text}\``;
      }
      return text;
    }
    case "hardBreak":
      return "\n";
    case "bulletList":
      return `${children.map((child) => `- ${extractListItemText(child)}`).join("\n")}\n\n`;
    case "orderedList":
      return `${children.map((child, index) => `${index + 1}. ${extractListItemText(child)}`).join("\n")}\n\n`;
    case "listItem":
      return extractListItemText(value);
    case "codeBlock":
      return `\n\`\`\`\n${children.map(extractText).join("")}\n\`\`\`\n\n`;
    case "rule":
      return "\n---\n\n";
    default:
      return children.map(extractText).join("");
  }
}

function extractListItemText(value: unknown): string {
  if (!isRecord(value)) return "";
  const children = Array.isArray(value.content) ? value.content : [];
  return normalisePlainText(children.map(extractText).join("\n")).replace(/\n+/g, " ");
}

function paragraphFromBlock(block: string): Record<string, unknown> {
  const lines = block.split("\n");
  const content: Array<Record<string, unknown>> = [];
  lines.forEach((line, index) => {
    if (index > 0) content.push({ type: "hardBreak" });
    if (line.length > 0) content.push({ type: "text", text: line });
  });
  return { type: "paragraph", content };
}

export function normalisePlainText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function adfToPlainText(value: unknown): string {
  return normalisePlainText(extractText(value));
}

export function plainTextToAdf(text: string): Record<string, unknown> {
  const blocks = normalisePlainText(text)
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  return {
    version: 1,
    type: "doc",
    content: blocks.map(paragraphFromBlock),
  };
}
