import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

/**
 * AgentCore creates /aws/bedrock-agentcore/runtimes/{runtimeId}-DEFAULT on the first invocation with no retention.
 * LogRetention sets (or creates) the group with a one-month policy, so runtime logs stop accumulating forever.
 */
export function retainRuntimeLogs(scope: Construct, id: string, runtimeId: string): void {
  new logs.LogRetention(scope, id, { logGroupName: `/aws/bedrock-agentcore/runtimes/${runtimeId}-DEFAULT`, retention: logs.RetentionDays.ONE_MONTH });
}
