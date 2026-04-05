import { execSafe } from "./exec.js";

/**
 * Extract a Confluence page ID from a URL.
 * Handles both /wiki/spaces/.../pages/123456/Title and /wiki/pages/viewpage.action?pageId=123456
 */
function extractPageId(url: string): string | null {
  const idMatch = url.match(/\/pages\/(\d+)/);
  if (idMatch) return idMatch[1] ?? null;
  const paramMatch = url.match(/pageId=(\d+)/);
  if (paramMatch) return paramMatch[1] ?? null;
  return null;
}

/**
 * Strip HTML tags and convert basic Confluence storage format to plain text.
 */
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
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface ConfluencePage {
  id: string;
  title: string;
  body: string;
}

/**
 * Fetch a Confluence page by URL. Returns the page title and body as markdown-ish plain text.
 * Requires CONFLUENCE_URL, CONFLUENCE_EMAIL, CONFLUENCE_TOKEN env vars.
 */
export async function fetchConfluencePage(pageUrl: string): Promise<ConfluencePage | string> {
  const baseUrl = process.env.CONFLUENCE_URL;
  const email = process.env.CONFLUENCE_EMAIL;
  const token = process.env.CONFLUENCE_TOKEN;

  if (!baseUrl || !email || !token) {
    return "Missing Confluence env vars. Set CONFLUENCE_URL, CONFLUENCE_EMAIL, and CONFLUENCE_TOKEN.";
  }

  const pageId = extractPageId(pageUrl);
  if (!pageId) {
    return `Could not extract page ID from URL: ${pageUrl}`;
  }

  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const apiUrl = `${baseUrl.replace(/\/$/, "")}/wiki/api/v2/pages/${pageId}?body-format=storage`;

  const raw = await execSafe(`curl -s -H "Authorization: Basic ${auth}" -H "Accept: application/json" "${apiUrl}"`);

  if (!raw) return `Failed to fetch Confluence page ${pageId}.`;

  let data: { id: string; title: string; body?: { storage?: { value?: string } } };
  try {
    data = JSON.parse(raw);
  } catch {
    return `Could not parse Confluence response for page ${pageId}.`;
  }

  const html = data.body?.storage?.value ?? "";
  return {
    id: data.id ?? pageId,
    title: data.title ?? "Untitled",
    body: htmlToPlainText(html),
  };
}
