import { normalisePlainText } from "../adf.js";
import type { ConfluencePage } from "../confluence/types.js";
import { isRecord } from "./deps.js";

export function extractPageId(url: string): string | null {
  const pathMatch = url.match(/\/pages\/(\d+)/);
  if (pathMatch?.[1]) return pathMatch[1];
  const paramMatch = url.match(/[?&]pageId=(\d+)/);
  return paramMatch?.[1] ?? null;
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<h([1-6])[^>]*>/gi, (_m, level) => `${"#".repeat(parseInt(level as string, 10))} `)
    .replace(/<\/?strong>/gi, "**")
    .replace(/<\/?em>/gi, "*")
    .replace(/<\/?code>/gi, "`")
    .replace(
      /<ac:structured-macro[^>]*ac:name="code"[^>]*>[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/gi,
      "\n```\n$1\n```\n",
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function parseConfluencePageResponse(data: unknown, pageId: string): ConfluencePage | string {
  if (!isRecord(data)) return `Unexpected Confluence response for page ${pageId}.`;

  const nested = isRecord(data.page) ? data.page : isRecord(data.result) ? data.result : data;
  if (typeof nested.body === "string") {
    return {
      id: typeof nested.id === "string" ? nested.id : pageId,
      title: typeof nested.title === "string" ? nested.title : "Untitled",
      body: normalisePlainText(nested.body),
    };
  }

  const title = typeof nested.title === "string" ? nested.title : "Untitled";
  const bodyRecord = isRecord(nested.body) ? nested.body : undefined;
  const storageRecord = bodyRecord && isRecord(bodyRecord.storage) ? bodyRecord.storage : undefined;
  const html = typeof storageRecord?.value === "string" ? storageRecord.value : "";

  return {
    id: typeof nested.id === "string" ? nested.id : pageId,
    title,
    body: normalisePlainText(htmlToPlainText(html)),
  };
}
