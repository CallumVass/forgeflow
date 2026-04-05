## Review: Consolidate exec into shared package

### Finding 1
- **Confidence**: 92
- **Severity**: major
- **Category**: Error Handling
- **File**: packages/dev/src/utils/git.ts:118-119, 139-140
- **Code**:
```ts
// resolveGitHubIssue (line 118-119)
const issueJson = await exec(`gh issue view ${issueNum} --json number,title,body`, cwd);
if (!issueJson) return `Could not fetch issue #${issueNum}.`;

// resolveJiraIssue (line 139-140)
const raw = await exec(`jira issue view ${jiraKey} --raw`, cwd);
if (!raw) return `Could not fetch Jira issue ${jiraKey}.`;
```
- **Issue**: The import was changed from the old local `exec` (which resolved with `""` on any error) to the new shared `exec` (which throws on non-zero exit). When `gh issue view` or `jira issue view` fails (e.g. issue doesn't exist, CLI not authenticated, network error), the new `exec` will throw an unhandled error instead of returning `""`. The `if (!issueJson)` and `if (!raw)` guards are now dead code in the error path — the graceful error messages (`"Could not fetch issue #N"`) will never be returned. Callers will get an uncaught exception instead of a user-friendly string.
- **Fix**: Use `execSafe` for these two calls (which is already exported from shared and designed for exactly this pattern), or wrap them in try/catch:
```ts
const issueJson = await execSafe(`gh issue view ${issueNum} --json number,title,body`, cwd);
if (!issueJson) return `Could not fetch issue #${issueNum}.`;
```
- **Judge verification**: Old `exec` in deleted `packages/dev/src/utils/exec.ts` always resolved via `proc.on("close", () => resolve(out.trim()))` and `proc.on("error", () => resolve(""))`. New shared `exec` rejects with `reject(new Error(...))` on non-zero exit. `execSafe` is already used in `review.ts:175` for the same pattern.

### Finding 2
- **Confidence**: 90
- **Severity**: major
- **Category**: Error Handling
- **File**: packages/shared/src/confluence.ts:68-70
- **Code**:
```ts
const raw = await exec(`curl -s -H "Authorization: Basic ${auth}" -H "Accept: application/json" "${apiUrl}"`);

if (!raw) return `Failed to fetch Confluence page ${pageId}.`;
```
- **Issue**: Same behavioural change as Finding 1. The old `execCmd` resolved with `""` on error; the new `exec` throws. When `curl` exits non-zero (DNS failure, connection refused, timeout — exit codes 6, 7, 28), the throw will bypass the `if (!raw)` guard. `fetchConfluencePage` will throw an unhandled error instead of returning the graceful error string `"Failed to fetch Confluence page {id}."`. The function's return type (`ConfluencePage | string`) implies callers expect error strings, not exceptions.
- **Fix**: Use `execSafe` here since the `if (!raw)` check already handles the empty-string case:
```ts
const raw = await execSafe(`curl -s -H "Authorization: Basic ${auth}" -H "Accept: application/json" "${apiUrl}"`);
```
- **Judge verification**: Old inline `execCmd` in confluence.ts (deleted in f65fd06) had identical never-reject semantics. Import now resolves to shared `exec` via `import { exec } from "./exec.js"`.

## Summary
- Total findings: 2 (2 confirmed, 0 rejected)
- Categories: Error Handling (2)
- Overall assessment: Both findings verified against actual code and git history. The behavioural change from non-throwing to throwing `exec` is confirmed, and three call sites rely on silent failure to return graceful error strings. `execSafe` is already available and used elsewhere for this exact pattern.
