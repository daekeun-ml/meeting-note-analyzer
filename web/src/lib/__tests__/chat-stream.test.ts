import { describe, expect, it } from "vitest";
import { parseFrame } from "../chat-stream";

describe("parseFrame", () => {
  it("decodes data lines and ignores comments and garbage", () => {
    const frame = ': keepalive\ndata: {"type":"text","delta":"안"}\ndata: not json\nevent: message\ndata: {"type":"done","messageSeq":3,"evidenceCount":2}';
    expect(parseFrame(frame)).toEqual([
      { type: "text", delta: "안" },
      { type: "done", messageSeq: 3, evidenceCount: 2 },
    ]);
  });
  it("returns nothing for an empty frame", () => {
    expect(parseFrame("")).toEqual([]);
  });
});

it("sha256Hex matches a known digest", async () => {
  const { sha256Hex } = await import("../chat-stream");
  expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
