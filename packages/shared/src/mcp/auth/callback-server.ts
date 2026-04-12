import * as http from "node:http";

interface WaitForOauthCallbackOptions {
  timeoutMs?: number;
  createServerFn?: typeof http.createServer;
}

export async function waitForOauthCallback(
  redirectUri: string,
  serviceLabel: string,
  options: WaitForOauthCallbackOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    const callbackUrl = new URL(redirectUri);
    const hostname = callbackUrl.hostname;
    const pathname = callbackUrl.pathname || "/";
    const port = callbackUrl.port ? parseInt(callbackUrl.port, 10) : callbackUrl.protocol === "https:" ? 443 : 80;
    const createServer = options.createServerFn ?? http.createServer;
    const settle = (err?: Error, code?: string) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      server.close(() => undefined);
      if (err) reject(err);
      else if (code) resolve(code);
      else reject(new Error(`${serviceLabel} OAuth callback completed without an authorisation code.`));
    };
    const server = createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end("Missing callback URL.");
        return;
      }

      const incoming = new URL(req.url, `${callbackUrl.protocol}//${callbackUrl.host}`);
      if (incoming.pathname !== pathname) {
        res.statusCode = 404;
        res.end("Not found.");
        return;
      }

      const error = incoming.searchParams.get("error");
      if (error) {
        res.statusCode = 400;
        res.end(`${serviceLabel} OAuth failed. You can close this tab.`);
        settle(new Error(`${serviceLabel} OAuth failed: ${error}`));
        return;
      }

      const code = incoming.searchParams.get("code");
      if (!code) {
        res.statusCode = 400;
        res.end(`${serviceLabel} OAuth callback did not include a code.`);
        settle(new Error(`${serviceLabel} OAuth callback did not include a code.`));
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        `<html><body><h1>Forgeflow connected to ${serviceLabel}.</h1><p>You can close this tab and return to Pi.</p></body></html>`,
      );
      settle(undefined, code);
    });
    timeout = setTimeout(
      () => {
        settle(new Error(`Timed out waiting for the ${serviceLabel} OAuth callback.`));
      },
      options.timeoutMs ?? 5 * 60_000,
    );

    server.on("error", (err) => {
      settle(err);
    });

    server.listen(port, hostname);
  });
}
