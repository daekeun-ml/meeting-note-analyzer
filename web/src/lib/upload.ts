import type { CreateMeetingResponse } from "@meeting-notes/shared";

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

const ATTEMPTS = 3;

/**
 * S3 multipart upload from the browser. Each part is read into memory with `slice().arrayBuffer()` before the PUT:
 * iOS home-screen web apps fail with a bare "network error" when a File picked from the Files app is streamed
 * directly, and smaller requests survive flaky mobile connections; every part is retried independently.
 */
export async function uploadMultipart(file: File, upload: Pick<CreateMeetingResponse["upload"], "parts" | "partSize">, onProgress: (pct: number) => void): Promise<UploadedPart[]> {
  const done: UploadedPart[] = [];
  let uploadedBytes = 0;
  for (const part of upload.parts) {
    const start = (part.partNumber - 1) * upload.partSize;
    const end = Math.min(start + upload.partSize, file.size);
    const bytes = await file.slice(start, end).arrayBuffer();
    const etag = await putPart(part.url, bytes, part.partNumber, upload.parts.length, (loaded) => onProgress(Math.min(99, Math.round(((uploadedBytes + loaded) / Math.max(1, file.size)) * 100))));
    uploadedBytes += bytes.byteLength;
    done.push({ partNumber: part.partNumber, etag });
  }
  onProgress(100);
  return done;
}

async function putPart(url: string, bytes: ArrayBuffer, partNumber: number, partCount: number, onLoaded: (loaded: number) => void): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return await putOnce(url, bytes, onLoaded);
    } catch (err) {
      lastError = err as Error;
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }
  }
  const reachable = await probe(new URL(url).origin);
  throw new Error(`${lastError?.message ?? "업로드 실패"} (부분 ${partNumber}/${partCount}, ${ATTEMPTS}회 시도, 업로드 서버 ${reachable ? "연결 가능" : "연결 불가"})`);
}

/** Can the device reach the upload origin at all? Distinguishes a blocked host from a failing request. */
async function probe(origin: string): Promise<boolean> {
  try {
    await fetch(`${origin}/`, { method: "HEAD", mode: "no-cors", cache: "no-store" });
    return true;
  } catch {
    return false;
  }
}

function putOnce(url: string, bytes: ArrayBuffer, onLoaded: (loaded: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.timeout = 10 * 60_000;
    xhr.upload.onprogress = (e) => onLoaded(e.loaded);
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(`업로드 실패 (HTTP ${xhr.status})`));
      const etag = xhr.getResponseHeader("ETag");
      if (!etag) return reject(new Error("업로드 응답에 ETag가 없습니다"));
      resolve(etag);
    };
    xhr.onerror = () => reject(new Error("네트워크 오류로 업로드에 실패했습니다"));
    xhr.ontimeout = () => reject(new Error("업로드 시간이 초과되었습니다"));
    xhr.onabort = () => reject(new Error("업로드가 취소되었습니다"));
    xhr.send(bytes);
  });
}
