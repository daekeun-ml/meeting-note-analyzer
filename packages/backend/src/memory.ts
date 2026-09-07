import {
  BatchDeleteMemoryRecordsCommand,
  BedrockAgentCoreClient,
  DeleteEventCommand,
  ListEventsCommand,
  ListMemoryRecordsCommand,
  type ListEventsCommandOutput,
  type ListMemoryRecordsCommandOutput,
} from "@aws-sdk/client-bedrock-agentcore";

const agentcore = new BedrockAgentCoreClient({});

/**
 * Remove everything AgentCore Memory holds for one meeting: the session's events (short-term notes and the final
 * summary event) and the long-term meeting summary records under /users/{actor}/meetings/{meetingId}.
 * User-level semantic facts are extracted across meetings and cannot be attributed to a single meeting, so they stay.
 */
export async function deleteMeetingMemory(memoryId: string, actorId: string, meetingId: string, title?: string): Promise<{ events: number; records: number }> {
  let events = 0;
  let nextToken: string | undefined;
  do {
    const page: ListEventsCommandOutput = await agentcore.send(new ListEventsCommand({ memoryId, actorId, sessionId: meetingId, maxResults: 100, nextToken, includePayloads: false }));
    for (const ev of page.events ?? []) {
      if (!ev.eventId) continue;
      await agentcore.send(new DeleteEventCommand({ memoryId, actorId, sessionId: meetingId, eventId: ev.eventId }));
      events += 1;
    }
    nextToken = page.nextToken;
  } while (nextToken);

  let records = 0;
  nextToken = undefined;
  do {
    const page: ListMemoryRecordsCommandOutput = await agentcore.send(new ListMemoryRecordsCommand({ memoryId, namespace: `/users/${actorId}/meetings/${meetingId}`, maxResults: 100, nextToken }));
    const ids: string[] = (page.memoryRecordSummaries ?? []).map((r) => r.memoryRecordId).filter((id): id is string => !!id);
    if (ids.length) {
      await agentcore.send(new BatchDeleteMemoryRecordsCommand({ memoryId, records: ids.map((memoryRecordId) => ({ memoryRecordId })) }));
      records += ids.length;
    }
    nextToken = page.nextToken;
  } while (nextToken);
  // Semantic facts are extracted across meetings and carry no meeting id, so the best available signal is the title:
  // a fact that names the deleted meeting would otherwise keep resurfacing in chat answers (seen 2026-09-06).
  if (title && title.trim().length >= 6) {
    const needle = title.trim();
    nextToken = undefined;
    do {
      const page: ListMemoryRecordsCommandOutput = await agentcore.send(new ListMemoryRecordsCommand({ memoryId, namespace: `/users/${actorId}/facts`, maxResults: 100, nextToken }));
      const ids: string[] = (page.memoryRecordSummaries ?? []).filter((r) => (r.content?.text ?? "").includes(needle) || (r.content?.text ?? "").includes(meetingId)).map((r) => r.memoryRecordId).filter((id): id is string => !!id);
      if (ids.length) {
        await agentcore.send(new BatchDeleteMemoryRecordsCommand({ memoryId, records: ids.map((memoryRecordId) => ({ memoryRecordId })) }));
        records += ids.length;
      }
      nextToken = page.nextToken;
    } while (nextToken);
  }
  return { events, records };
}

/** Remove a chat session from the chat memory: its conversational events and the summary records under /chat/{actor}/{session}. */
export async function deleteChatSessionMemory(memoryId: string, actorId: string, sessionId: string): Promise<{ events: number; records: number }> {
  let events = 0;
  let nextToken: string | undefined;
  do {
    const page: ListEventsCommandOutput = await agentcore.send(new ListEventsCommand({ memoryId, actorId, sessionId, maxResults: 100, nextToken, includePayloads: false }));
    for (const ev of page.events ?? []) {
      if (!ev.eventId) continue;
      await agentcore.send(new DeleteEventCommand({ memoryId, actorId, sessionId, eventId: ev.eventId }));
      events += 1;
    }
    nextToken = page.nextToken;
  } while (nextToken);
  let records = 0;
  nextToken = undefined;
  do {
    const page: ListMemoryRecordsCommandOutput = await agentcore.send(new ListMemoryRecordsCommand({ memoryId, namespace: `/chat/${actorId}/${sessionId}`, maxResults: 100, nextToken }));
    const ids: string[] = (page.memoryRecordSummaries ?? []).map((r) => r.memoryRecordId).filter((id): id is string => !!id);
    if (ids.length) {
      await agentcore.send(new BatchDeleteMemoryRecordsCommand({ memoryId, records: ids.map((memoryRecordId) => ({ memoryRecordId })) }));
      records += ids.length;
    }
    nextToken = page.nextToken;
  } while (nextToken);
  return { events, records };
}
