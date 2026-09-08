import type { SpeakerCorrection } from "./stt.js";

/**
 * Stage output contracts. The Python agent runtime enforces these with pydantic
 * (agents/src/schemas/*.py); keep both in sync. All text fields are written in the
 * requested output language, speaker/segment ids reference the normalized transcript.
 */

export interface TranscriptAnalysis {
  languages: { code: string; share: number }[];
  primaryLanguage: string;
  quality: { overall: "good" | "fair" | "poor"; issues: { type: string; description: string; segmentIds: string[] }[] };
  glossary: { term: string; normalized?: string; kind: "person" | "org" | "product" | "project" | "acronym" | "other"; notes?: string }[];
  normalizations: { segmentId: string; original: string; corrected: string; reason: string }[];
  notes: string;
}

export interface TopicSegmentation {
  meetingType: string;
  purpose: string;
  overview: string;
  topics: { id: string; title: string; startSec: number; endSec: number; segmentIds: string[]; summary: string; keywords: string[] }[];
}

export interface AttributionDecision {
  decision?: "confirmed" | "review_required";
  basis?: "explicit_identity" | "context";
  support?: { segmentId: string; quote: string }[];
}

export interface SpeakerAttribution {
  speakers: (AttributionDecision & {
    id: string; label: string; name?: string; role?: string; confidence: number; evidence: string[];
    reviewRequired?: boolean; proposedLabel?: string; reviewReason?: string; nameConfirmedByUser?: boolean;
  })[];
  merges: (AttributionDecision & { from: string[]; to: string; confidence?: number; reason?: string })[];
  relabels: (AttributionDecision & { segmentId: string; from: string; to: string; reason?: string; confidence?: number })[];
  /** Runtime output only. These proposals have NOT changed the transcript's speaker ids. */
  reviewItems?: SpeakerCorrection[];
  notes: string;
}

export interface Agenda {
  items: {
    id: string;
    title: string;
    background: string;
    discussionPoints: string[];
    decisions: string[];
    openQuestions: string[];
    participants: string[];
    startSec: number;
    endSec: number;
    topicIds: string[];
  }[];
}

export interface Summary {
  headline: string;
  overview: string;
  keyDecisions: string[];
  keyDiscussions: { title: string; detail: string }[];
  risksAndIssues: string[];
  nextSteps: string[];
  markdown: string;
}

export interface Notes {
  markdown: string;
  sections: { agendaId?: string; title: string; bullets: string[] }[];
}

/** Final, compact recap. Decision/action/question references are verified against the detailed outputs. */
export interface MeetingBrief {
  headline: string;
  decisions: {
    agendaId: string;
    decisionIndex: number;
    decision: string;
    process: string;
    rationaleStatus: "supported" | "not_recorded";
    evidenceSegmentIds: string[];
    evidence: { segmentId: string; start: number; speaker: string; text: string }[];
  }[];
  /** Resolve titles, owners and due dates from NotesDocument.followUps, including later speaker renames. */
  followUpIds: string[];
  openQuestions: { agendaId: string; questionIndex: number; question: string }[];
  omittedCounts: { decisions: number; followUps: number; openQuestions: number };
}

export interface FollowUps {
  items: {
    id: string;
    title: string;
    ownerSpeakerId?: string;
    ownerName?: string;
    dueHint?: string;
    priority: "high" | "medium" | "low";
    evidenceSegmentIds: string[];
    status: "new" | "carried_over";
    carriedFrom?: string;
  }[];
}

export interface Suggestions {
  items: {
    id: string;
    target: { kind: "agenda" | "question" | "problem"; refId?: string; title: string };
    suggestion: string;
    alternatives: string[];
    nextSteps: string[];
    risks: string[];
    clarifyingQuestions: string[];
    conflictsWithPast?: string;
  }[];
}

export type MindMapNodeKind = "root" | "agenda" | "topic" | "decision" | "question" | "followup" | "risk" | "suggestion" | "note";

export interface MindMapNode {
  id: string;
  parentId?: string | null;
  label: string;
  kind: MindMapNodeKind;
  ref?: string | null;
}

/** Flat node list (parentId links) plus what the runtime computed after the reviewer subagent: coverage, Mermaid, outline. */
export interface MindMap {
  nodes: MindMapNode[];
  review: { verdict: "pass" | "revised"; findings: string[] };
  coverage?: { agenda: number; followUps: number; decisions: number };
  mermaid?: string;
  outline?: string;
}

export interface StageOutputs {
  transcript_analysis: TranscriptAnalysis;
  topic_segmentation: TopicSegmentation;
  speaker_attribution: SpeakerAttribution;
  agenda: Agenda;
  summary: Summary;
  notes: Notes;
  follow_ups: FollowUps;
  suggestions: Suggestions;
  mindmap: MindMap;
  meeting_brief: MeetingBrief;
}

/** Final document assembled by the Finalize step (results/{id}/notes.json). */
export interface NotesDocument {
  version: 1;
  meetingId: string;
  title: string;
  generatedAt: string;
  outputLanguage: string;
  detectedLanguage: string | null;
  durationSec: number;
  speakers: SpeakerAttribution["speakers"];
  topics: TopicSegmentation["topics"];
  meetingType: string;
  purpose: string;
  summary: Summary;
  agenda: Agenda["items"];
  notes: Notes;
  followUps: FollowUps["items"];
  suggestions: Suggestions["items"];
  /** Absent on documents generated before the mind-map stage existed. */
  mindmap?: MindMap;
  /** Absent on older meetings until the user requests a brief. */
  brief?: MeetingBrief;
  transcriptAnalysis: Pick<TranscriptAnalysis, "languages" | "primaryLanguage" | "quality" | "glossary">;
}
