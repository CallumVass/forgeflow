import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SKILLS } from "../config/forgeflow-config.js";
import { mockPipelineSkillRuntime, setupIsolatedHomeFixture } from "../testing/index.js";
import {
  buildSkillScanReport,
  buildSkillSelectionReport,
  detectSkillSignals,
  prepareSkillContext,
  renderSkillSelectionReport,
  type SkillSignalDetector,
} from "./index.js";

function writeSkill(root: string, name: string, description: string): void {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    "utf-8",
  );
}

describe("skills", () => {
  const fixture = setupIsolatedHomeFixture("skills-index");

  it("discovers common cross-agent roots and prefers a project-local skill over a global duplicate", async () => {
    const projectClaude = path.join(fixture.cwdDir, ".claude", "skills");
    const globalAgents = path.join(fixture.homeDir, ".agents", "skills");
    fs.mkdirSync(projectClaude, { recursive: true });
    fs.mkdirSync(globalAgents, { recursive: true });
    writeSkill(projectClaude, "tailwind", "Tailwind CSS guidance for UI work.");
    writeSkill(globalAgents, "tailwind", "Older global Tailwind guidance.");

    const report = await buildSkillSelectionReport(fixture.cwdDir, DEFAULT_SKILLS, {
      command: "implement",
      issueText: "Build a Tailwind UI",
    });

    expect(report.discoveredSkills.map((skill) => skill.name)).toContain("tailwind");
    expect(report.duplicates).toHaveLength(1);
    expect(report.duplicates[0]?.chosen.filePath).toContain(path.join(fixture.cwdDir, ".claude", "skills", "tailwind"));
  });

  it("discovers workspace package skill roots declared through package.json pi.skills", async () => {
    const pkgDir = path.join(fixture.cwdDir, "packages", "dev");
    const pkgSkills = path.join(pkgDir, "skills", "code-review");
    fs.mkdirSync(pkgSkills, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "@repo/dev", pi: { skills: ["./skills"] } }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(pkgSkills, "SKILL.md"),
      "---\nname: code-review\ndescription: Structured review guidance.\n---\n",
      "utf-8",
    );

    const report = await buildSkillSelectionReport(fixture.cwdDir, DEFAULT_SKILLS, {
      command: "review",
      issueText: "Review this change",
    });

    expect(report.discoveredSkills.map((skill) => skill.name)).toContain("code-review");
    expect(report.rootsScanned.some((root) => root.path === path.join(pkgDir, "skills"))).toBe(true);
  });

  it("discovers relevant skills from code import patterns even when the issue text is generic", async () => {
    const projectAgents = path.join(fixture.cwdDir, ".agents", "skills");
    fs.mkdirSync(projectAgents, { recursive: true });
    writeSkill(projectAgents, "tanstack-query", "TanStack Query caching and invalidation guidance.");

    const webDir = path.join(fixture.cwdDir, "apps", "web", "src");
    fs.mkdirSync(webDir, { recursive: true });
    fs.writeFileSync(
      path.join(webDir, "invoice-query.ts"),
      'import { QueryClient, useQuery } from "@tanstack/react-query";\nexport const q = QueryClient;\n',
      "utf-8",
    );

    const report = await buildSkillSelectionReport(fixture.cwdDir, DEFAULT_SKILLS, {
      command: "implement",
      issueText: "Add invoice query filtering",
    });

    expect(report.selectedSkills.map((skill) => skill.name)).toContain("tanstack-query");
  });

  it("matches monorepo package dependencies to relevant external skills", async () => {
    const projectCopilot = path.join(fixture.cwdDir, ".copilot", "skills");
    fs.mkdirSync(projectCopilot, { recursive: true });
    writeSkill(projectCopilot, "tanstack-router", "TanStack Router patterns and route conventions.");
    writeSkill(projectCopilot, "tailwind", "Tailwind CSS patterns.");

    const webDir = path.join(fixture.cwdDir, "apps", "web");
    fs.mkdirSync(path.join(webDir, "src", "routes"), { recursive: true });
    fs.writeFileSync(
      path.join(webDir, "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: {
          "@tanstack/router": "1.0.0",
          tailwindcss: "4.0.0",
        },
      }),
      "utf-8",
    );
    fs.writeFileSync(path.join(webDir, "src", "routes", "index.tsx"), "export const x = 1;\n", "utf-8");

    const report = await buildSkillSelectionReport(fixture.cwdDir, DEFAULT_SKILLS, {
      command: "review",
      changedFiles: ["apps/web/src/routes/index.tsx"],
    });

    expect(report.selectedSkills.map((skill) => skill.name)).toEqual(["tanstack-router", "tailwind"]);
    expect(report.selectedSkills[0]?.reasons.join("\n")).toContain("@tanstack/router");
  });

  it("matches namespaced and compound dependency names without hard-coded aliases", async () => {
    const projectAgents = path.join(fixture.cwdDir, ".agents", "skills");
    fs.mkdirSync(projectAgents, { recursive: true });
    writeSkill(projectAgents, "entity-framework-core", "Entity Framework Core guidance.");

    const apiDir = path.join(fixture.cwdDir, "src", "Api");
    fs.mkdirSync(apiDir, { recursive: true });
    fs.writeFileSync(
      path.join(apiDir, "Api.csproj"),
      `<Project Sdk="Microsoft.NET.Sdk.Web">\n  <ItemGroup>\n    <PackageReference Include="Microsoft.EntityFrameworkCore" Version="9.0.0" />\n  </ItemGroup>\n</Project>\n`,
      "utf-8",
    );

    const report = await buildSkillSelectionReport(fixture.cwdDir, DEFAULT_SKILLS, {
      command: "implement",
      changedFiles: ["src/Api/Program.cs"],
    });

    expect(report.selectedSkills.map((skill) => skill.name)).toContain("entity-framework-core");
  });

  it("matches dotnet dependencies across multi-project solutions", async () => {
    const globalClaude = path.join(fixture.homeDir, ".claude", "skills");
    fs.mkdirSync(globalClaude, { recursive: true });
    writeSkill(globalClaude, "dotnet", "General .NET and ASP.NET Core guidance.");
    writeSkill(globalClaude, "xunit", "xUnit testing patterns.");

    fs.writeFileSync(path.join(fixture.cwdDir, "Forgeflow.sln"), "Microsoft Visual Studio Solution File\n", "utf-8");
    const apiDir = path.join(fixture.cwdDir, "src", "Api");
    fs.mkdirSync(apiDir, { recursive: true });
    fs.writeFileSync(
      path.join(apiDir, "Api.csproj"),
      `<Project Sdk="Microsoft.NET.Sdk.Web">\n  <ItemGroup>\n    <PackageReference Include="xunit" Version="2.9.0" />\n  </ItemGroup>\n</Project>\n`,
      "utf-8",
    );
    fs.writeFileSync(path.join(apiDir, "WeatherController.cs"), "namespace Api;\n", "utf-8");

    const report = await buildSkillSelectionReport(fixture.cwdDir, DEFAULT_SKILLS, {
      command: "implement",
      changedFiles: ["src/Api/WeatherController.cs"],
    });

    expect(report.selectedSkills.map((skill) => skill.name)).toEqual(["dotnet", "xunit"]);
  });

  it("detects review-relevant skills from changed file contents", async () => {
    const projectAgents = path.join(fixture.cwdDir, ".agents", "skills");
    fs.mkdirSync(projectAgents, { recursive: true });
    writeSkill(projectAgents, "tanstack-query", "TanStack Query caching and invalidation guidance.");

    const webDir = path.join(fixture.cwdDir, "apps", "web", "src");
    fs.mkdirSync(webDir, { recursive: true });
    fs.writeFileSync(
      path.join(webDir, "invoice-query.tsx"),
      'import { useQuery } from "@tanstack/react-query";\nexport function Invoice() { return <div />; }\n',
      "utf-8",
    );

    const report = await buildSkillSelectionReport(fixture.cwdDir, DEFAULT_SKILLS, {
      command: "review",
      changedFiles: ["apps/web/src/invoice-query.tsx"],
    });

    expect(report.selectedSkills.map((skill) => skill.name)).toContain("tanstack-query");
  });

  it("detects utility-class-heavy UI files as Tailwind-relevant during review", async () => {
    const projectAgents = path.join(fixture.cwdDir, ".agents", "skills");
    fs.mkdirSync(projectAgents, { recursive: true });
    writeSkill(projectAgents, "tailwind", "Tailwind CSS utility class guidance.");

    const webDir = path.join(fixture.cwdDir, "apps", "web", "src");
    fs.mkdirSync(webDir, { recursive: true });
    fs.writeFileSync(
      path.join(webDir, "invoice-card.tsx"),
      'export function InvoiceCard() { return <div className="flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm hover:bg-slate-800" />; }\n',
      "utf-8",
    );

    const report = await buildSkillSelectionReport(fixture.cwdDir, DEFAULT_SKILLS, {
      command: "review",
      changedFiles: ["apps/web/src/invoice-card.tsx"],
    });

    expect(report.selectedSkills.map((skill) => skill.name)).toContain("tailwind");
  });

  it("matches free-text issue phrases against discovered skills without a curated keyword list", async () => {
    const projectAgents = path.join(fixture.cwdDir, ".agents", "skills");
    fs.mkdirSync(projectAgents, { recursive: true });
    writeSkill(projectAgents, "fiber", "Go Fiber web framework guidance.");

    const report = await buildSkillSelectionReport(fixture.cwdDir, DEFAULT_SKILLS, {
      command: "investigate",
      issueText: "Compare Fiber middleware patterns for our Go API",
    });

    expect(report.selectedSkills.map((skill) => skill.name)).toContain("fiber");
  });

  it("supports pluggable ecosystem detectors through the detector interface", () => {
    const inventory = { repoRoot: fixture.cwdDir, manifests: [] };
    const detector: SkillSignalDetector = {
      name: "custom-ecosystem",
      detect: () => [
        {
          kind: "manifest",
          value: "custom-stack",
          reason: "Custom detector matched the repo",
          weight: 9,
          aliases: ["custom-stack"],
        },
      ],
    };

    const analysis = detectSkillSignals(fixture.cwdDir, inventory, { command: "implement" }, [detector]);

    expect(analysis.detectorNames).toEqual(["custom-ecosystem"]);
    expect(analysis.signals.map((signal) => signal.value)).toEqual(["custom-stack"]);
  });

  it("prepareSkillContext threads selected skills onto the pipeline context", async () => {
    const projectAgents = path.join(fixture.cwdDir, ".agents", "skills");
    fs.mkdirSync(projectAgents, { recursive: true });
    writeSkill(projectAgents, "tailwind", "Tailwind CSS guidance for UI work.");

    const pctx = mockPipelineSkillRuntime({ cwd: fixture.cwdDir });
    const prepared = await prepareSkillContext(pctx, {
      command: "implement",
      issueText: "Use Tailwind for the new UI",
    });

    expect(prepared.pctx.selectedSkills.map((skill) => skill.name)).toEqual(["tailwind"]);
    expect(prepared.report.selectedSkills.map((skill) => skill.name)).toEqual(["tailwind"]);
  });

  it("buildSkillScanReport reuses one landscape across multiple command analyses", async () => {
    const projectAgents = path.join(fixture.cwdDir, ".agents", "skills");
    fs.mkdirSync(projectAgents, { recursive: true });
    writeSkill(projectAgents, "tailwind", "Tailwind CSS guidance for UI work.");
    fs.writeFileSync(
      path.join(fixture.cwdDir, "package.json"),
      JSON.stringify({ dependencies: { tailwindcss: "4.0.0" } }),
      "utf-8",
    );

    const report = await buildSkillScanReport(fixture.cwdDir, DEFAULT_SKILLS, [
      { command: "implement", issueText: "UI work" },
      { command: "architecture" },
    ]);

    expect(report.analyses).toHaveLength(2);
    const firstAnalysis = report.analyses[0];
    expect(firstAnalysis?.selectedSkills[0]?.name).toBe("tailwind");
    if (!firstAnalysis) throw new Error("expected first analysis");
    expect(renderSkillSelectionReport(firstAnalysis)).toContain("Recommended skills");
  });

  it("includes malformed skill paths in diagnostics", async () => {
    const globalClaude = path.join(fixture.homeDir, ".claude", "skills", "stitch");
    fs.mkdirSync(globalClaude, { recursive: true });
    fs.writeFileSync(path.join(globalClaude, "SKILL.md"), "# Stitch without frontmatter\n", "utf-8");

    const report = await buildSkillSelectionReport(fixture.cwdDir, DEFAULT_SKILLS, {
      command: "implement",
      issueText: "Build the UI",
    });

    expect(report.diagnostics).toContain(`warning: description is required (${path.join(globalClaude, "SKILL.md")})`);
  });
});
