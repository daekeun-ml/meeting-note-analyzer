/** Byte ranges for an S3 multipart upload; always at least one part so tiny files still complete. */
export function planParts(fileSize: number, partSize: number): { partNumber: number; start: number; end: number }[] {
  const count = Math.max(1, Math.ceil(fileSize / partSize));
  return Array.from({ length: count }, (_, i) => ({ partNumber: i + 1, start: i * partSize, end: Math.min((i + 1) * partSize, fileSize) }));
}

/**
 * Point a presigned S3 URL at the app's own origin (CloudFront `/uploads/*` behavior forwards it to the bucket).
 * The SigV4 signature stays valid because CloudFront sends the bucket host to S3 and forwards the query string.
 * Same-origin uploads need no CORS preflight and work on networks that block direct access to amazonaws.com.
 */
export function rewriteUploadUrl(presignedUrl: string, baseUrl: string | undefined): string {
  if (!baseUrl) return presignedUrl;
  const u = new URL(presignedUrl);
  return `${baseUrl.replace(/\/$/, "")}${u.pathname}${u.search}`;
}
