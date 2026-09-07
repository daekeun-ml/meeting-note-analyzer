import { BedrockAgentClient, ListIngestionJobsCommand, StartIngestionJobCommand } from "@aws-sdk/client-bedrock-agent";

const client = new BedrockAgentClient({});
const knowledgeBaseId = process.env["KNOWLEDGE_BASE_ID"] ?? "";
const dataSourceId = process.env["DATA_SOURCE_ID"] ?? "";
const POLL_MS = 15_000;
const MAX_WAIT_MS = 11 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runningJobStartedAfter(since: number): Promise<boolean> {
  const res = await client.send(new ListIngestionJobsCommand({ knowledgeBaseId, dataSourceId, filters: [{ attribute: "STATUS", operator: "EQ", values: ["IN_PROGRESS"] }], maxResults: 5 }));
  return (res.ingestionJobSummaries ?? []).some((j) => (j.startedAt?.getTime() ?? 0) >= since);
}

/**
 * S3 EventBridge -> here. A managed KB syncs from S3 only when an ingestion job runs, and only one job may run at a
 * time, so wait out a running job (unless it started after this event and therefore already sees the change).
 */
export const handler = async (event: { time?: string; detail?: { object?: { key?: string }; reason?: string } }): Promise<{ jobId?: string; skipped?: boolean }> => {
  const eventTime = event.time ? Date.parse(event.time) : Date.now();
  const key = event.detail?.object?.key;
  const deadline = Date.now() + MAX_WAIT_MS;
  while (true) {
    try {
      const res = await client.send(new StartIngestionJobCommand({ knowledgeBaseId, dataSourceId, description: `s3 change: ${key ?? "unknown"}` }));
      console.log("ingestion started", { key, jobId: res.ingestionJob?.ingestionJobId });
      return { jobId: res.ingestionJob?.ingestionJobId };
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name !== "ConflictException" && name !== "ThrottlingException") throw err;
      // A burst of sidecar events (finalize writes two per meeting, backfills write many) hits the StartIngestionJob rate limit.
      if (name === "ThrottlingException") {
        if (Date.now() > deadline) throw err;
        await sleep(5_000 + Math.random() * 5_000);
        continue;
      }
      if (await runningJobStartedAfter(eventTime)) {
        console.log("a newer ingestion job already covers this change", { key });
        return { skipped: true };
      }
      if (Date.now() > deadline) throw new Error(`ingestion job still running after ${MAX_WAIT_MS / 1000}s (key ${key})`);
      await sleep(POLL_MS);
    }
  }
};
