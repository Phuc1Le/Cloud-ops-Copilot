import { z } from "zod";
import { costExplorer } from "../aws/client.js";

import { GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";

export const costSummarySchema = z.object({
    granularity: z
        .enum(["MONTHLY", "DAILY"])
        .default("MONTHLY")
        .describe(
        "Group costs by month or by day for the current billing period."
        ),
});

type CostSummaryArgs = z.infer<typeof costSummarySchema>;

export async function costSummary(args: CostSummaryArgs) {
    const { granularity } = args;
    try {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now);
        end.setDate(end.getDate() + 1);

        const formatDate = (date: Date) => date.toISOString().split("T")[0];

        const res = await costExplorer.send(
            new GetCostAndUsageCommand({
                TimePeriod: { Start: formatDate(start), End: formatDate(end) },
                Granularity: granularity,
                Metrics: ["UnblendedCost"],
                GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
            })
        );

        const results = res.ResultsByTime ?? [];

        if (granularity === "MONTHLY") {
            const costs: Record<string, number> = {};
            for (const group of results[0]?.Groups ?? []) {
                const service = group.Keys?.[0] ?? "Unknown";
                const amount = Number(group.Metrics?.UnblendedCost?.Amount ?? 0);
                if (amount > 0) costs[service] = amount;
            }
            return {
                content: [{ type: "text" as const, text: JSON.stringify(costs, null, 2) }],
            };
        }

        // DAILY
        const dailyCosts = results.slice(0, 31).map((day) => {
            const services: Record<string, number> = {};
            for (const group of day.Groups ?? []) {
                const service = group.Keys?.[0] ?? "Unknown";
                const amount = Number(group.Metrics?.UnblendedCost?.Amount ?? 0);
                if (amount > 0) services[service] = amount;
            }
            return { date: day.TimePeriod?.Start, services };
        });

        return {
            content: [{ type: "text" as const, text: JSON.stringify(dailyCosts, null, 2) }],
        };
    } catch (err) {
        const code = (err as any).name ?? "UnknownError";
        const msg = err instanceof Error ? err.message : String(err);
        const hint = code.includes("AccessDenied")
            ? " — check ce:GetCostAndUsage IAM permission"
            : code.includes("OptInRequired") || code.includes("NotSubscribed")
            ? " — Cost Explorer must be enabled first: go to AWS Billing console → Cost Explorer → Enable"
            : "";
        return {
            content: [{ type: "text" as const, text: `Error [${code}]: ${msg}${hint}` }],
        };
    }
}