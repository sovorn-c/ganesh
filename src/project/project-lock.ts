// story: e15s03
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
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

  // Check for foreign lock
  if (existsSync(path)) {
    try {
      const content = readFileSync(path, "utf-8").trim();
      const lockPid = parseInt(content, 10);
      if (!isNaN(lockPid) && lockPid !== myPid && isPidAlive(lockPid)) {
        throw new ProjectStoreError(
          "project-locked",
          `project-locked: project is locked by process ${lockPid}; close the other instance or remove ${path}`
        );
      }
      // Dead pid — steal the lock
    } catch (error) {
      if (error instanceof ProjectStoreError) { throw error; }
      // File read error — proceed to overwrite
    }
  }

  // Acquire lock
  writeFileSync(path, String(myPid), { flag: "w" });
  activeLocks.set(projectRoot, { pid: myPid, count: 1 });

  return {
    projectRoot,
    pid: myPid,
    release() {
      const lock = activeLocks.get(projectRoot);
      if (lock) {
        lock.count--;
        if (lock.count <= 0) {
          activeLocks.delete(projectRoot);
          try { unlinkSync(path); } catch { /* already gone */ }
        }
      }
    }
  };
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
