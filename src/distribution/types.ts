// story: e18s01

export type PlatformOS = "darwin" | "linux" | "win32" | string;
export type PlatformArch = "x64" | "arm64" | "ia32" | string;
export type CombinationStatus = "verified" | "unverified";

export interface SupportMatrixCombination {
  os: PlatformOS;
  arch: PlatformArch;
  nodeMajor: number;
  status: CombinationStatus;
  evidencePointer: string;
  notes?: string;
}

export interface SupportMatrix {
  version: string;
  combinations: SupportMatrixCombination[];
  scholarlyCertification: false;
}

export interface SupportMatrixValidationResult {
  status: "pass" | "fail";
  reasons?: string[];
}

export interface PackagedSmokeOptions {
  root?: string;
  prefix: string;
  projectDir?: string;
  timeoutMs?: number;
}

export interface PackagedSmokeReport {
  status: "pass" | "fail";
  tarballPath: string;
  prefix: string;
  printLaunchExitCode: number;
  printLaunchOutput: string;
  preflightExitCode: number;
  preflightOutput: string;
  matrixRowVerified: boolean;
  reasons?: string[];
}
