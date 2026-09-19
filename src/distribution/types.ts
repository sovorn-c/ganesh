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

// story: e18s02

export interface PackageManifest {
  name: string;
  version: string;
  tarball: string;
  digest: string;
  files: string[];
}

export interface PackageArtifactOptions {
  destination?: string;
  writeManifest?: boolean;
}

export interface PackageArtifactReport {
  status: "pass" | "fail";
  tarballPath: string;
  manifestPath?: string;
  digest: string;
  manifest?: PackageManifest;
  filesWhitelisted: boolean;
  sensitiveFilesExcluded: boolean;
  reasons?: string[];
}

export interface VerifyPackageArtifactOptions {
  tarballPath: string;
  expectedDigest: string;
}

export interface VerifyPackageArtifactResult {
  status: "pass" | "fail";
  actualDigest?: string;
  reasons?: string[];
}

export interface DependencyLicenseItem {
  name: string;
  version: string;
  license: string;
  noticePointer?: string;
  sourceLink?: string;
}

export interface LicenseInventory {
  version: string;
  productLicense: "UNLICENSED" | string;
  dependencies: DependencyLicenseItem[];
}

export interface LicenseInventoryReport {
  status: "pass" | "fail";
  dependenciesCount: number;
  lgplCompliant: boolean;
  productLicense: string;
  reasons?: string[];
}

export interface SigningApplicability {
  channel: "npm-pack-tarball" | string;
  artifactDigest: "sha256" | string;
  lockfileIntegrity: boolean;
  appleCodesign: "not-applicable" | string;
  npmProvenance: string;
}

export interface SigningApplicabilityReport {
  status: "pass" | "fail";
  channel: string;
  artifactDigest: string;
  lockfileIntegrity: boolean;
  appleCodesign: string;
  reasons?: string[];
}
