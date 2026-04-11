import { fetchAtlassianContentFromUrl, formatAtlassianContent } from "@callumvass/forgeflow-shared/atlassian/content";
import { extractJiraKey } from "@callumvass/forgeflow-shared/atlassian/jira";
import { type ConfluencePage, fetchConfluencePage } from "@callumvass/forgeflow-shared/confluence";
import {
  emptyStage,
  type PipelineContext,
  pipelineResult,
  toAgentOpts,
  withRunLifecycle,
} from "@callumvass/forgeflow-shared/pipeline";
import { prepareInvestigateSkillContext } from "../skills/index.js";

const URL_RE = /https?:\/\/[^\s)>\]]+/g;

export async function runInvestigate(description: string, templateUrl: string, pctx: PipelineContext) {
  return withRunLifecycle(pctx, "investigate", (innerPctx) => runInvestigateInner(description, templateUrl, innerPctx));
}

function trimTrailingUrlPunctuation(url: string): string {
  return url.replace(/[.,;:!?]+$/, "");
}

function normaliseUrl(url: string): string {
  try {
    return new URL(url).toString();
  } catch {
    return url.trim();
  }
}

function isAtlassianReferenceUrl(url: string): boolean {
  return url.includes("/wiki/") || extractJiraKey(url) !== null;
}

function extractAtlassianUrls(text: string): string[] {
  return Array.from(
    new Set(
      (text.match(URL_RE) ?? [])
        .map((url) => trimTrailingUrlPunctuation(url))
        .filter((url) => url.length > 0)
        .filter((url) => isAtlassianReferenceUrl(url)),
    ),
  );
}

async function buildReferenceSection(description: string, templateUrl: string): Promise<string | { error: string }> {
  const templateKey = templateUrl ? normaliseUrl(templateUrl) : "";
  const urls = extractAtlassianUrls(description).filter((url) => normaliseUrl(url) !== templateKey);
  if (urls.length === 0) return "";

  const references: string[] = [];
  for (const url of urls) {
    const result = await fetchAtlassianContentFromUrl(url);
    if (typeof result === "string") {
      return { error: `Failed to fetch Atlassian reference ${url}: ${result}` };
    }
    references.push(formatAtlassianContent(result));
  }

  return `\n\nADDITIONAL ATLASSIAN REFERENCES:\n\n${references.join("\n\n---\n\n")}`;
}

async function runInvestigateInner(description: string, templateUrl: string, pctx: PipelineContext) {
  const { ctx } = pctx;
  const interactive = ctx.hasUI;

  // Ask for required description interactively if not provided
  if (!description && interactive) {
    const input = await ctx.ui.input("What should we investigate?", "");
    description = input?.trim() ?? "";
  }
  if (!description) {
    return pipelineResult("No description provided.", "investigate", []);
  }

  // Ask for optional template URL interactively if not provided
  if (!templateUrl && interactive) {
    const input = await ctx.ui.input(
      "Template URL? (optional — Confluence supported)",
      "Leave blank to use the default investigation structure",
    );
    if (input != null && input.trim() !== "") {
      templateUrl = input.trim();
    }
  }

  let templateSection = "";
  if (templateUrl) {
    const result = await fetchConfluencePage(templateUrl, pctx.execSafeFn);
    if (typeof result === "string") {
      return pipelineResult(result, "investigate", [], true);
    }
    const page = result as ConfluencePage;
    templateSection = `\n\nTEMPLATE (from Confluence page "${page.title}"):\n\n${page.body}`;
  }

  const referenceSection = await buildReferenceSection(description, templateUrl);
  if (typeof referenceSection !== "string") {
    return pipelineResult(referenceSection.error, "investigate", [], true);
  }

  const prepared = await prepareInvestigateSkillContext(description, pctx);
  pctx = prepared.pctx;
  const stages = [emptyStage("investigator")];
  const opts = toAgentOpts(pctx, { stages, pipeline: "investigate" });

  const task = `Investigate the following topic and produce a structured markdown document.

TOPIC: ${description}${templateSection}${referenceSection}

${!templateUrl ? "No template was provided. Structure your output as: Problem, Context, Options (with comparison table), Recommendation, Next Steps." : "Use the provided template structure exactly."}
${referenceSection ? "\nAdditional Atlassian references were fetched above. Use them as source material. Only the section labelled TEMPLATE defines the output structure." : ""}

Read the writing-style skill before writing.`;

  await pctx.runAgentFn("investigator", task, opts);

  return pipelineResult("Investigation complete.", "investigate", stages);
}
