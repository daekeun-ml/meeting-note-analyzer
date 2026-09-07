import { existsSync, readFileSync } from "node:fs";
import type { Construct } from "constructs";

export interface ProjectConfig {
  projectName: string;
  stackPrefix: string;
  region: string;
  /** Filled by the deployment helper after CloudFront assigns the distribution hostname. */
  siteUrl: string;
  cognitoDomainPrefix: string;
  vapidSecretName: string;
  hfTokenSecretName: string;
  sttModelVariant: string;
  sttInstanceType: string;
  sttMinInstances: number;
  sttMaxInstances: number;
  sttAutoscaling: boolean;
  sttDeployEndpoint: boolean;
  sttModelRevision: string;
  alarmEmail: string;
  enableSlackAlarms: boolean;
  opusModel: string;
  sonnetModel: string;
  haikuModel: string;
  lectureMaxModelCalls: number;
  lectureMaxSearchCalls: number;
  stageBudgetUsd: number;
}

export const repoPath = (rel: string) => new URL(`../../${rel}`, import.meta.url).pathname;

export function loadConfig(scope: Construct): ProjectConfig {
  const defaults = JSON.parse(readFileSync(repoPath("deploy.example.json"), "utf8")) as Record<string, unknown>;
  const localPath = process.env.MEETING_CONFIG_FILE || repoPath("deploy.local.json");
  const local = existsSync(localPath) ? JSON.parse(readFileSync(localPath, "utf8")) as Record<string, unknown> : {};
  const value = (key: string, fallback: unknown = ""): unknown => scope.node.tryGetContext(key) ?? local[key] ?? defaults[key] ?? fallback;
  const text = (key: string, fallback = "") => String(value(key, fallback));
  const bool = (key: string): boolean => {
    const v = value(key);
    if (![true, false, "true", "false"].includes(v as boolean | string)) throw new Error(`${key} must be true or false`);
    return v === true || v === "true";
  };
  const integer = (key: string, minimum: number, maximum: number) => {
    const v = Number(value(key));
    if (!Number.isInteger(v) || v < minimum || v > maximum) throw new Error(`${key} must be an integer from ${minimum} to ${maximum}`);
    return v;
  };
  const projectName = text("projectName");
  const stackPrefix = text("stackPrefix");
  if (!/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(projectName)) throw new Error("projectName must contain 3-32 lowercase letters, digits or hyphens");
  if (!/^[A-Za-z][A-Za-z0-9-]{1,39}$/.test(stackPrefix)) throw new Error("stackPrefix must contain 2-40 letters, digits or hyphens");
  const siteUrl = text("siteUrl").replace(/\/+$/, "");
  if (siteUrl && !/^https:\/\/[a-z0-9]+\.cloudfront\.net$/.test(siteUrl)) throw new Error("siteUrl must be the HTTPS CloudFront distribution URL without a path");
  const sttMinInstances = integer("sttMinInstances", 0, 10);
  const sttMaxInstances = integer("sttMaxInstances", 1, 10);
  if (sttMaxInstances < sttMinInstances) throw new Error("sttMaxInstances must be at least sttMinInstances");
  const stageBudgetUsd = Number(value("stageBudgetUsd"));
  if (!Number.isFinite(stageBudgetUsd) || stageBudgetUsd < 0.1 || stageBudgetUsd > 100) throw new Error("stageBudgetUsd must be from 0.1 to 100");
  return {
    projectName, stackPrefix, siteUrl,
    region: process.env.CDK_DEFAULT_REGION || text("region"),
    cognitoDomainPrefix: text("cognitoDomainPrefix"),
    vapidSecretName: `${projectName}/vapid`, hfTokenSecretName: `${projectName}/hf-token`,
    sttModelVariant: text("sttModelVariant"), sttInstanceType: text("sttInstanceType"),
    sttMinInstances, sttMaxInstances, sttAutoscaling: bool("sttAutoscaling"),
    sttDeployEndpoint: bool("sttDeployEndpoint"), sttModelRevision: text("sttModelRevision"),
    alarmEmail: text("alarmEmail"), enableSlackAlarms: bool("enableSlackAlarms"),
    opusModel: text("opusModel"), sonnetModel: text("sonnetModel"), haikuModel: text("haikuModel"),
    lectureMaxModelCalls: integer("lectureMaxModelCalls", 1, 2000), lectureMaxSearchCalls: integer("lectureMaxSearchCalls", 1, 720), stageBudgetUsd,
  };
}
