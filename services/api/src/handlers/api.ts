import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { callerFrom, HttpError, json, parseBody, pathParam } from "../lib/http.js";
import { loadVapid } from "@meeting-notes/backend";
import {
  completeUpload,
  completeUploadSchema,
  createMeeting,
  createMeetingBrief,
  createMeetingSchema,
  getMeetingResult,
  listMeetings,
  removeMeeting,
  requireOwnedMeeting,
  renameSpeakers,
  retryMeeting,
  updateSpeakersSchema,
} from "../routes/meetings.js";
import { subscribe, subscriptionSchema, unsubscribe, unsubscribeSchema } from "../routes/push.js";
import { createChatSessionSchema, createSession, getMessages, listSessions, removeSession } from "../routes/chat.js";
import { toMeetingDto } from "@meeting-notes/shared";

type Route = (event: APIGatewayProxyEventV2WithJWTAuthorizer) => Promise<APIGatewayProxyResultV2>;

/** Route table keyed by "<METHOD> <routeKey path>" as API Gateway HTTP API reports it. */
const routes: Record<string, Route> = {
  "GET /api/me": async (event) => {
    const caller = callerFrom(event);
    return json(200, { sub: caller.sub, email: caller.email ?? null, name: caller.name ?? null });
  },
  "POST /api/meetings": async (event) => {
    const caller = callerFrom(event);
    const input = parseBody(event, createMeetingSchema);
    return json(201, await createMeeting(caller, input));
  },
  "GET /api/meetings": async (event) => {
    const caller = callerFrom(event);
    return json(200, await listMeetings(caller, event.queryStringParameters?.["cursor"]));
  },
  "GET /api/meetings/{id}": async (event) => {
    const caller = callerFrom(event);
    const rec = await requireOwnedMeeting(caller, pathParam(event, "id"));
    return json(200, { meeting: toMeetingDto(rec) });
  },
  "POST /api/meetings/{id}/complete-upload": async (event) => {
    const caller = callerFrom(event);
    await completeUpload(caller, pathParam(event, "id"), parseBody(event, completeUploadSchema));
    return json(204, {});
  },
  "POST /api/meetings/{id}/retry": async (event) => {
    const caller = callerFrom(event);
    return json(202, await retryMeeting(caller, pathParam(event, "id")));
  },
  "POST /api/meetings/{id}/brief": async (event) => json(202, await createMeetingBrief(callerFrom(event), pathParam(event, "id"))),
  "PATCH /api/meetings/{id}/speakers": async (event) => {
    const caller = callerFrom(event);
    return json(200, await renameSpeakers(caller, pathParam(event, "id"), parseBody(event, updateSpeakersSchema)));
  },
  "GET /api/meetings/{id}/result": async (event) => {
    const caller = callerFrom(event);
    return json(200, await getMeetingResult(caller, pathParam(event, "id")));
  },
  "DELETE /api/meetings/{id}": async (event) => {
    const caller = callerFrom(event);
    await removeMeeting(caller, pathParam(event, "id"));
    return json(204, {});
  },
  "PUT /api/push/subscription": async (event) => {
    const caller = callerFrom(event);
    await subscribe(caller, parseBody(event, subscriptionSchema));
    return json(204, {});
  },
  "DELETE /api/push/subscription": async (event) => {
    const caller = callerFrom(event);
    await unsubscribe(caller, parseBody(event, unsubscribeSchema));
    return json(204, {});
  },
  "GET /api/push/vapid-public-key": async () => json(200, { publicKey: (await loadVapid()).publicKey }),
  "GET /api/chat/sessions": async (event) => json(200, await listSessions(callerFrom(event))),
  "POST /api/chat/sessions": async (event) => {
    const caller = callerFrom(event);
    return json(201, await createSession(caller, parseBody(event, createChatSessionSchema)));
  },
  "GET /api/chat/sessions/{id}/messages": async (event) => {
    const caller = callerFrom(event);
    return json(200, await getMessages(caller, pathParam(event, "id")));
  },
  "DELETE /api/chat/sessions/{id}": async (event) => {
    const caller = callerFrom(event);
    await removeSession(caller, pathParam(event, "id"));
    return json(204, {});
  },
};

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  const route = routes[event.routeKey];
  if (!route) return json(404, { error: "not_found", message: `no route ${event.routeKey}` });
  try {
    return await route(event);
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.code, message: err.message });
    console.error("unhandled", { routeKey: event.routeKey, err });
    return json(500, { error: "internal", message: "internal error" });
  }
};
