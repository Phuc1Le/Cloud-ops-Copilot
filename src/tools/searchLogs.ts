import { FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { z } from "zod";
import { logs } from "../aws/client.js";

export const searchLogsSchema = z.object({
    logGroupName: z.string()
        .describe("CloudWatch log group name, e.g. '/aws/lambda/hello-world'"),
    filterPattern: z.string().optional()
        .describe("Optional CloudWatch Logs filter pattern, e.g. 'ERROR' or 'Exception'"),
    hoursBack: z
        .number()
        .default(1)
        .describe("Search this many hours into the past."),
})

type SearchLogsArgs = z.infer<typeof searchLogsSchema>;

export async function searchLogs(args: SearchLogsArgs) {
    const { logGroupName, filterPattern, hoursBack } = args;
    try {
        const startTime = Date.now() - hoursBack * 3600_000;

        const res = await logs.send(
            new FilterLogEventsCommand({
                logGroupName,
                filterPattern,
                startTime,
            })
        );

        const all = res.events ?? [];
        const events = all.slice(0, 50).map((event) => ({
            timestamp: event.timestamp
                ? new Date(event.timestamp).toISOString()
                : null,
            stream: event.logStreamName,
            message: event.message,
        }));

        if (events.length === 0) {
            return {
                content: [{ type: "text" as const, text: "No matching log events found." }],
            };
        }

        const note = all.length > 50 ? `\n(showing 50 of ${all.length} events)` : "";
        return {
            content: [{ type: "text" as const, text: JSON.stringify(events, null, 2) + note }],
        };
    } catch (err) {
        const code = (err as any).name ?? "UnknownError";
        const msg = err instanceof Error ? err.message : String(err);
        const hint = code.includes("AccessDenied")
            ? " — check logs:FilterLogEvents IAM permission"
            : code === "ResourceNotFoundException"
            ? ` — log group "${args.logGroupName}" not found; use list_log_groups to see available groups`
            : "";
        return {
            content: [{ type: "text" as const, text: `Error [${code}]: ${msg}${hint}` }],
        };
    }
}