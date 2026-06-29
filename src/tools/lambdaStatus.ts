import { z } from "zod"
import { lambda, cloudwatch } from "../aws/client.js";
import { ListFunctionsCommand } from "@aws-sdk/client-lambda"
import { GetMetricStatisticsCommand } from "@aws-sdk/client-cloudwatch";

export const lambdaStatusSchema = z.object({
    hoursBack: z
        .number()
        .default(24)
        .describe("Number of hours to look back when counting Lambda errors."),
});

type lambdaStatusArgs = z.infer<typeof lambdaStatusSchema>

export async function lambdaStatus(args: lambdaStatusArgs) {
    const { hoursBack } = args;
    try {
        const endTime = new Date();
        const startTime = new Date(Date.now() - hoursBack * 3600_000);

        const res = await lambda.send(new ListFunctionsCommand({}));
        const functions = (res.Functions ?? []).slice(0, 20);
        const total = res.Functions?.length ?? 0;

        const statuses = await Promise.all(
            functions.map(async (fn) => {
                try {
                    const metric = await cloudwatch.send(
                        new GetMetricStatisticsCommand({
                            Namespace: "AWS/Lambda",
                            MetricName: "Errors",
                            Dimensions: [{ Name: "FunctionName", Value: fn.FunctionName! }],
                            StartTime: startTime,
                            EndTime: endTime,
                            Period: hoursBack * 3600,
                            Statistics: ["Sum"],
                        })
                    );
                    const errorCount =
                        metric.Datapoints?.reduce((sum, point) => sum + (point.Sum ?? 0), 0) ?? 0;
                    return { name: fn.FunctionName, runtime: fn.Runtime, lastModified: fn.LastModified, errorCount };
                } catch {
                    return { name: fn.FunctionName, runtime: fn.Runtime, lastModified: fn.LastModified, errorCount: "unavailable" };
                }
            })
        );

        const note = total > 20 ? `\n(showing 20 of ${total} functions)` : "";
        return {
            content: [{ type: "text" as const, text: JSON.stringify(statuses, null, 2) + note }],
        };
    } catch (err) {
        const code = (err as any).name ?? "UnknownError";
        const msg = err instanceof Error ? err.message : String(err);
        const hint = code.includes("AccessDenied")
            ? " — check lambda:ListFunctions and cloudwatch:GetMetricStatistics IAM permissions"
            : "";
        return {
            content: [{ type: "text" as const, text: `Error [${code}]: ${msg}${hint}` }],
        };
    }
}