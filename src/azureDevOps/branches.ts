import type { AzureDevOpsClient } from "./client.js";
import { repositoryPath, stripRefPrefix } from "./paths.js";
import type { AzureDevOpsRef, PageResult } from "../types.js";

export interface ListBranchesOptions {
  filter?: string;
  top?: number;
  continuationToken?: string;
}

export interface BranchSummary {
  name: string;
  fullName: string;
  objectId: string;
  creator?: AzureDevOpsRef["creator"];
  url?: string;
  isLocked?: boolean;
}

export async function listBranches(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  options: ListBranchesOptions = {}
): Promise<PageResult<BranchSummary>> {
  const filter = options.filter?.replace(/^refs\/heads\//, "") ?? "";
  const page = await client.getPage<AzureDevOpsRef>(repositoryPath(project, repositoryId, "refs"), {
    filter: `heads/${filter}`,
    ...(options.top !== undefined ? { "$top": options.top } : {}),
    ...(options.continuationToken ? { continuationToken: options.continuationToken } : {}),
    peelTags: false
  });

  return {
    ...page,
    items: page.items.map(normalizeBranch)
  };
}

export async function getBranch(client: AzureDevOpsClient, project: string, repositoryId: string, branchName: string): Promise<BranchSummary | null> {
  const page = await listBranches(client, project, repositoryId, {
    filter: branchName,
    top: 100
  });
  const normalized = branchName.replace(/^refs\/heads\//, "");
  return page.items.find((branch) => branch.name === normalized) ?? null;
}

function normalizeBranch(ref: AzureDevOpsRef): BranchSummary {
  return {
    name: stripRefPrefix(ref.name) ?? ref.name,
    fullName: ref.name,
    objectId: ref.objectId,
    ...(ref.creator ? { creator: ref.creator } : {}),
    ...(ref.url ? { url: ref.url } : {}),
    ...(ref.isLocked !== undefined ? { isLocked: ref.isLocked } : {})
  };
}
