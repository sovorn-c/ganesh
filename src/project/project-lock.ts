// story: e15s03
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { ProjectStoreError } from "./project-types.js";
import type { ProjectLock } from "../portability/portability-types.js";

const LOCK_FILE = "write.lock";
const activeLocks = new Map<string, { pid: number; count: number }>();
const activeSwapLocks = new Map<string, { pid: number; count: number }>();
const SWAP_LOCK_FILE = ".ganesh.replace.lock";

function lockPath(projectRoot: string): string {
  return join(resolve(projectRoot), ".ganesh", LOCK_FILE);
}

/** Reconcile the two-directory replace journal before opening a project. */
function reconcileProjectStoreSwapUnlocked(projectRoot: string): void {
  const root = resolve(projectRoot);
  if (!existsSync(root)) {
    return;
  }
  const store = join(root, ".ganesh");
  let entries: string[];
  try { entries = readdirSync(root); } catch { return; }
  const backups = entries.filter((entry) => entry.startsWith(".ganesh.replace-backup-"));
  const stages = entries.filter((entry) => entry.startsWith(".ganesh.replace-stage-"));

  // Directory rename is atomic: no live store means the process died between
  // the two renames, so restore the old complete store. Multiple backups are
  // ambiguous; fail closed instead of guessing which complete store is live.
  if (!existsSync(store) && backups.length > 1) {
    throw new ProjectStoreError("project-locked", "project replace journal has multiple ambiguous backups");
  }
  if (!existsSync(store) && backups.length === 1) {
    renameSync(join(root, backups[0]), store);
    backups.shift();
  }
  // A live store means the new complete store was installed; old backups are
  // safe to discard. Stages are never live data.
  for (const entry of backups) {
    try { rmSync(join(root, entry), { recursive: true, force: true }); } catch { /* retry on next open */ }
  }
  for (const entry of stages) {
    try { rmSync(join(root, entry), { recursive: true, force: true }); } catch { /* retry on next open */ }
  }
}

export function reconcileProjectStoreSwap(projectRoot: string): void {
  if (!existsSync(resolve(projectRoot))) {
    return;
  }
  const lock = acquireProjectSwapLock(projectRoot);
  try {
    reconcileProjectStoreSwapUnlocked(projectRoot);
  } finally {
    lock.release();
  }
}

type PidState = "alive" | "dead" | "unknown";

function pidState(pid: number): PidState {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ESRCH") {
      return "dead";
    }
    if (code === "EPERM") {
      return "alive";
    }
    return "unknown";
  }
}

function isPidAlive(pid: number): boolean {
  return pidState(pid) !== "dead";
}

function unlinkOwnedLock(path: string, pid: number): void {
  try {
    if (readFileSync(path, "utf-8").trim() === String(pid)) {
      unlinkSync(path);
    }
  } catch { /* already gone or replaced by another owner */ }
}

export function acquireProjectSwapLock(projectRoot: string): ProjectLock {
  const normRoot = resolve(projectRoot);
  const path = join(normRoot, SWAP_LOCK_FILE);
  const myPid = process.pid;
  const existing = activeSwapLocks.get(normRoot);
  if (existing && existing.pid === myPid) {
    existing.count++;
    return { projectRoot: normRoot, pid: myPid, release: () => releaseSwapLock(normRoot, path) };
  }
  mkdirSync(normRoot, { recursive: true });
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      writeFileSync(path, String(myPid), { flag: "wx" });
      activeSwapLocks.set(normRoot, { pid: myPid, count: 1 });
      return { projectRoot: normRoot, pid: myPid, release: () => releaseSwapLock(normRoot, path) };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") {
        throw error;
      }
      let owner: number;
      try {
        const content = readFileSync(path, "utf-8").trim();
        if (!/^[1-9][0-9]*$/.test(content)) { throw new Error("invalid owner"); }
        owner = Number(content);
        if (!Number.isSafeInteger(owner) || pidState(owner) !== "dead") {
          throw new ProjectStoreError("project-locked", `project-locked: swap journal is owned by ${content}`);
        }
      } catch (inspectError) {
        if (inspectError instanceof ProjectStoreError) { throw inspectError; }
        continue;
      }
      if (owner !== myPid) {
        unlinkOwnedLock(path, owner);
      }
    }
  }
  throw new ProjectStoreError("project-locked", `failed to acquire swap journal lock on ${path}`);
}

function releaseSwapLock(root: string, path: string): void {
  const lock = activeSwapLocks.get(root);
  if (!lock) { return; }
  lock.count--;
  if (lock.count <= 0) {
    activeSwapLocks.delete(root);
    unlinkOwnedLock(path, process.pid);
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
            unlinkOwnedLock(path, process.pid);
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
              unlinkOwnedLock(path, process.pid);
            }
          }
        }
      };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") {
        throw err;
      }
    }

    // 2. Lock file exists; inspect PID
    let lockPid: number | null = null;
    try {
      const content = readFileSync(path, "utf-8").trim();
      if (!/^[1-9][0-9]*$/.test(content)) {
        throw new ProjectStoreError("project-locked", `project-locked: lock file ${path} has an invalid owner`);
      }
      const parsed = Number(content);
      if (!Number.isSafeInteger(parsed)) {
        throw new ProjectStoreError("project-locked", `project-locked: lock file ${path} has an invalid owner`);
      }
      lockPid = parsed;
    } catch (error: unknown) {
      if (error instanceof ProjectStoreError) {
        throw error;
      }
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        continue;
      }
      throw new ProjectStoreError("project-locked", `project-locked: cannot inspect lock ${path}`);
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
                unlinkOwnedLock(path, process.pid);
              }
            }
          }
        };
      }

      const state = pidState(lockPid);
      if (state !== "dead") {
        throw new ProjectStoreError(
          "project-locked",
          `project-locked: project lock owner ${lockPid} could not be proven dead; close the other instance or remove ${path}`
        );
      }
    }

    // Only a PID proven dead can be unlinked and retried.
    unlinkOwnedLock(path, lockPid ?? 0);
  }

  throw new ProjectStoreError("project-locked", `failed to acquire write lock on ${path} after multiple attempts`);
}

export function isProjectLocked(projectRoot: string): boolean {
  const path = lockPath(projectRoot);
  if (!existsSync(path)) {return false;}
  try {
    const content = readFileSync(path, "utf-8").trim();
    if (!/^[1-9][0-9]*$/.test(content)) {
      return true;
    }
    const lockPid = Number(content);
    return !Number.isSafeInteger(lockPid) || isPidAlive(lockPid);
  } catch {
    return true;
  }
}

/** For test cleanup only */
export function _resetLocks(): void {
  activeLocks.clear();
  activeSwapLocks.clear();
}
