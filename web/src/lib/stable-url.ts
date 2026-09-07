import { useMemo, useState } from "react";

/** Object path of a presigned URL; the query string (signature, date) changes on every API poll. */
export function urlPath(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Keep one presigned URL per object while the parent keeps polling. A fresh signature every 5 s would otherwise
 * remount <audio src> and refetch the transcript, resetting playback. `refresh()` picks up the latest URL
 * (call it when the old one expires and the media errors).
 */
export function useStableUrl(url: string | null): [string | null, () => void] {
  const path = urlPath(url);
  const [gen, setGen] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on the object path only
  const stable = useMemo(() => url, [path, gen]);
  return [stable, () => setGen((g) => g + 1)];
}
