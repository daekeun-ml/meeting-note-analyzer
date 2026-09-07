import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import * as agentcore from "aws-cdk-lib/aws-bedrockagentcore";
import type * as ddb from "aws-cdk-lib/aws-dynamodb";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets";
import * as iam from "aws-cdk-lib/aws-iam";
import type * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { repoPath, type ProjectConfig } from "./config.js";
import { retainRuntimeLogs } from "./runtime-logs.js";

export interface AgentStackProps extends StackProps {
  config: ProjectConfig;
  dataBucket: s3.IBucket;
  table: ddb.ITable;
}

/** AgentCore Memory + the single "meeting-analyst" AgentCore Runtime (Claude Agent SDK on Bedrock). */
export class AgentStack extends Stack {
  readonly runtimeArn: string;
  readonly runtimeId: string;
  readonly memoryId: string;
  readonly memoryArn: string;

  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);
    const { config, dataBucket, table } = props;
    const safeName = config.projectName.replace(/[^a-zA-Z0-9_]/g, "_");

    // ---- memory ----
    const memoryRole = new iam.Role(this, "MemoryRole", {
      assumedBy: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com"),
      description: "Execution role for AgentCore Memory long-term extraction",
    });
    memoryRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: ["arn:aws:bedrock:*::foundation-model/*", `arn:aws:bedrock:*:${this.account}:inference-profile/*`],
      }),
    );
    const memory = new agentcore.CfnMemory(this, "Memory", {
      name: `${safeName}_memory`,
      description: "Meeting notes memory: per-meeting session events + long-term facts/summaries per user",
      eventExpiryDuration: 90,
      memoryExecutionRoleArn: memoryRole.roleArn,
      memoryStrategies: [
        { semanticMemoryStrategy: { name: "facts", description: "People, roles, projects, terms, decisions", namespaces: ["/users/{actorId}/facts"] } },
        { summaryMemoryStrategy: { name: "meeting_summary", description: "Per-meeting summary", namespaces: ["/users/{actorId}/meetings/{sessionId}"] } },
      ],
    });
    this.memoryId = memory.attrMemoryId;
    this.memoryArn = memory.attrMemoryArn;

    // ---- runtime image (arm64) ----
    const image = new ecr_assets.DockerImageAsset(this, "AgentImage", {
      directory: repoPath("agents"),
      platform: ecr_assets.Platform.LINUX_ARM64,
      exclude: ["tests", ".venv", "__pycache__", ".pytest_cache"],
    });

    // ---- runtime execution role ----
    const role = new iam.Role(this, "RuntimeRole", {
      assumedBy: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com", {
        conditions: {
          StringEquals: { "aws:SourceAccount": this.account },
          ArnLike: { "aws:SourceArn": `arn:aws:bedrock-agentcore:${this.region}:${this.account}:*` },
        },
      }),
      description: "Execution role for the meeting-analyst AgentCore runtime",
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "BedrockInvoke",
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: ["arn:aws:bedrock:*::foundation-model/*", `arn:aws:bedrock:*:${this.account}:inference-profile/*`, `arn:aws:bedrock:*:${this.account}:application-inference-profile/*`],
      }),
    );
    role.addToPolicy(new iam.PolicyStatement({ sid: "BedrockDiscover", actions: ["bedrock:ListInferenceProfiles", "bedrock:GetInferenceProfile"], resources: ["*"] }));
    role.addToPolicy(new iam.PolicyStatement({ sid: "StepFunctionsCallback", actions: ["states:SendTaskSuccess", "states:SendTaskFailure", "states:SendTaskHeartbeat"], resources: ["*"] }));
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "MemoryDataPlane",
        actions: ["bedrock-agentcore:CreateEvent", "bedrock-agentcore:GetEvent", "bedrock-agentcore:ListEvents", "bedrock-agentcore:RetrieveMemoryRecords", "bedrock-agentcore:ListMemoryRecords", "bedrock-agentcore:GetMemoryRecord", "bedrock-agentcore:ListSessions", "bedrock-agentcore:ListActors"],
        resources: [this.memoryArn],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "Observability",
        actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams", "logs:DescribeLogGroups", "xray:PutTraceSegments", "xray:PutTelemetryRecords", "xray:GetSamplingRules", "xray:GetSamplingTargets", "ecr:GetAuthorizationToken"],
        resources: ["*"],
      }),
    );
    role.addToPolicy(new iam.PolicyStatement({ sid: "Metrics", actions: ["cloudwatch:PutMetricData"], resources: ["*"], conditions: { StringEquals: { "cloudwatch:namespace": "bedrock-agentcore" } } }));
    role.addToPolicy(new iam.PolicyStatement({ sid: "WorkloadIdentity", actions: ["bedrock-agentcore:GetWorkloadAccessToken", "bedrock-agentcore:GetWorkloadAccessTokenForJWT", "bedrock-agentcore:GetWorkloadAccessTokenForUserId"], resources: [`arn:aws:bedrock-agentcore:${this.region}:${this.account}:workload-identity-directory/default`, `arn:aws:bedrock-agentcore:${this.region}:${this.account}:workload-identity-directory/default/workload-identity/*`] }));
    image.repository.grantPull(role);
    dataBucket.grantRead(role, "transcripts/*");
    dataBucket.grantReadWrite(role, "results/*");
    table.grantReadWriteData(role);

    const runtime = new agentcore.CfnRuntime(this, "Runtime", {
      agentRuntimeName: `${safeName}_meeting_analyst`,
      description: "Meeting analysis stages (Claude Agent SDK on Bedrock): transcript analysis -> ... -> AI suggestions",
      agentRuntimeArtifact: { containerConfiguration: { containerUri: image.imageUri } },
      roleArn: role.roleArn,
      networkConfiguration: { networkMode: "PUBLIC" },
      protocolConfiguration: "HTTP",
      environmentVariables: {
        AWS_REGION: this.region,
        DATA_BUCKET: dataBucket.bucketName,
        TABLE_NAME: table.tableName,
        MEMORY_ID: this.memoryId,
        CLAUDE_CODE_USE_BEDROCK: "1",
        STAGE_BUDGET_USD: String(config.stageBudgetUsd),
        ANTHROPIC_DEFAULT_OPUS_MODEL: config.opusModel,
        ANTHROPIC_DEFAULT_SONNET_MODEL: config.sonnetModel,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: config.haikuModel,
        // Claude Code's auxiliary model (summaries, tool descriptions) otherwise falls back to a regional us.* profile.
        ANTHROPIC_SMALL_FAST_MODEL: config.haikuModel,
        ENABLE_PROMPT_CACHING_1H: "1",
        CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: "1",
        CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "6",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
        DISABLE_TELEMETRY: "1",
        HOME: "/home/agent",
        CLAUDE_CONFIG_DIR: "/home/agent/.claude",
        LOG_LEVEL: "INFO",
      },
    });
    retainRuntimeLogs(this, "RuntimeLogRetention", runtime.attrAgentRuntimeId);
    runtime.node.addDependency(role);
    this.runtimeArn = runtime.attrAgentRuntimeArn;
    this.runtimeId = runtime.attrAgentRuntimeId;

    new CfnOutput(this, "RuntimeArn", { value: this.runtimeArn });
    new CfnOutput(this, "MemoryId", { value: this.memoryId });
  }
}
