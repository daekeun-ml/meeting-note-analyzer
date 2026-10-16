import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_LECTURE_PREFERENCES } from "@meeting-notes/shared";
const mocks = vi.hoisted(() => ({ send: vi.fn(), create: vi.fn(), start: vi.fn() }));
vi.mock("@meeting-notes/backend", async (original) => ({ ...await original<typeof import("@meeting-notes/backend")>(), ddb: { send: mocks.send }, lectureTable: () => "lectures" }));
vi.mock("../src/routes/lectures.js", () => ({
  createLecture: mocks.create, startLecture: mocks.start, completeLectureUpload: vi.fn(), lectureResult: vi.fn(), ownedLecture: vi.fn(), removeLecture: vi.fn(),
}));
import { handler } from "../src/handlers/lectures.js";

beforeEach(() => { vi.resetAllMocks(); mocks.send.mockResolvedValue({}); mocks.create.mockResolvedValue({ lecture: {} }); mocks.start.mockResolvedValue({}); });
const event = (routeKey: string, sub = "alice", body?: unknown) => ({
  routeKey, requestContext: { authorizer: { jwt: { claims: { sub } } } },
  pathParameters: { id: "11111111-1111-4111-8111-111111111111" },
  body: JSON.stringify(body),
}) as Parameters<typeof handler>[0];

it("stores settings under the authenticated caller and rejects owner/model injection", async () => {
  expect(await handler(event("GET /api/lecture-preferences"))).toMatchObject({ statusCode: 200, body: JSON.stringify(DEFAULT_LECTURE_PREFERENCES) });
  expect(mocks.send.mock.calls[0]![0].input.Key).toEqual({ PK: "USER#alice", SK: "LECTURE_PREFERENCES" });
  await handler(event("PUT /api/lecture-preferences", "bob", { model: "opus", tone: "friendly" }));
  expect(mocks.send.mock.calls.at(-1)![0].input.Item).toMatchObject({ PK: "USER#bob", preferences: { model: "opus", tone: "friendly" } });
  mocks.send.mockClear();
  for (const body of [{ owner: "bob", model: "opus" }, { model: "arbitrary-model-id" }]) {
    expect(await handler(event("PUT /api/lecture-preferences", "alice", body))).toMatchObject({ statusCode: 400 });
  }
  expect(await handler(event("GET /api/lecture-preferences", ""))).toMatchObject({ statusCode: 401 });
  expect(mocks.send).not.toHaveBeenCalled();
});

it("snapshots saved defaults on creation and passes current settings into explicit reanalysis", async () => {
  const preferences = { ...DEFAULT_LECTURE_PREFERENCES, model: "sonnet", format: "narrative" };
  mocks.send.mockResolvedValue({ Item: { preferences } });
  await handler(event("POST /api/lectures", "alice", { title: "Class", customPrompt: "직관 위주",
    audio: { fileName: "class.mp3", fileSize: 10, contentType: "audio/mpeg" } }));
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ sub: "alice" }), expect.objectContaining({ preferences, customPrompt: "직관 위주" }));
  await handler(event("POST /api/lectures/{id}/retry"));
  expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ sub: "alice" }), "11111111-1111-4111-8111-111111111111", true, preferences);
});
