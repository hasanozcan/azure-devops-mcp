import type { AzureDevOpsClient } from "./client.js";
import type { IdentityRef } from "../types.js";

interface ConnectionData {
  authenticatedUser?: IdentityRef;
  authorizedUser?: IdentityRef;
  instanceId?: string;
  deploymentId?: string;
}

export async function getConnectionData(client: AzureDevOpsClient): Promise<ConnectionData> {
  return client.get<ConnectionData>("_apis/connectionData", {
    connectOptions: 1,
    lastChangeId: -1,
    lastChangeId64: -1,
    "api-version": "7.1-preview.1"
  });
}

export async function getCurrentIdentity(client: AzureDevOpsClient): Promise<IdentityRef & { id: string }> {
  const connectionData = await getConnectionData(client);
  const identity = connectionData.authenticatedUser ?? connectionData.authorizedUser;
  if (!identity?.id) {
    throw new Error("Azure DevOps did not return an authenticated identity ID");
  }
  return { ...identity, id: identity.id };
}
