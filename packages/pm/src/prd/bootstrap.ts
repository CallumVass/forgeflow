import type { PipelineContext } from "@callumvass/forgeflow-shared/pipeline";
import { promptEditPrd, writePrd } from "./document.js";

interface InitialPrdAnswers {
  productName: string;
  productSummary: string;
  usersAndProblem: string;
  mainFlow: string;
  successCriteria: string;
  outOfScope: string;
  projectType: string;
  stack: string;
  frameworkPreferences: string;
  persistence: string;
  auth: string;
  testingBaseline: string;
  hosting: string;
  libraryPreferences: string;
  integrationsAndConstraints: string;
}

interface BootstrapQuestion {
  key: keyof InitialPrdAnswers;
  title: string;
  placeholder: string;
}

const QUESTIONS: BootstrapQuestion[] = [
  {
    key: "productName",
    title: "Project or product name?",
    placeholder: "e.g. QR Forge",
  },
  {
    key: "productSummary",
    title: "What are you building?",
    placeholder: "e.g. A web app for generating downloadable QR codes",
  },
  {
    key: "usersAndProblem",
    title: "Who is it for, and what problem are you solving?",
    placeholder: "e.g. Small businesses need a fast way to create QR codes without design tools",
  },
  {
    key: "mainFlow",
    title: "Describe the main MVP flow from trigger to outcome",
    placeholder: "e.g. A user lands on the app, enters a URL, previews the QR code, and downloads it",
  },
  {
    key: "successCriteria",
    title: "How will you know the MVP is successful?",
    placeholder: "e.g. A new user can complete the core flow in under one minute",
  },
  {
    key: "outOfScope",
    title: "What is explicitly out of scope for MVP?",
    placeholder: "Leave blank if undecided",
  },
  {
    key: "projectType",
    title: "What kind of project is this?",
    placeholder: "e.g. Full-stack web app, API service, CLI tool, worker, or leave blank",
  },
  {
    key: "stack",
    title: "Preferred stack or ecosystem?",
    placeholder: "e.g. TypeScript/Node.js, .NET, Elixir/Phoenix, Python, or leave blank",
  },
  {
    key: "frameworkPreferences",
    title: "Preferred app/runtime framework, starter, or delivery approach?",
    placeholder: "e.g. Next.js, ASP.NET Core MVC, Phoenix LiveView, Hono on Cloudflare, or leave blank",
  },
  {
    key: "persistence",
    title: "Persistence or data storage needs?",
    placeholder: "e.g. None for MVP, SQLite, Postgres, D1, or leave blank",
  },
  {
    key: "auth",
    title: "Authentication or access model?",
    placeholder: "e.g. None for MVP, email login, OAuth, admin-only, or leave blank",
  },
  {
    key: "testingBaseline",
    title: "Preferred testing baseline?",
    placeholder: "e.g. Vitest + Playwright, xUnit + Playwright, ExUnit + Phoenix tests, or leave blank",
  },
  {
    key: "hosting",
    title: "Hosting or deployment target?",
    placeholder: "e.g. Cloudflare, Vercel, Fly, Railway, Azure, Render, VPS, or leave blank",
  },
  {
    key: "libraryPreferences",
    title: "Any preferred libraries/providers to use or avoid?",
    placeholder: "e.g. Use Clerk, prefer Vue, avoid Firebase, or leave blank",
  },
  {
    key: "integrationsAndConstraints",
    title: "External integrations or hard constraints?",
    placeholder: "e.g. Stripe, email, low cost, no vendor lock-in, or leave blank",
  },
];

function clean(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function answerOrFallback(value: string, fallback: string): string {
  const trimmed = clean(value);
  return trimmed || fallback;
}

function isExplicitNone(value: string): boolean {
  const trimmed = clean(value).toLowerCase();
  return trimmed === "none" || trimmed === "none for mvp." || trimmed === "none for mvp" || trimmed === "n/a";
}

function buildOpenQuestions(answers: InitialPrdAnswers): string[] {
  const questions: string[] = [];

  if (!clean(answers.productSummary)) questions.push("Clarify the exact product shape and the first release boundary.");
  if (!clean(answers.usersAndProblem))
    questions.push("Name the primary users and the pain point the product should solve first.");
  if (!clean(answers.mainFlow)) questions.push("Describe the end-to-end MVP user journey from trigger to outcome.");
  if (!clean(answers.successCriteria)) questions.push("Define measurable success criteria for the MVP.");
  if (!clean(answers.projectType)) questions.push("Confirm the project type or application shape for the MVP.");
  if (!clean(answers.stack)) questions.push("Confirm the preferred stack or ecosystem for implementation.");
  if (!clean(answers.frameworkPreferences)) {
    questions.push("Confirm the preferred app/runtime framework, starter, or delivery approach for the MVP.");
  }
  if (!clean(answers.persistence))
    questions.push("Confirm whether the MVP needs durable persistence, and if so what kind.");
  if (!clean(answers.auth)) questions.push("Confirm whether the MVP needs authentication or can launch anonymously.");
  if (!clean(answers.testingBaseline))
    questions.push("Confirm the baseline testing approach the project should standardise on.");
  if (!clean(answers.hosting)) questions.push("Confirm the intended hosting or deployment target.");
  if (!clean(answers.libraryPreferences)) {
    questions.push("List any preferred providers or libraries to use or avoid for project-shaping concerns.");
  }
  if (!clean(answers.integrationsAndConstraints))
    questions.push("List any required integrations or hard delivery constraints.");

  return questions;
}

function buildFunctionalRequirements(answers: InitialPrdAnswers): string[] {
  const requirements = [
    "The product should support the primary MVP flow described in the user journey end to end.",
    "The product should make success, validation failures, and empty states clear to the user.",
    "The first release should stay tightly focused on the MVP scope described in this PRD.",
  ];

  if (clean(answers.persistence) && !isExplicitNone(answers.persistence)) {
    requirements.push(`The MVP should persist the data needed for: ${clean(answers.persistence)}.`);
  }
  if (clean(answers.auth) && !isExplicitNone(answers.auth)) {
    requirements.push(`The MVP should enforce this access model: ${clean(answers.auth)}.`);
  }
  if (clean(answers.integrationsAndConstraints)) {
    requirements.push(
      `The MVP should account for these integrations or constraints: ${clean(answers.integrationsAndConstraints)}.`,
    );
  }

  return requirements;
}

export function buildInitialPrd(answers: InitialPrdAnswers): string {
  const productName = answerOrFallback(answers.productName, "New Project");
  const outOfScope = answerOrFallback(
    answers.outOfScope,
    "Anything beyond the core MVP flow should stay out of scope until the first release is validated.",
  );
  const openQuestions = buildOpenQuestions(answers);
  const functionalRequirements = buildFunctionalRequirements(answers);

  return [
    `# PRD: ${productName}`,
    "",
    "## Product Summary",
    answerOrFallback(answers.productSummary, "TBD during PRD QA."),
    "",
    "## Problem & Users",
    `- Target users and pain point: ${answerOrFallback(answers.usersAndProblem, "TBD during PRD QA.")}`,
    "",
    "## Goals",
    `- Deliver an MVP that supports this core journey: ${answerOrFallback(answers.mainFlow, "TBD during PRD QA.")}`,
    `- Success criteria: ${answerOrFallback(answers.successCriteria, "TBD during PRD QA.")}`,
    "",
    "## Non-Goals",
    `- ${outOfScope}`,
    "",
    "## MVP User Journey",
    answerOrFallback(answers.mainFlow, "TBD during PRD QA."),
    "",
    "## Functional Requirements",
    ...functionalRequirements.map((item) => `- ${item}`),
    "",
    "## Technical Direction",
    `- Project type: ${answerOrFallback(answers.projectType, "Undecided — confirm during PRD QA.")}`,
    `- Preferred stack/ecosystem: ${answerOrFallback(answers.stack, "Undecided — choose during PRD QA.")}`,
    `- App/runtime framework or delivery approach: ${answerOrFallback(answers.frameworkPreferences, "Undecided — prefer a standard framework, starter, or platform convention rather than bespoke setup.")}`,
    `- Persistence: ${answerOrFallback(answers.persistence, "Undecided — confirm during PRD QA.")}`,
    `- Authentication/access model: ${answerOrFallback(answers.auth, "Undecided — confirm during PRD QA.")}`,
    `- Testing baseline: ${answerOrFallback(answers.testingBaseline, "Undecided — confirm during PRD QA.")}`,
    `- Preferred libraries/providers to use or avoid: ${answerOrFallback(answers.libraryPreferences, "None stated yet — capture project-shaping preferences during PRD QA.")}`,
    `- Hosting/deployment target: ${answerOrFallback(answers.hosting, "Undecided — confirm during PRD QA.")}`,
    `- Integrations/constraints: ${answerOrFallback(answers.integrationsAndConstraints, "None identified yet.")}`,
    "- Delivery guardrails: Prefer mainstream libraries and framework conventions from the chosen ecosystem over bespoke plumbing unless the product requirements explicitly demand otherwise.",
    "",
    "## Alternatives Considered",
    "- None captured yet. Use /prd-qa to record the chosen option plus brief alternatives for project-shaping decisions such as framework/runtime, auth, persistence, or testing when those choices materially affect implementation.",
    "",
    "## Open Questions",
    ...(openQuestions.length > 0
      ? openQuestions.map((item) => `- ${item}`)
      : ["- None at this stage. Use /prd-qa to tighten behavioural detail and edge cases."]),
    "",
  ].join("\n");
}

async function askInitialPrdQuestions(pctx: PipelineContext): Promise<InitialPrdAnswers | null> {
  const answers = {} as Record<keyof InitialPrdAnswers, string>;

  for (const question of QUESTIONS) {
    const input = await pctx.ctx.ui.input(question.title, question.placeholder);
    if (input == null) return null;
    answers[question.key] = clean(input);
  }

  return answers as InitialPrdAnswers;
}

interface BootstrapPromptOptions {
  confirmationTitle?: string;
}

export async function promptBootstrapPrd(
  pctx: PipelineContext,
  options: BootstrapPromptOptions = {},
): Promise<boolean> {
  const { ctx, cwd } = pctx;
  if (!ctx.hasUI) return false;

  const action = await ctx.ui.select(
    options.confirmationTitle ?? "PRD.md not found. Create an initial PRD draft now?",
    ["Create starter PRD", "Cancel"],
  );
  if (action !== "Create starter PRD") return false;

  const answers = await askInitialPrdQuestions(pctx);
  if (!answers) return false;

  writePrd(cwd, buildInitialPrd(answers));
  await promptEditPrd(pctx, "Review initial PRD");
  return true;
}
