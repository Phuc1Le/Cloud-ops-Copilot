import { z } from "zod"
import { iam } from "../aws/client.js"
import {
  ListUsersCommand,
  GetLoginProfileCommand,
  ListMFADevicesCommand,
  ListAttachedUserPoliciesCommand,
} from "@aws-sdk/client-iam";
export const iamAuditSchema = z.object({})
type iamAuditArgs = z.infer<typeof iamAuditSchema>
export async function iamAudit(_args: iamAuditArgs){
    try {
        const users = await iam.send(new ListUsersCommand({}));
        const enriched = await Promise.all(
            (users.Users ?? []).map(async (user) => {
                const [mfaRes, profileRes, policiesRes] = await Promise.allSettled([
                    iam.send(new ListMFADevicesCommand({ UserName: user.UserName })),
                    iam.send(new GetLoginProfileCommand({ UserName: user.UserName })),
                    iam.send(new ListAttachedUserPoliciesCommand({ UserName: user.UserName })),
                ]);
                return {
                    name: user.UserName,
                    createdDate: user.CreateDate,
                    lastUsed: user.PasswordLastUsed ?? null,
                    mfaEnabled: mfaRes.status === 'fulfilled' && (mfaRes.value.MFADevices?.length ?? 0) > 0,
                    hasConsoleAccess: profileRes.status === 'fulfilled',
                    attachedPolicies: policiesRes.status === 'fulfilled'
                        ? (policiesRes.value.AttachedPolicies ?? []).map(p => p.PolicyName)
                        : [],
                };
            })
        );
        return {
            content: [
                { type: "text" as const, text: JSON.stringify(enriched, null, 2) },
            ],
        };
    } catch (err) {
        const code = (err as any).name ?? "UnknownError";
        const msg = err instanceof Error ? err.message : String(err);
        const hint = code.includes("AccessDenied")
            ? " — check iam:ListUsers, iam:ListMFADevices, and iam:GetLoginProfile IAM permissions"
            : "";
        return {
            content: [{ type: "text" as const, text: `Error [${code}]: ${msg}${hint}` }],
        };
    }
}