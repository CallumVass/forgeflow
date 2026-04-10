import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { formatLambdaCandidate, resolveLambdaFromRepo } from "./resolver.js";

async function makeRepo(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tmp-datadog-resolver-"));
  await Promise.all(
    Object.entries(files).map(async ([file, content]) => {
      const fullPath = path.join(dir, file);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
    }),
  );
  return dir;
}

describe("resolveLambdaFromRepo", () => {
  it("picks a clear lambda match from CDK code", async () => {
    const repo = await makeRepo({
      "infra/BillingStack.ts": [
        "import * as lambda from 'aws-cdk-lib/aws-lambda';",
        "new lambda.Function(this, 'BillingLambda', {",
        "  functionName: 'billing-prod-handler',",
        "  handler: 'src/billing.handler',",
        "});",
        "new lambda.Function(this, 'AuthLambda', {",
        "  functionName: 'auth-prod-handler',",
        "  handler: 'src/auth.handler',",
        "});",
      ].join("\n"),
    });

    const resolution = await resolveLambdaFromRepo(repo, "investigate why the billing lambda is slow in prod");
    if (typeof resolution === "string") throw new Error(resolution);

    expect(resolution.ambiguous).toBe(false);
    expect(resolution.selected?.functionName).toBe("billing-prod-handler");
    if (!resolution.selected) throw new Error("expected a selected lambda candidate");
    expect(formatLambdaCandidate(resolution.selected)).toContain("billing-prod-handler");

    await fs.rm(repo, { recursive: true, force: true });
  });

  it("asks for clarification when multiple lambdas score similarly", async () => {
    const repo = await makeRepo({
      "infra/BillingStack.ts": [
        "import * as lambda from 'aws-cdk-lib/aws-lambda';",
        "new lambda.Function(this, 'BillingLambda', {",
        "  functionName: 'billing-prod-handler',",
        "  handler: 'src/billing.handler',",
        "});",
        "new lambda.Function(this, 'AuthLambda', {",
        "  functionName: 'auth-prod-handler',",
        "  handler: 'src/auth.handler',",
        "});",
      ].join("\n"),
    });

    const resolution = await resolveLambdaFromRepo(repo, "investigate why this lambda is slow");
    if (typeof resolution === "string") throw new Error(resolution);

    expect(resolution.ambiguous).toBe(true);
    expect(resolution.selected).toBeUndefined();
    expect(resolution.candidates).toHaveLength(2);

    await fs.rm(repo, { recursive: true, force: true });
  });

  it("finds multiline NodejsFunction declarations in hidden infra folders", async () => {
    const repo = await makeRepo({
      ".infra/lib/infra-stack.ts": [
        "import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';",
        "const clientsMeLambda =",
        "  new NodejsFunction(",
        "    this,",
        "    'ClientsMeLambda',",
        "    {",
        "      functionName: 'clients-me-prod',",
        "      entry: 'src/clients/me.ts',",
        "      handler: 'handler',",
        "    },",
        "  );",
      ].join("\n"),
    });

    const resolution = await resolveLambdaFromRepo(
      repo,
      "@.infra/lib/infra-stack.ts - tell me how the clients me lambda is performing in prod",
    );
    if (typeof resolution === "string") throw new Error(resolution);

    expect(resolution.ambiguous).toBe(false);
    expect(resolution.selected?.functionName).toBe("clients-me-prod");
    expect(resolution.selected?.variableName).toBe("clientsMeLambda");

    await fs.rm(repo, { recursive: true, force: true });
  });

  it("finds imported lambdas created via fromFunctionName", async () => {
    const repo = await makeRepo({
      "infra/ImportsStack.ts": [
        "import * as lambda from 'aws-cdk-lib/aws-lambda';",
        "const clientsMeLambda = lambda.Function.fromFunctionName(",
        "  this,",
        "  'ClientsMeLambda',",
        "  'clients-me-prod',",
        ");",
      ].join("\n"),
    });

    const resolution = await resolveLambdaFromRepo(repo, "tell me how the clients me lambda is performing in prod");
    if (typeof resolution === "string") throw new Error(resolution);

    expect(resolution.ambiguous).toBe(false);
    expect(resolution.selected?.functionName).toBe("clients-me-prod");
    expect(resolution.selected?.constructId).toBe("ClientsMeLambda");

    await fs.rm(repo, { recursive: true, force: true });
  });

  it("finds custom Lambda wrapper constructs in TypeScript", async () => {
    const repo = await makeRepo({
      "infra/ClientsStack.ts": [
        "import { Runtime } from 'aws-cdk-lib/aws-lambda';",
        "import { IVCEFunction } from '@company/private-constructs';",
        "const clientsMeLambda = new IVCEFunction(this, 'ClientsMeLambda', {",
        "  functionName: 'clients-me-prod',",
        "  project: 'src/Clients.Me/Clients.Me.csproj',",
        "  functionHandler: 'Clients.Me::Handlers.Me::FunctionHandler',",
        "  runtime: Runtime.DOTNET_8,",
        "});",
      ].join("\n"),
    });

    const resolution = await resolveLambdaFromRepo(repo, "tell me how the clients me lambda is performing in prod");
    if (typeof resolution === "string") throw new Error(resolution);

    expect(resolution.ambiguous).toBe(false);
    expect(resolution.selected?.className).toBe("IVCEFunction");
    expect(resolution.selected?.functionName).toBe("clients-me-prod");
    expect(resolution.selected?.handler).toContain("Clients.Me::Handlers.Me");
    expect(resolution.selected?.entry).toBe("src/Clients.Me/Clients.Me.csproj");

    await fs.rm(repo, { recursive: true, force: true });
  });

  it("finds Lambda wrapper constructs in C# infra code", async () => {
    const repo = await makeRepo({
      "src/Infra/ClientsStack.cs": [
        "using Amazon.CDK.AWS.Lambda;",
        'var clientsMeLambda = new IVCEFunction(this, "ClientsMeLambda", new IVCEFunctionProps',
        "{",
        '    FunctionName = "clients-me-prod",',
        '    Project = "src/Clients.Me/Clients.Me.csproj",',
        '    FunctionHandler = "Clients.Me::Handlers.Me::FunctionHandler",',
        "    Runtime = Runtime.DOTNET_8,",
        "});",
      ].join("\n"),
    });

    const resolution = await resolveLambdaFromRepo(repo, "tell me how the clients me lambda is performing in prod");
    if (typeof resolution === "string") throw new Error(resolution);

    expect(resolution.ambiguous).toBe(false);
    expect(resolution.selected?.className).toBe("IVCEFunction");
    expect(resolution.selected?.functionName).toBe("clients-me-prod");
    expect(resolution.selected?.runtime).toContain("Runtime.DOTNET_8");

    await fs.rm(repo, { recursive: true, force: true });
  });
});
