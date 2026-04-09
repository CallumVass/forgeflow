import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { mockForgeflowContext, mockPipelineContext } from "@callumvass/forgeflow-shared/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildInitialPrd, promptBootstrapPrd } from "./bootstrap.js";
import { prdExists, readPrd } from "./document.js";

describe("buildInitialPrd", () => {
  it("includes a technical direction section and open questions for missing inputs", () => {
    const prd = buildInitialPrd({
      productName: "QR Forge",
      productSummary: "A web app for generating downloadable QR codes.",
      usersAndProblem: "Solo founders need a quick way to create branded QR codes without design tools.",
      mainFlow: "A user lands on the app, enters a URL, customises the QR code, previews it, and downloads it.",
      successCriteria: "A new user can generate and download a QR code in under one minute.",
      outOfScope: "Analytics dashboards and team collaboration.",
      projectType: "Full-stack web app",
      stack: "TypeScript/Node.js",
      frameworkPreferences: "React with Tailwind using a standard starter template.",
      persistence: "",
      auth: "None for MVP.",
      testingBaseline: "Vitest and Playwright.",
      hosting: "Cloudflare",
      libraryPreferences: "Prefer Clerk if auth is later introduced.",
      integrationsAndConstraints: "Keep the initial release lightweight and low-cost.",
    });

    expect(prd).toContain("## Technical Direction");
    expect(prd).toContain("Project type: Full-stack web app");
    expect(prd).toContain("Preferred stack/ecosystem: TypeScript/Node.js");
    expect(prd).toContain(
      "App/runtime framework or delivery approach: React with Tailwind using a standard starter template.",
    );
    expect(prd).toContain("Testing baseline: Vitest and Playwright.");
    expect(prd).toContain("Preferred libraries/providers to use or avoid: Prefer Clerk if auth is later introduced.");
    expect(prd).toContain("## Alternatives Considered");
    expect(prd).toContain("Hosting/deployment target: Cloudflare");
    expect(prd).toContain("## Open Questions");
    expect(prd).toContain("Confirm whether the MVP needs durable persistence");
  });
});

describe("promptBootstrapPrd", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes an initial PRD draft from interactive answers", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prd-bootstrap-"));
    const select = vi.fn(async () => "Create starter PRD");
    const input = vi
      .fn()
      .mockResolvedValueOnce("QR Forge")
      .mockResolvedValueOnce("A simple web app for generating QR codes.")
      .mockResolvedValueOnce("Small business owners need a quick way to create shareable QR codes.")
      .mockResolvedValueOnce("A user enters a URL, previews the QR code, and downloads it.")
      .mockResolvedValueOnce("A user can create and download a QR code in under a minute.")
      .mockResolvedValueOnce("No user accounts or analytics in MVP.")
      .mockResolvedValueOnce("Full-stack web app")
      .mockResolvedValueOnce("TypeScript")
      .mockResolvedValueOnce("React with Tailwind using a standard starter template.")
      .mockResolvedValueOnce("None for MVP.")
      .mockResolvedValueOnce("None for MVP.")
      .mockResolvedValueOnce("Vitest and Playwright")
      .mockResolvedValueOnce("Cloudflare")
      .mockResolvedValueOnce("Prefer Clerk if auth is added later")
      .mockResolvedValueOnce("Keep costs low and use mainstream libraries.");
    const editor = vi.fn(async (_title: string, content: string) => content);
    const ctx = mockForgeflowContext({ hasUI: true, ui: { select, input, editor } });
    const pctx = mockPipelineContext({ cwd: tmpDir, ctx });

    const created = await promptBootstrapPrd(pctx);

    expect(created).toBe(true);
    expect(prdExists(tmpDir)).toBe(true);
    expect(readPrd(tmpDir)).toContain("# PRD: QR Forge");
    expect(readPrd(tmpDir)).toContain("## Technical Direction");
    expect(readPrd(tmpDir)).toContain("Project type: Full-stack web app");
    expect(readPrd(tmpDir)).toContain("Preferred stack/ecosystem: TypeScript");
    expect(readPrd(tmpDir)).toContain("Authentication/access model: None for MVP.");
    expect(readPrd(tmpDir)).toContain("Testing baseline: Vitest and Playwright");
    expect(readPrd(tmpDir)).toContain("## Alternatives Considered");
    expect(editor).toHaveBeenCalledOnce();
  });

  it("does not create a PRD when the user declines the bootstrap flow", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prd-bootstrap-"));
    const ctx = mockForgeflowContext({
      hasUI: true,
      ui: {
        select: vi.fn(async () => "Cancel"),
        input: vi.fn(async () => {
          throw new Error("input should not be called");
        }),
      },
    });
    const pctx = mockPipelineContext({ cwd: tmpDir, ctx });

    const created = await promptBootstrapPrd(pctx);

    expect(created).toBe(false);
    expect(prdExists(tmpDir)).toBe(false);
  });

  it("does not write a partial PRD when the questionnaire is cancelled", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prd-bootstrap-"));
    const input = vi.fn().mockResolvedValueOnce("QR Forge").mockResolvedValueOnce(undefined);
    const ctx = mockForgeflowContext({
      hasUI: true,
      ui: {
        select: vi.fn(async () => "Create starter PRD"),
        input,
      },
    });
    const pctx = mockPipelineContext({ cwd: tmpDir, ctx });

    const created = await promptBootstrapPrd(pctx);

    expect(created).toBe(false);
    expect(prdExists(tmpDir)).toBe(false);
  });
});
