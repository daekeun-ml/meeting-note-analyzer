export function parseS3Uri(uri: string): { bucket: string; key: string } {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!m || !m[1] || !m[2]) throw new Error(`invalid s3 uri: ${uri}`);
  return { bucket: m[1], key: m[2] };
}
