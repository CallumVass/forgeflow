import type {
  CommandAutocompleteItem,
  CommandDefinition,
  CommandHelpers,
  CommandInvocation,
} from "@callumvass/forgeflow-shared/extension";
import type { ForgeflowContext } from "@callumvass/forgeflow-shared/pipeline";

interface RememberedInvocation {
  issue?: string;
  target?: string;
  skipPlan?: boolean;
  skipReview?: boolean;
  strict?: boolean;
}

const remembered: Record<string, RememberedInvocation | undefined> = {};

export function rememberCommandInvocation(command: string, params: Record<string, unknown>): void {
  if (command === "implement" || command === "implement-last") {
    remember("implement", {
      issue: typeof params.issue === "string" ? params.issue : undefined,
      skipPlan: params.skipPlan === true,
      skipReview: params.skipReview === true,
    });
    return;
  }

  if (
    command === "review" ||
    command === "review-lite" ||
    command === "review-last" ||
    command === "review-current-pr"
  ) {
    remember(command === "review-current-pr" ? "review" : command.replace(/-last$/, ""), {
      target: typeof params.target === "string" ? params.target : undefined,
      strict: params.strict === true,
    });
  }
}

export function getRememberedInvocation(command: string): RememberedInvocation | undefined {
  if (command === "implement-last") return remembered.implement;
  if (command === "review-last") return remembered.review ?? remembered["review-lite"];
  return remembered[command];
}

export function hydrateRememberedInvocations(entries: Array<{ command?: unknown; params?: unknown }>): void {
  for (const entry of entries) {
    if (typeof entry.command !== "string") continue;
    const params = entry.params && typeof entry.params === "object" ? (entry.params as Record<string, unknown>) : {};
    rememberCommandInvocation(entry.command, params);
  }
}

interface SelectCandidate {
  label: string;
  invocation: CommandInvocation;
}

async function execText(helpers: CommandHelpers, command: string, args: string[]): Promise<string> {
  const result = await helpers.exec(command, args);
  if (result.code !== 0) return "";
  return result.stdout.trim();
}

async function execJson<T>(helpers: CommandHelpers, command: string, args: string[]): Promise<T | undefined> {
  const text = await execText(helpers, command, args);
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function appendFlagCompletions(prefix: string, flags: string[]): CommandAutocompleteItem[] | null {
  const trimmed = prefix.trimStart();
  const items = flags.filter((flag) => flag.startsWith(trimmed)).map((flag) => ({ value: flag, label: flag }));
  return items.length > 0 ? items : null;
}

function remember(command: string, invocation: RememberedInvocation): void {
  remembered[command] = invocation;
}

function issueSuffix(issue: string | undefined): string | undefined {
  if (!issue) return undefined;
  if (/^[A-Z]+-\d+$/.test(issue)) return "Do not interpret the issue key — pass it as-is.";
  if (/^\d+$/.test(issue)) return "Do not interpret the issue number — pass it as-is.";
  return undefined;
}

function rememberedIssueCandidate(command: string): SelectCandidate | undefined {
  const last = remembered[command];
  if (!last?.issue) return undefined;
  return {
    label: `Repeat last issue: ${last.issue}`,
    invocation: {
      params: {
        issue: last.issue,
        ...(last.skipPlan ? { skipPlan: true } : {}),
        ...(last.skipReview ? { skipReview: true } : {}),
      },
      suffix: issueSuffix(last.issue),
    },
  };
}

function rememberedReviewCandidate(command: string, strict: boolean): SelectCandidate | undefined {
  const last = remembered[command];
  if (!last) return undefined;
  const label = last.target ? `Repeat last target: ${last.target}` : "Repeat last target: current branch";
  return {
    label,
    invocation: {
      params: {
        ...(last.target ? { target: last.target } : {}),
        ...(strict || last.strict ? { strict: true } : {}),
      },
      suffix: "Do not interpret the target — pass it as-is.",
    },
  };
}

async function pickImplementIssue(
  ctx: ForgeflowContext,
  helpers: CommandHelpers,
): Promise<SelectCandidate | undefined> {
  const candidates: SelectCandidate[] = [];
  const branch = await execText(helpers, "git", ["branch", "--show-current"]);
  if (branch) {
    candidates.push({
      label: `Current branch: ${branch}`,
      invocation: {
        params: {},
        suffix:
          "No issue number provided — the tool will detect it from the current branch. Do NOT ask for an issue number.",
      },
    });
  }

  const rememberedCandidate = rememberedIssueCandidate("implement");
  if (rememberedCandidate) candidates.push(rememberedCandidate);

  const issues =
    (await execJson<Array<{ number: number; title: string }>>(helpers, "gh", [
      "issue",
      "list",
      "--limit",
      "8",
      "--json",
      "number,title",
    ])) ?? [];
  for (const issue of issues) {
    candidates.push({
      label: `GitHub #${issue.number}: ${issue.title}`,
      invocation: {
        params: { issue: String(issue.number) },
        suffix: "Do not interpret the issue number — pass it as-is.",
      },
    });
  }

  candidates.push({
    label: "Enter issue number, Jira key, or description…",
    invocation: { params: {} },
  });

  const selected = await ctx.ui.select(
    "Implement what?",
    candidates.map((candidate) => candidate.label),
  );
  if (!selected) return undefined;

  const picked = candidates.find((candidate) => candidate.label === selected);
  if (!picked) return undefined;
  if (picked.label !== "Enter issue number, Jira key, or description…") return picked;

  const issue = await ctx.ui.input("Issue number, Jira key, or description", "#123, PROJ-123, or summary");
  const trimmed = issue?.trim();
  if (!trimmed) return undefined;
  return {
    label: trimmed,
    invocation: {
      params: { issue: trimmed },
      suffix: issueSuffix(trimmed),
    },
  };
}

async function pickImplementFlags(
  ctx: ForgeflowContext,
): Promise<Pick<RememberedInvocation, "skipPlan" | "skipReview"> | undefined> {
  const labels = ["Full flow", "Skip planning", "Skip review", "Skip planning and review"];
  const selected = await ctx.ui.select("How should implement run?", labels);
  if (!selected) return undefined;
  if (selected === "Skip planning") return { skipPlan: true };
  if (selected === "Skip review") return { skipReview: true };
  if (selected === "Skip planning and review") return { skipPlan: true, skipReview: true };
  return {};
}

export async function launchImplement(
  ctx: ForgeflowContext,
  helpers: CommandHelpers,
): Promise<CommandInvocation | undefined> {
  const issueCandidate = await pickImplementIssue(ctx, helpers);
  if (!issueCandidate) return undefined;
  const flags = await pickImplementFlags(ctx);
  if (!flags) return undefined;

  const issue = issueCandidate.invocation.params?.issue as string | undefined;
  remember("implement", { issue, ...flags });

  return {
    params: {
      ...(issueCandidate.invocation.params ?? {}),
      ...(flags.skipPlan ? { skipPlan: true } : {}),
      ...(flags.skipReview ? { skipReview: true } : {}),
    },
    suffix: issueCandidate.invocation.suffix,
  };
}

async function pickReviewTarget(
  ctx: ForgeflowContext,
  helpers: CommandHelpers,
  commandName: string,
  strict: boolean,
): Promise<SelectCandidate | undefined> {
  const candidates: SelectCandidate[] = [];
  const rememberedCandidate = rememberedReviewCandidate(commandName, strict);
  if (rememberedCandidate) candidates.push(rememberedCandidate);

  const currentPr = await execJson<{ number: number; title: string }>(helpers, "gh", [
    "pr",
    "view",
    "--json",
    "number,title",
  ]);
  if (currentPr) {
    candidates.push({
      label: `Current PR #${currentPr.number}: ${currentPr.title}`,
      invocation: {
        params: { target: String(currentPr.number), ...(strict ? { strict: true } : {}) },
        suffix: "Do not interpret the target — pass it as-is.",
      },
    });
  }

  const branch = await execText(helpers, "git", ["branch", "--show-current"]);
  if (branch) {
    candidates.push({
      label: `Current branch: ${branch}`,
      invocation: {
        params: { ...(strict ? { strict: true } : {}) },
        suffix: "Do not interpret the target — pass it as-is.",
      },
    });
  }

  const prs =
    (await execJson<Array<{ number: number; title: string }>>(helpers, "gh", [
      "pr",
      "list",
      "--limit",
      "8",
      "--json",
      "number,title",
    ])) ?? [];
  for (const pr of prs) {
    candidates.push({
      label: `Open PR #${pr.number}: ${pr.title}`,
      invocation: {
        params: { target: String(pr.number), ...(strict ? { strict: true } : {}) },
        suffix: "Do not interpret the target — pass it as-is.",
      },
    });
  }

  candidates.push({ label: "Enter review target…", invocation: { params: {} } });

  const selected = await ctx.ui.select(
    "Review what?",
    candidates.map((candidate) => candidate.label),
  );
  if (!selected) return undefined;

  const picked = candidates.find((candidate) => candidate.label === selected);
  if (!picked) return undefined;
  if (picked.label !== "Enter review target…") return picked;

  const input = await ctx.ui.input("Review target", "PR number, --branch name, or leave blank for current branch");
  const trimmed = input?.trim();
  return {
    label: trimmed || "current branch",
    invocation: {
      params: {
        ...(trimmed ? { target: trimmed } : {}),
        ...(strict ? { strict: true } : {}),
      },
      suffix: "Do not interpret the target — pass it as-is.",
    },
  };
}

export async function launchReview(
  ctx: ForgeflowContext,
  helpers: CommandHelpers,
  opts: { commandName: string; strict: boolean },
): Promise<CommandInvocation | undefined> {
  const target = await pickReviewTarget(ctx, helpers, opts.commandName, opts.strict);
  if (!target) return undefined;

  let strict = opts.strict;
  if (!opts.strict) {
    const mode = await ctx.ui.select("Review mode", ["Full review", "Strict blocking review"]);
    if (!mode) return undefined;
    strict = mode === "Strict blocking review";
  }

  remember(opts.commandName, {
    target: target.invocation.params?.target as string | undefined,
    strict,
  });

  return {
    params: {
      ...(target.invocation.params ?? {}),
      ...(strict ? { strict: true } : {}),
    },
    suffix: target.invocation.suffix,
  };
}

function implementArgumentCompletions(prefix: string): CommandAutocompleteItem[] | null {
  return appendFlagCompletions(prefix, ["--skip-plan", "--skip-review"]);
}

export function reviewArgumentCompletions(prefix: string): CommandAutocompleteItem[] | null {
  return appendFlagCompletions(prefix, ["--strict", "--branch "]);
}

export function withLaunchers(commands: CommandDefinition[]): CommandDefinition[] {
  return commands.map((command) => {
    if (command.name === "implement") {
      return {
        ...command,
        getArgumentCompletions: implementArgumentCompletions,
        launch: launchImplement,
      };
    }
    if (command.name === "review") {
      return {
        ...command,
        getArgumentCompletions: reviewArgumentCompletions,
        launch: (ctx, helpers) => launchReview(ctx, helpers, { commandName: "review", strict: false }),
      };
    }
    if (command.name === "review-lite") {
      return {
        ...command,
        getArgumentCompletions: (prefix) => appendFlagCompletions(prefix, ["--branch "]),
        launch: (ctx, helpers) => launchReview(ctx, helpers, { commandName: "review-lite", strict: true }),
      };
    }
    return command;
  });
}
