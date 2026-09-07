import { describe, expect, it } from "vitest";
import { classifySttFailure } from "../src/handlers/transcription-callback.js";

describe("classifySttFailure", () => {
  it("marks endpoint-side outages as transient so the state machine retries once", () => {
    expect(classifySttFailure("ClientError: Received server error (0) from model. See the SageMaker Endpoint logs in your account for more information.")).toBe("SttTransient");
    expect(classifySttFailure("Amazon SageMaker could not get a response from the meeting-notes-stt endpoint. This can occur when CPU or memory utilization is high.")).toBe("SttTransient");
  });
  it("keeps container rejections and unknown reasons as hard failures", () => {
    expect(classifySttFailure("ClientError: Received client error (400) from model: audio longer than 4 hours")).toBe("SttFailed");
    expect(classifySttFailure(undefined)).toBe("SttFailed");
  });
});
