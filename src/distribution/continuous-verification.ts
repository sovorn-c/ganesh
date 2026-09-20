// story: e19s05

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ContinuousVerificationReport {
  readonly valid: boolean;
  readonly triggers: readonly string[];
  readonly nodeVersion?: string;
  readonly runsOn?: string;
  readonly commands: readonly string[];
  readonly forbiddenClaims: readonly string[];
  readonly errors: readonly string[];
}

const REQUIRED_COMMANDS = [
  "npm run preflight",
  "npm test",
  "npm run typecheck",
  "npm run lint",
  "npm run build",
  "npm run qualify"
] as const;

const FORBIDDEN_PATTERNS: readonly [RegExp, string][] = [
  [/npm\s+publish/i, "npm publish"],
  [/git\s+push/i, "git push"],
  [/git\s+tag/i, "git tag"],
  [/\bdeploy(?:ment)?\b/i, "deploy"],
  [/darwin[^\n]*verified/i, "Darwin verified"],
  [/windows[^\n]*verified/i, "Windows verified"],
  [/production[- ]ready/i, "production-ready"],
  [/b06[^\n]*(?:complete|passed|verified)/i, "B06 completion"]
];

export function loadContinuousVerificationWorkflow(projectRoot: string): ContinuousVerificationReport {
  const file = join(projectRoot, ".github", "workflows", "local-gates.yml");
  if (!existsSync(file)) {
    return { valid: false, triggers: [], commands: [], forbiddenClaims: [], errors: ["local-gates.yml is missing"] };
  }
  const source = readFileSync(file, "utf8");
  const triggers: string[] = [];
  if (/^\s*push:\s*$/m.test(source)) {triggers.push("push");}
  if (/^\s*pull_request:\s*$/m.test(source)) {triggers.push("pull_request");}
  const nodeVersion = /^\s*node-version:\s*["']?([^"'\s]+)["']?\s*$/m.exec(source)?.[1];
  const runsOn = /^\s*runs-on:\s*["']?([^"'\s]+)["']?\s*$/m.exec(source)?.[1];
  const commands = REQUIRED_COMMANDS.filter((command) => new RegExp(`^\\s*-\\s*run:\\s*${command.replaceAll(" ", "\\s+")}\\s*$`, "m").test(source));
  const forbiddenClaims = FORBIDDEN_PATTERNS.filter(([pattern]) => pattern.test(source)).map(([, label]) => label);
  const errors: string[] = [];
  if (!triggers.includes("push") || !triggers.includes("pull_request")) {errors.push("workflow must trigger on push and pull_request");}
  if (nodeVersion !== "24") {errors.push("workflow must use Node.js 24");}
  if (runsOn !== "ubuntu-latest") {errors.push("workflow must run on ubuntu-latest");}
  for (const command of REQUIRED_COMMANDS) {if (!commands.includes(command)) {errors.push(`missing local gate: ${command}`);}}
  if (forbiddenClaims.length > 0) {errors.push(`forbidden workflow claims: ${forbiddenClaims.join(", ")}`);}
  return { valid: errors.length === 0, triggers, ...(nodeVersion === undefined ? {} : { nodeVersion }), ...(runsOn === undefined ? {} : { runsOn }), commands, forbiddenClaims, errors };
}
