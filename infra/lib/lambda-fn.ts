import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import { repoPath } from "./config.js";

export interface FnProps {
  entry: string; // repo-relative
  environment?: Record<string, string>;
  timeout?: Duration;
  memorySize?: number;
}

/** Uniform Node 22 / ARM64 / ESM Lambda with its own log group. */
export function nodeFn(scope: Construct, id: string, props: FnProps): NodejsFunction {
  const logGroup = new logs.LogGroup(scope, `${id}Logs`, { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY });
  return new NodejsFunction(scope, id, {
    entry: repoPath(props.entry),
    runtime: lambda.Runtime.NODEJS_22_X,
    architecture: lambda.Architecture.ARM_64,
    memorySize: props.memorySize ?? 512,
    timeout: props.timeout ?? Duration.seconds(30),
    logGroup,
    environment: { NODE_OPTIONS: "--enable-source-maps", ...props.environment },
    bundling: { format: OutputFormat.ESM, minify: true, sourceMap: true, target: "node22", mainFields: ["module", "main"], banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  });
}
