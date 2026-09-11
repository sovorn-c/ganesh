// story: e06s02
import { fromBufferPromise, type Entry } from "yauzl";
import { ProjectStoreError } from "../project/project-types.js";

export interface ArchiveLimits {
  readonly maxEntries?: number;
  readonly maxExpandedBytes?: number;
  readonly maxCompressionRatio?: number;
  readonly maxEntryBytes?: number;
}

export interface ArchiveEntryInfo {
  readonly name: string;
  readonly compressedBytes: number;
  readonly expandedBytes: number;
  readonly encrypted: boolean;
}

const DEFAULT_LIMITS: Required<ArchiveLimits> = {
  maxEntries: 4096,
  maxExpandedBytes: 128 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxEntryBytes: 32 * 1024 * 1024
};

function effectiveLimits(provided: ArchiveLimits): Required<ArchiveLimits> {
  return {
    maxEntries: provided.maxEntries ?? DEFAULT_LIMITS.maxEntries,
    maxExpandedBytes: provided.maxExpandedBytes ?? DEFAULT_LIMITS.maxExpandedBytes,
    maxCompressionRatio: provided.maxCompressionRatio ?? DEFAULT_LIMITS.maxCompressionRatio,
    maxEntryBytes: provided.maxEntryBytes ?? DEFAULT_LIMITS.maxEntryBytes
  };
}

function unsafeName(name: string): boolean {
  return name.startsWith("/") || name.split(/[\\/]/u).some((part) => part === "..");
}

function entryInfo(entry: Entry, limits: Required<ArchiveLimits>): ArchiveEntryInfo {
  if (unsafeName(entry.fileName)) {
    throw new ProjectStoreError("archive-unsafe-name", "archive contains an unsafe entry name");
  }
  if (entry.isEncrypted()) {
    throw new ProjectStoreError("archive-encrypted", "archive contains encrypted content");
  }
  if (entry.uncompressedSize > limits.maxEntryBytes) {
    throw new ProjectStoreError("archive-entry-too-large", "archive entry exceeds the expanded byte limit");
  }
  const ratio = entry.compressedSize === 0
    ? entry.uncompressedSize === 0 ? 0 : Number.POSITIVE_INFINITY
    : entry.uncompressedSize / entry.compressedSize;
  if (ratio > limits.maxCompressionRatio) {
    throw new ProjectStoreError("archive-compression-ratio", "archive entry exceeds the compression ratio limit");
  }
  return {
    name: entry.fileName,
    compressedBytes: entry.compressedSize,
    expandedBytes: entry.uncompressedSize,
    encrypted: entry.isEncrypted()
  };
}

export async function preflightZip(
  bytes: Uint8Array,
  provided: ArchiveLimits = {}
): Promise<readonly ArchiveEntryInfo[]> {
  const limits = effectiveLimits(provided);
  let zip;
  try {
    zip = await fromBufferPromise(Buffer.from(bytes), { lazyEntries: true, validateEntrySizes: true });
  } catch {
    throw new ProjectStoreError("archive-corrupt", "input is not a valid ZIP archive");
  }
  const entries: ArchiveEntryInfo[] = [];
  let expanded = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      if (entries.length >= limits.maxEntries) {
        throw new ProjectStoreError("archive-entry-limit", "archive contains too many entries");
      }
      const info = entryInfo(entry, limits);
      expanded += info.expandedBytes;
      if (expanded > limits.maxExpandedBytes) {
        throw new ProjectStoreError("archive-expanded-limit", "archive expanded bytes exceed the configured limit");
      }
      entries.push(info);
    }
  } finally {
    zip.close();
  }
  return entries;
}

export async function readZipEntries(
  bytes: Uint8Array,
  names: readonly string[],
  limits: ArchiveLimits = {}
): Promise<ReadonlyMap<string, Uint8Array>> {
  const entries = await preflightZip(bytes, limits);
  const wanted = new Set(names);
  const values = new Map<string, Uint8Array>();
  const zip = await fromBufferPromise(Buffer.from(bytes), { lazyEntries: true, validateEntrySizes: true });
  try {
    for await (const entry of zip.eachEntry()) {
      if (!wanted.has(entry.fileName)) {
        continue;
      }
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      values.set(entry.fileName, Buffer.concat(chunks));
    }
  } finally {
    zip.close();
  }
  if (entries.length === 0) {
    throw new ProjectStoreError("archive-empty", "archive has no entries");
  }
  return values;
}
