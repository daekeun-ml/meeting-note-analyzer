import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createChatSession, deleteChatSession, deleteChatSessionMemory, getOwnedChatSession, listChatMessages, listChatSessions } from "@meeting-notes/backend";
import type { ChatMessageDto, ChatSessionDto } from "@meeting-notes/shared";
import { apiEnv } from "../lib/env.js";
import { HttpError, type Caller } from "../lib/http.js";
import { requireOwnedMeeting } from "./meetings.js";

export const createChatSessionSchema = z.object({ meetingId: z.string().min(1).max(128).optional() });

export async function createSession(caller: Caller, input: z.infer<typeof createChatSessionSchema>): Promise<{ session: ChatSessionDto }> {
  if (input.meetingId) await requireOwnedMeeting(caller, input.meetingId); // a foreign meeting id must not become a session scope
  return { session: await createChatSession(caller.sub, randomUUID(), input.meetingId) };
}

export async function listSessions(caller: Caller): Promise<{ items: ChatSessionDto[] }> {
  return { items: await listChatSessions(caller.sub) };
}

export async function requireOwnedSession(caller: Caller, sessionId: string): Promise<ChatSessionDto> {
  const s = await getOwnedChatSession(caller.sub, sessionId);
  if (!s) throw new HttpError(404, "chat session not found", "not_found");
  return s;
}

export async function getMessages(caller: Caller, sessionId: string): Promise<{ session: ChatSessionDto; items: ChatMessageDto[] }> {
  const session = await requireOwnedSession(caller, sessionId);
  return { session, items: await listChatMessages(sessionId) };
}

export async function removeSession(caller: Caller, sessionId: string): Promise<void> {
  await requireOwnedSession(caller, sessionId);
  // Memory first, like meetings: if it fails the session stays visible and can be deleted again.
  if (apiEnv.chatMemoryId) await deleteChatSessionMemory(apiEnv.chatMemoryId, caller.sub, sessionId);
  await deleteChatSession(sessionId);
}
