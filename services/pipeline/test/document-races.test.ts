import { beforeEach, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({ getMeeting: vi.fn(), readJson: vi.fn(), putFinalDocument: vi.fn(), setMeetingTitle: vi.fn(), notifyUser: vi.fn() }));
const update = vi.hoisted(() => vi.fn());
const locking = vi.hoisted(() => ({ busy: false }));
vi.mock("@meeting-notes/backend", async original => {
  const actual = await original<typeof import("@meeting-notes/backend")>();
  return { ...actual, ...backend, withDocumentLock: async (_id: string, operation: () => Promise<unknown>) => {
    if (locking.busy) throw new actual.DocumentBusyError();
    locking.busy = true;
    try { return await operation(); } finally { locking.busy = false; }
  } };
});
vi.mock("../src/lib/meeting-updates.js", () => ({ updateMeeting: update }));
vi.mock("../src/lib/env.js", () => ({ pipelineEnv: { memoryId: "", webOrigin: "https://example.test" } }));
import { updateMeetingTitle } from "../../api/src/routes/meetings.js";
import { handler as finalize } from "../src/handlers/finalize.js";

let record: any; let document: any;
const key = "results/m1/document.json";
const brief = { headline: "새 추가 요약" };
const input = { meetingId: "m1", ownerSub: "u1", title: "이전 제목", transcriptKey: "raw", outputLanguage: "ko", briefOnly: true };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetAllMocks(); locking.busy = false;
  record = { meetingId: "m1", owner: "u1", title: "이전 제목", status: "COMPLETED", notesKey: key, stages: {}, completedAt: "old" };
  document = { meetingId: "m1", title: "이전 제목", speakers: [], followUps: [] };
  backend.getMeeting.mockImplementation(async () => structuredClone(record));
  backend.readJson.mockImplementation(async k => structuredClone(k === key ? document : brief));
  backend.putFinalDocument.mockImplementation(async (_owner, doc) => { document = structuredClone(doc); return { notesKey: key }; });
  backend.setMeetingTitle.mockImplementation(async (_id, title) => { record.title = title; });
  update.mockImplementation(async (_id, fields) => { Object.assign(record, fields); });
  backend.notifyUser.mockResolvedValue({ sent: 0 });
});
function pauseFirstRead() {
  const entered = deferred(), release = deferred(); let read = 0;
  backend.readJson.mockImplementation(async k => {
    if (k !== key) return brief;
    const snapshot = structuredClone(document);
    if (++read === 1) { entered.resolve(); await release.promise; }
    return snapshot;
  });
  return { entered, release };
}
it("a concurrent title edit can retry after Finalize without dropping its new brief", async () => {
  const { entered, release } = pauseFirstRead();
  const finishing = finalize(input); await entered.promise;
  await expect(updateMeetingTitle({ sub: "u1" }, "m1", { title: "새 제목" })).rejects.toMatchObject({ status: 409, code: "document_busy" });
  release.resolve(); await finishing;
  await updateMeetingTitle({ sub: "u1" }, "m1", { title: "새 제목" });
  expect(document).toMatchObject({ title: "새 제목", brief }); expect(record.title).toBe("새 제목");
  expect(backend.getMeeting).toHaveBeenCalledWith("m1", true);
});
it("Finalize retries safely after a title edit and reads the new title under the lock", async () => {
  const { entered, release } = pauseFirstRead();
  const renaming = updateMeetingTitle({ sub: "u1" }, "m1", { title: "새 제목" }); await entered.promise;
  await expect(finalize(input)).rejects.toMatchObject({ name: "DocumentBusyError" });
  release.resolve(); await renaming; await finalize(input);
  expect(document).toMatchObject({ title: "새 제목", brief }); expect(record.title).toBe("새 제목");
});
