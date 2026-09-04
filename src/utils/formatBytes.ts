/**
 * Format a byte count as a short, human-readable string ("1.2 MB", "48 KB").
 * Uses base-1024 units and one decimal place above the byte tier.
 */
export function formatBytes(bytes: number | bigint): string {
  const num = typeof bytes === "bigint" ? Number(bytes) : bytes;
  if (!Number.isFinite(num) || num < 0) return "0 B";
  if (num < 1024) return `${Math.round(num)} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  if (num < 1024 * 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  return `${(num / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
