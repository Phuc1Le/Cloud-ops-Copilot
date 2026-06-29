import { DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { z } from "zod";
import { ec2 } from "../aws/client.js";

export const listEc2Schema = z.object({
    stateFilter: z.string().optional()
    .describe('Optional EC2 state filter, e.g. "running" or "stopped"'),
})
type ListEc2Args = z.infer<typeof listEc2Schema>;
export async function listEc2(args: ListEc2Args) {
    const { stateFilter } = args;
    try {
        const res = await ec2.send(new DescribeInstancesCommand({}));

        const instances = (res.Reservations ?? []).flatMap((r) =>
            (r.Instances ?? []).map((i) => ({
                id: i.InstanceId,
                type: i.InstanceType,
                state: i.State?.Name,
                launchTime: i.LaunchTime,
                name: i.Tags?.find((t) => t.Key === "Name")?.Value ?? "(no name)",
            }))
        );

        const filtered = stateFilter
            ? instances.filter((i) => i.state === stateFilter)
            : instances;

        const capped = filtered.slice(0, 100);
        const note = filtered.length > 100 ? `\n(showing 100 of ${filtered.length} instances)` : "";

        return {
            content: [
                { type: "text" as const, text: JSON.stringify(capped, null, 2) + note },
            ],
        };
    } catch (err) {
        const code = (err as any).name ?? "UnknownError";
        const msg = err instanceof Error ? err.message : String(err);
        const hint = code.includes("AccessDenied") ? " — check ec2:DescribeInstances IAM permission" : "";
        return {
            content: [{ type: "text" as const, text: `Error [${code}]: ${msg}${hint}` }],
        };
    }
}