import { Duration } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import type * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";

/** Alarm that notifies the operator topic; missing data is fine (nothing ran). */
export function notifyOn(scope: Construct, id: string, metric: cloudwatch.IMetric, topic: sns.ITopic, description: string, threshold = 1, evaluationPeriods = 1): cloudwatch.Alarm {
  const alarm = new cloudwatch.Alarm(scope, id, {
    metric,
    threshold,
    evaluationPeriods,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    alarmDescription: description,
  });
  alarm.addAlarmAction(new cwActions.SnsAction(topic));
  return alarm;
}

export function lambdaErrorsAlarm(scope: Construct, id: string, fn: lambda.IFunction, topic: sns.ITopic, description: string): cloudwatch.Alarm {
  return notifyOn(scope, id, fn.metricErrors({ period: Duration.minutes(5), statistic: "Sum" }), topic, description);
}
