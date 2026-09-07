/** Canonical S3 object layout for the data bucket. Keep in sync with agents/ (Python) and stt/. */
export const s3Keys = {
  upload: (ownerSub: string, meetingId: string) => `uploads/${ownerSub}/${meetingId}/audio.mp3`,
  sttOutputPrefix: "stt/output/",
  sttFailurePrefix: "stt/failure/",
  modelsPrefix: "models/",
  transcriptJson: (meetingId: string) => `transcripts/${meetingId}/transcript.json`,
  transcriptMd: (meetingId: string) => `transcripts/${meetingId}/transcript.md`,
  stageResult: (meetingId: string, stage: string) => `results/${meetingId}/${stage}.json`,
  /** Final assembled document. Not `notes.json`: that key belongs to the `notes` stage result (stageResult). */
  notesJson: (meetingId: string) => `results/${meetingId}/document.json`,
  notesMd: (meetingId: string) => `results/${meetingId}/document.md`,
  meetingPrefix: (ownerSub: string, meetingId: string) => `uploads/${ownerSub}/${meetingId}/`,
} as const;

const UPLOAD_KEY_RE = /^uploads\/([^/]+)\/([^/]+)\/audio\.mp3$/;

/** Parses `uploads/{sub}/{meetingId}/audio.mp3`; returns null for anything else. */
export function parseUploadKey(key: string): { ownerSub: string; meetingId: string } | null {
  const m = UPLOAD_KEY_RE.exec(key);
  if (!m || !m[1] || !m[2]) return null;
  return { ownerSub: decodeURIComponent(m[1]), meetingId: decodeURIComponent(m[2]) };
}
