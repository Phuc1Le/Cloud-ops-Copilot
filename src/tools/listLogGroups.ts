import { DescribeLogGroupsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { z } from "zod";
import { logs } from "../aws/client.js";
export const listLogGroupsSchema = z.object({});

type ListLogGroupsArgs = z.infer<typeof listLogGroupsSchema>;

export async function listLogGroups(_args: ListLogGroupsArgs) {
    try {
        const res = await logs.send(new DescribeLogGroupsCommand({}));

        const all = res.logGroups ?? [];
        const groups = all.slice(0, 100).map((g) => ({ name: g.logGroupName }));
        const note = all.length > 100 ? `\n(showing 100 of ${all.length} log groups)` : "";

        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify(groups, null, 2) + note,
                },
            ],
        };
    } catch (err) {
        const code = (err as any).name ?? "UnknownError";
        const msg = err instanceof Error ? err.message : String(err);
        const hint = code.includes("AccessDenied") ? " — check logs:DescribeLogGroups IAM permission" : "";
        return {
            content: [{ type: "text" as const, text: `Error [${code}]: ${msg}${hint}` }],
        };
    }
}