import { EC2Client } from "@aws-sdk/client-ec2";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { CostExplorerClient } from "@aws-sdk/client-cost-explorer";
const region = process.env.AWS_REGION ?? "us-east-1";
// The SDK automatically picks up the AWS_PROFILE env var, or falls back
// to the default credential chain. No keys in code.
export const ec2 = new EC2Client({ region });
export const logs = new CloudWatchLogsClient({ region });
export const lambda = new LambdaClient({ region });
export const cloudwatch = new CloudWatchClient({ region });
export const costExplorer = new CostExplorerClient({ region:"us-east-1" })