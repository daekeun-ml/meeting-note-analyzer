import { PutObjectCommand } from "@aws-sdk/client-s3";
import { BedrockAgentCoreClient, CreateEventCommand } from "@aws-sdk/client-bedrock-agentcore";
import { env, getMeeting, notifyUser, readJson, s3, putFinalDocument } from "@meeting-notes/backend";
import { STAGES, s3Keys, type MeetingBrief, type NotesDocument, type StageOutputs, type Transcript } from "@meeting-notes/shared";
import { pipelineEnv } from "../lib/env.js";
import { updateMeeting } from "../lib/meeting-updates.js";
import { transcriptToMarkdown } from "../lib/transcript-format.js";

const agentcore = new BedrockAgentCoreClient({});

export interface FinalizeInput { meetingId: string; ownerSub: string; title: string; outputLanguage: string; transcriptKey: string; briefOnly?: boolean; expectBrief?: boolean }

/** Pure assembly of the final document from stage outputs; exported for tests. */
export function assembleNotes(input: FinalizeInput, transcript: Transcript, outputs: StageOutputs, now = new Date()): NotesDocument {
  return {
    version: 1,
    meetingId: input.meetingId,
    title: input.title,
    generatedAt: now.toISOString(),
    outputLanguage: input.outputLanguage,
    detectedLanguage: transcript.language,
    durationSec: transcript.durationSec,
    speakers: outputs.speaker_attribution.speakers,
    topics: outputs.topic_segmentation.topics,
    meetingType: outputs.topic_segmentation.meetingType,
    purpose: outputs.topic_segmentation.purpose,
    summary: outputs.summary,
    agenda: outputs.agenda.items,
    notes: outputs.notes,
    followUps: outputs.follow_ups.items,
    suggestions: outputs.suggestions.items,
    mindmap: outputs.mindmap,
    brief: outputs.meeting_brief,
    transcriptAnalysis: {
      languages: outputs.transcript_analysis.languages,
      primaryLanguage: outputs.transcript_analysis.primaryLanguage,
      quality: outputs.transcript_analysis.quality,
      glossary: outputs.transcript_analysis.glossary,
    },
  };
}


async function recordMemory(input: FinalizeInput, doc: NotesDocument): Promise<void> {
  if (!pipelineEnv.memoryId) return;
  const userText = `Meeting "${doc.title}" (${doc.generatedAt.slice(0, 10)}, ${Math.round(doc.durationSec / 60)} min, type: ${doc.meetingType}). Participants: ${doc.speakers.map((s) => `${s.label}${s.role ? ` (${s.role})` : ""}`).join(", ")}. Please remember the outcome.`;
  const assistantText = [
    `Summary: ${doc.summary.overview}`,
    doc.summary.keyDecisions.length ? `Decisions: ${doc.summary.keyDecisions.join("; ")}` : "",
    doc.followUps.length ? `Follow-ups: ${doc.followUps.map((f) => `${f.title}${f.ownerName ? ` (owner: ${f.ownerName})` : ""}${f.dueHint ? ` (due: ${f.dueHint})` : ""}`).join("; ")}` : "",
    doc.transcriptAnalysis.glossary.length ? `Glossary: ${doc.transcriptAnalysis.glossary.slice(0, 40).map((g) => `${g.term} [${g.kind}]`).join(", ")}` : "",
  ].filter(Boolean).join("\n");
  await agentcore.send(
    new CreateEventCommand({
      memoryId: pipelineEnv.memoryId,
      actorId: input.ownerSub,
      sessionId: input.meetingId,
      eventTimestamp: new Date(),
      payload: [
        { conversational: { role: "USER", content: { text: userText } } },
        { conversational: { role: "ASSISTANT", content: { text: assistantText.slice(0, 9000) } } },
      ],
    }),
  );
}

export const handler = async (input: FinalizeInput) => {
  const meeting = await getMeeting(input.meetingId);
  if (!meeting || meeting.owner !== input.ownerSub) throw new Error(`meeting ${input.meetingId} not found`);
  let doc: NotesDocument;
  if (input.briefOnly) {
    const previous = meeting.notesKey ? await readJson<NotesDocument>(meeting.notesKey) : null;
    const brief = await readJson<MeetingBrief>(s3Keys.stageResult(input.meetingId, "meeting_brief"));
    if (!previous || previous.meetingId !== input.meetingId || !brief) throw new Error("published document or brief missing");
    // Preserve edited speaker labels, detailed content and the original document date.
    doc = { ...previous, brief };
  } else {
    const transcript = await readJson<Transcript>(input.transcriptKey);
    if (!transcript) throw new Error(`transcript missing at ${input.transcriptKey}`);
    const outputs = {} as StageOutputs;
    for (const stage of STAGES) {
      const data = await readJson(s3Keys.stageResult(input.meetingId, stage));
      // Executions started on the old state machine may still finalize during a rolling deployment.
      if (!data && stage === "meeting_brief" && !input.expectBrief) continue;
      if (!data) throw new Error(`stage output missing: ${stage}`);
      (outputs as unknown as Record<string, unknown>)[stage] = data;
    }
    doc = assembleNotes(input, transcript, outputs);
    const attributed = await readJson<Transcript>(s3Keys.attributedTranscript(input.meetingId));
    if (attributed?.speakerAttribution?.version === 2) {
      if (attributed.meetingId !== input.meetingId) throw new Error("attributed transcript meeting mismatch");
      // The knowledge base consumes this markdown. Keep it in sync with the
      // transcript shown in the UI; the original JSON remains untouched.
      await s3.send(new PutObjectCommand({ Bucket: env.dataBucket, Key: s3Keys.transcriptMd(input.meetingId),
        Body: transcriptToMarkdown(attributed, input.title), ContentType: "text/markdown; charset=utf-8" }));
    }
  }
  const { notesKey } = await putFinalDocument(input.ownerSub, doc);
  const now = new Date().toISOString();
  await updateMeeting(input.meetingId, { status: "COMPLETED", notesKey, speakerCount: doc.speakers.length, completedAt: input.briefOnly ? meeting.completedAt ?? now : now, currentStage: "done" }, undefined, ["briefOnly", "briefStatus", "briefError", "briefExecutionArn"]);
  try {
    if (!input.briefOnly) await recordMemory(input, doc);
  } catch (err) {
    console.warn("memory event failed (non-fatal)", String(err));
  }
  const push = await notifyUser(input.ownerSub, {
    title: input.briefOnly ? (input.outputLanguage === "en" ? "Meeting brief is ready" : "추가 요약이 준비되었습니다") : (input.outputLanguage === "en" ? "Meeting notes are ready" : "회의록이 준비되었습니다"),
    body: doc.title,
    url: `${pipelineEnv.webOrigin}/meetings/${input.meetingId}`,
    tag: `meeting-${input.meetingId}`,
  }).catch((error: unknown) => {
    if (!input.briefOnly) throw error;
    // The recap is already published. A notification failure must not turn it into a full-pipeline retry.
    console.warn("brief notification failed (non-fatal)", String(error));
    return { sent: 0, pruned: 0, failed: true };
  });
  return { notesKey, push };
};
