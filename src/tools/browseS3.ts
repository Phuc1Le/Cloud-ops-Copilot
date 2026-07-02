import { z } from "zod";
import { s3 } from "../aws/client.js"
import {
    ListBucketsCommand,
    ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import type { ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";
export const browseS3Schema = z.object({
    bucketName: z.string().optional().describe(
        "Bucket to browse. If omitted, list all buckets."
    ),
    prefix: z.string().optional().describe(
        "Optional object prefix (folder-like path)."
    ),
    maxItems: z.number().int().positive().max(500).default(50)
        .describe("Maximum number of objects to return.")
});

type browseS3Args = z.infer<typeof browseS3Schema>

export async function browseS3(args: browseS3Args){
    const { bucketName, prefix, maxItems } = args
    try {
        if(!bucketName){
            const response = await s3.send(
                new ListBucketsCommand({})
            )
            const buckets = response.Buckets?.map(b => ({
                name: b.Name,
                createdAt: b.CreationDate
            })) ?? [];
            return {
                content: [
                    { type: "text" as const, text: JSON.stringify(buckets, null, 2) },
                ],
            };
        }
        else{
            const objects: {
                key: string | undefined;
                size: number | undefined;
                lastModified: Date | undefined;
                storageClass: string | undefined;
            }[] = [];
            let continuationToken: string | undefined = undefined;
            while (objects.length < maxItems) {
                const response: ListObjectsV2CommandOutput = await s3.send(
                    new ListObjectsV2Command({
                        Bucket: bucketName,
                        Prefix: prefix,
                        MaxKeys: Math.min(maxItems - objects.length, 1000),
                        ContinuationToken: continuationToken
                    })
                );
                for (const o of response.Contents ?? []) {
                    objects.push({
                        key: o.Key,
                        size: o.Size,
                        lastModified: o.LastModified,
                        storageClass: o.StorageClass
                    });
                }
                if (!response.NextContinuationToken) break;
                continuationToken = response.NextContinuationToken;
            }
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                bucket: bucketName,
                                prefix: prefix ?? "",
                                objectCount: objects.length,
                                objects
                            },
                            null,
                            2
                        ),
                    },
                ],
            };
        }
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