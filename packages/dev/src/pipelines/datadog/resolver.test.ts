import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { formatLambdaCandidate, resolveLambdaFromRepo } from "./resolver.js";

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tmp-datadog-resolver-"));
  await fs.mkdir(path.join(dir, "infra"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "infra", "BillingStack.ts"),
    [
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
  );
  return dir;
}

describe("resolveLambdaFromRepo", () => {
  it("picks a clear lambda match from CDK code", async () => {
    const repo = await makeRepo();
    const resolution = await resolveLambdaFromRepo(repo, "investigate why the billing lambda is slow in prod");
    if (typeof resolution === "string") throw new Error(resolution);

    expect(resolution.ambiguous).toBe(false);
    expect(resolution.selected?.functionName).toBe("billing-prod-handler");
    if (!resolution.selected) throw new Error("expected a selected lambda candidate");
    expect(formatLambdaCandidate(resolution.selected)).toContain("billing-prod-handler");

    await fs.rm(repo, { recursive: true, force: true });
  });

  it("asks for clarification when multiple lambdas score similarly", async () => {
    const repo = await makeRepo();
    const resolution = await resolveLambdaFromRepo(repo, "investigate why this lambda is slow");
    if (typeof resolution === "string") throw new Error(resolution);

    expect(resolution.ambiguous).toBe(true);
    expect(resolution.selected).toBeUndefined();
    expect(resolution.candidates).toHaveLength(2);

    await fs.rm(repo, { recursive: true, force: true });
  });
});
