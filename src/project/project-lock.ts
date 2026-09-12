// story: e15s03
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { ProjectStoreError } from "./project-types.js";
import type { ProjectLock } from "../portability/portability-types.js";

const LOCK_FILE = "write.lock";
const activeLocks = new Map<string, { pid: number; count: number }>();

function lockPath(projectRoot: string): string {
  return join(resolve(projectRoot), ".ganesh", LOCK_FILE);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireProjectWriteLock(projectRoot: string): ProjectLock {
  const normRoot = resolve(projectRoot);
  const path = lockPath(normRoot);
  const myPid = process.pid;

  // Same-process reentry
  const existing = activeLocks.get(normRoot);
  if (existing && existing.pid === myPid) {
    existing.count++;
    return {
      projectRoot: normRoot,
      pid: myPid,
      release() {
        const lock = activeLocks.get(normRoot);
        if (lock) {
          lock.count--;
          if (lock.count <= 0) {
            activeLocks.delete(normRoot);
            try { unlinkSync(path); } catch { /* already gone */ }
          }
        }
      }
    };
  }

  const lockDir = join(normRoot, ".ganesh");
  mkdirSync(lockDir, { recursive: true });

  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // 1. Try atomic exclusive creation
    try {
      writeFileSync(path, String(myPid), { flag: "wx" });
      activeLocks.set(normRoot, { pid: myPid, count: 1 });
      return {
        projectRoot: normRoot,
        pid: myPid,
        release() {
          const lock = activeLocks.get(normRoot);
          if (lock) {
            lock.count--;
            if (lock.count <= 0) {
              activeLocks.delete(normRoot);
              try { unlinkSync(path); } catch { /* already gone */ }
            }
          }
        }
      };
    } catch (err: any) {
      if (err?.code !== "EEXIST") {
        throw err;
      }
    }

    // 2. Lock file exists; inspect PID
    let lockPid: number | null = null;
    try {
      const content = readFileSync(path, "utf-8").trim();
      const parsed = parseInt(content, 10);
      if (!isNaN(parsed)) {
        lockPid = parsed;
      }
    } catch {
      continue;
    }

    if (lockPid !== null) {
      if (lockPid === myPid) {
        activeLocks.set(normRoot, { pid: myPid, count: 1 });
        return {
          projectRoot: normRoot,
          pid: myPid,
          release() {
            const lock = activeLocks.get(normRoot);
            if (lock) {
              lock.count--;
              if (lock.count <= 0) {
                activeLocks.delete(normRoot);
                try { unlinkSync(path); } catch { /* already gone */ }
              }
            }
          }
        };
      }

      if (isPidAlive(lockPid)) {
        throw new ProjectStoreError(
          "project-locked",
          `project-locked: project is locked by process ${lockPid}; close the other instance or remove ${path}`
        );
      }
    }

    // Dead PID or corrupt file: safely unlink stale lock and retry atomic creation
    try {
      unlinkSync(path);
    } catch {
      // Unlink race
    }
  }

  throw new ProjectStoreError("project-locked", `failed to acquire write lock on ${path} after multiple attempts`);
}

export function isProjectLocked(projectRoot: string): boolean {
  const path = lockPath(projectRoot);
  if (!existsSync(path)) {return false;}
  try {
    const content = readFileSync(path, "utf-8").trim();
    const lockPid = parseInt(content, 10);
    return !isNaN(lockPid) && isPidAlive(lockPid);
  } catch {
    return false;
  }
}

/** For test cleanup only */
export function _resetLocks(): void {
  activeLocks.clear();
}
