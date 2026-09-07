import type { SNSEvent } from "aws-lambda";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

/** CloudWatch alarm notification as delivered through SNS. */
export interface AlarmMessage {
  AlarmName?: string;
  AlarmDescription?: string | null;
  NewStateValue?: "ALARM" | "OK" | "INSUFFICIENT_DATA" | string;
  NewStateReason?: string;
  StateChangeTime?: string;
  Region?: string;
  AWSAccountId?: string;
  Trigger?: { MetricName?: string; Namespace?: string; Threshold?: number };
}

const secrets = new SecretsManagerClient({});
let cachedWebhook: string | null | undefined;

async function webhookUrl(): Promise<string | null> {
  if (cachedWebhook !== undefined) return cachedWebhook;
  const name = process.env["SLACK_WEBHOOK_SECRET_NAME"];
  if (!name) return (cachedWebhook = null);
  try {
    const res = await secrets.send(new GetSecretValueCommand({ SecretId: name }));
    const raw = (res.SecretString ?? "").trim();
    const url = raw.startsWith("{") ? ((JSON.parse(raw) as { url?: string }).url ?? "") : raw;
    cachedWebhook = url.startsWith("https://hooks.slack.com/") ? url : null;
  } catch (err) {
    console.warn("slack webhook secret unavailable", String(err));
    cachedWebhook = null;
  }
  return cachedWebhook;
}

/** "2026-09-06 14:00" in Korea Standard Time; manual formatting keeps the output stable across Node ICU builds. */
export function kst(iso: string | undefined): string {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  const k = new Date(t.getTime() + 9 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

/** Korean, plain-text Slack payload (no emoji); the alarm description is the headline, the raw name stays in the footer. */
export function formatSlackMessage(alarm: AlarmMessage): { text: string; attachments: { color: string; text: string; footer: string }[] } {
  const state = alarm.NewStateValue ?? "UNKNOWN";
  const headline = alarm.AlarmDescription || alarm.AlarmName || "알 수 없는 알람";
  const label = state === "ALARM" ? "발생" : state === "OK" ? "해제" : state;
  const color = state === "ALARM" ? "#e5484d" : state === "OK" ? "#30a46c" : "#8d8d8d";
  const region = alarm.Region ?? "us-east-1";
  const consoleUrl = alarm.AlarmName ? `https://console.aws.amazon.com/cloudwatch/home?region=${region}#alarmsV2:alarm/${encodeURIComponent(alarm.AlarmName)}` : "";
  const lines = [
    `사유: ${alarm.NewStateReason ?? "(없음)"}`,
    `시각: ${kst(alarm.StateChangeTime)} (KST)`,
    alarm.Trigger?.MetricName ? `지표: ${alarm.Trigger.Namespace ?? ""} ${alarm.Trigger.MetricName}` : "",
    consoleUrl ? `콘솔: ${consoleUrl}` : "",
  ].filter(Boolean);
  return {
    text: `[회의록 시스템] 알람 ${label}: ${headline}`,
    attachments: [{ color, text: lines.join("\n"), footer: alarm.AlarmName ?? "" }],
  };
}

export const handler = async (event: SNSEvent): Promise<void> => {
  const url = await webhookUrl();
  for (const record of event.Records) {
    let alarm: AlarmMessage;
    try {
      alarm = JSON.parse(record.Sns.Message) as AlarmMessage;
    } catch {
      alarm = { AlarmName: record.Sns.Subject ?? "SNS", NewStateReason: record.Sns.Message };
    }
    const payload = formatSlackMessage(alarm);
    if (!url) {
      console.warn("slack webhook not configured; alarm not delivered", payload.text);
      continue;
    }
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`slack webhook HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    console.log("delivered", payload.text);
  }
};
