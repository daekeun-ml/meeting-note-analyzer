import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { s3Keys, type NotesDocument } from "@meeting-notes/shared";
import { env } from "./env.js";
import { notesToMarkdown } from "./notes-markdown.js";

const s3 = new S3Client({});

/**
 * Sidecar metadata in the Bedrock Knowledge Bases format (`<file>.metadata.json`): the managed knowledge base filters
 * on `owner` and `meetingId`, so every document.md and transcript.md carries one.
 */
export function kbMetadata(ownerSub: string, doc: NotesDocument): string {
  return JSON.stringify({
    metadataAttributes: {
      owner: ownerSub,
      meetingId: doc.meetingId,
      title: doc.title,
      date: doc.generatedAt.slice(0, 10),
      meetingType: doc.meetingType,
      language: doc.detectedLanguage ?? doc.outputLanguage,
      durationMin: Math.round(doc.durationSec / 60),
      speakers: doc.speakers.map((s) => s.label).join(", "),
      agendaCount: doc.agenda.length,
      followUpCount: doc.followUps.length,
    },
  });
}

/** Write document.json + document.md, then the two sidecars: their ObjectCreated events start the KB ingestion. */
export async function putFinalDocument(ownerSub: string, doc: NotesDocument): Promise<{ notesKey: string }> {
  const notesKey = s3Keys.notesJson(doc.meetingId);
  const mdKey = s3Keys.notesMd(doc.meetingId);
  await Promise.all([
    s3.send(new PutObjectCommand({ Bucket: env.dataBucket, Key: notesKey, Body: JSON.stringify(doc), ContentType: "application/json" })),
    s3.send(new PutObjectCommand({ Bucket: env.dataBucket, Key: mdKey, Body: notesToMarkdown(doc), ContentType: "text/markdown; charset=utf-8" })),
  ]);
  const meta = kbMetadata(ownerSub, doc);
  await Promise.all([
    s3.send(new PutObjectCommand({ Bucket: env.dataBucket, Key: `${mdKey}.metadata.json`, Body: meta, ContentType: "application/json" })),
    s3.send(new PutObjectCommand({ Bucket: env.dataBucket, Key: `${s3Keys.transcriptMd(doc.meetingId)}.metadata.json`, Body: meta, ContentType: "application/json" })),
  ]);
  return { notesKey };
}

/**
 * Rename speakers by id. Follow-up owners and other free text that used the old display name follow along so the
 * document stays consistent; unknown ids are ignored, blank names are rejected by the API schema.
 */
export function applySpeakerLabels(doc: NotesDocument, labels: Record<string, string>): { doc: NotesDocument; changed: number } {
  let changed = 0;
  const renames: [string, string][] = [];
  const speakers = doc.speakers.map((s) => {
    const next = labels[s.id]?.trim();
    if (!next || next === s.label) return s;
    changed += 1;
    renames.push([s.label, next]);
    return { ...s, label: next, name: next };
  });
  if (!changed) return { doc, changed };
  const rename = (text: string | undefined) => {
    if (!text) return text;
    let out = text;
    for (const [from, to] of renames) if (out === from) out = to;
    return out;
  };
  const followUps = doc.followUps.map((f) => ({ ...f, ownerName: rename(f.ownerName) }));
  return { doc: { ...doc, speakers, followUps }, changed };
}
