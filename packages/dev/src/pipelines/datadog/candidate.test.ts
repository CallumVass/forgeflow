import { describe, expect, it } from "vitest";
import { formatLambdaCandidate } from "./candidate.js";

describe("formatLambdaCandidate", () => {
  it("prefers function name and includes useful extras", () => {
    expect(
      formatLambdaCandidate({
        file: ".infra/lib/infra-stack.ts",
        line: 42,
        className: "IVCEFunction",
        variableName: "clientsMeLambda",
        functionName: "clients-me-prod",
        constructId: "ClientsMeLambda",
        handler: "Clients.Me::Handlers.Me::FunctionHandler",
        entry: "src/Clients.Me/Clients.Me.csproj",
        score: 0,
        reasons: [],
      }),
    ).toBe(
      "clients-me-prod — class IVCEFunction, variable clientsMeLambda, construct ClientsMeLambda, handler Clients.Me::Handlers.Me::FunctionHandler, entry src/Clients.Me/Clients.Me.csproj (.infra/lib/infra-stack.ts:42)",
    );
  });
});
