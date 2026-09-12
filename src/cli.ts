#!/usr/bin/env node
import { PiWorkspaceRuntimePort } from "./workspace/runtime-port.js";
import { runWorkspace } from "./workspace/launcher.js";

const printLaunch = process.argv.includes("--print-launch");
const argv = process.argv.slice(2).filter((argument) => argument !== "--print-launch");

const result = await runWorkspace({
  argv,
  cwd: process.cwd(),
  ...(printLaunch || !process.stdin.isTTY || !process.stdout.isTTY
    ? {
        ports: {
          runtime: new PiWorkspaceRuntimePort(),
          tui: {
            run: async (): Promise<void> => undefined,
            confirm: async (): Promise<boolean> => false
          }
        }
      }
    : {})
});

if (result.status === "failed") {
  console.error(`ganesh: ${result.error?.code ?? "launch-failed"}: ${result.message}`);
  process.exitCode = 1;
} else if (printLaunch) {
  console.log(result.message);
  result.session?.handle.close();
}
