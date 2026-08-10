import type { AzureDevOpsClient } from "./client.js";
import { encodePathSegment } from "./client.js";
import { getWorkItemsBatch, type WorkItem, type WorkItemReference } from "./workItems.js";
import type { AzureDevOpsListResponse, IdentityRef } from "../types.js";

export interface TeamIteration {
  id: string;
  name: string;
  path?: string;
  url?: string;
  attributes?: { startDate?: string; finishDate?: string; timeFrame?: string };
}

export interface IterationWorkItems {
  workItemRelations?: Array<{ source?: WorkItemReference | null; target?: WorkItemReference | null; rel?: string }>;
  url?: string;
}

export interface TeamMemberCapacity {
  teamMember?: IdentityRef;
  activities?: Array<{ name?: string; capacityPerDay?: number }>;
  daysOff?: Array<{ start?: string; end?: string }>;
  url?: string;
}

export async function listTeamIterations(
  client: AzureDevOpsClient,
  project: string,
  team: string | undefined,
  timeframe?: "current" | "past" | "future"
): Promise<TeamIteration[]> {
  const response = await client.get<AzureDevOpsListResponse<TeamIteration>>(teamWorkPath(project, team, "teamsettings/iterations"), {
    ...(timeframe ? { $timeframe: timeframe } : {}),
    "api-version": "7.1"
  });
  return response.value ?? [];
}

export async function getIterationWorkItems(
  client: AzureDevOpsClient,
  project: string,
  team: string | undefined,
  iterationId: string
): Promise<{ relations: IterationWorkItems["workItemRelations"]; workItems: WorkItem[] }> {
  const response = await client.get<IterationWorkItems>(teamWorkPath(project, team, `teamsettings/iterations/${encodePathSegment(iterationId)}/workitems`), {
    "api-version": "7.1"
  });
  const relations = response.workItemRelations ?? [];
  const ids = [...new Set(relations.flatMap((relation) => [relation.source?.id, relation.target?.id]).filter((id): id is number => Number.isInteger(id) && Number(id) > 0))];
  return { relations, workItems: await getWorkItemsBatch(client, ids) };
}

export async function getTeamCapacity(
  client: AzureDevOpsClient,
  project: string,
  team: string | undefined,
  iterationId: string
): Promise<TeamMemberCapacity[]> {
  const response = await client.get<AzureDevOpsListResponse<TeamMemberCapacity>>(
    teamWorkPath(project, team, `teamsettings/iterations/${encodePathSegment(iterationId)}/capacities`),
    { "api-version": "7.1" }
  );
  return response.value ?? [];
}

export async function getIterationVelocity(
  client: AzureDevOpsClient,
  project: string,
  team: string | undefined,
  iterationId: string,
  options: { pointsField?: string; completedStates?: string[] } = {}
): Promise<{
  pointsField: string;
  completedStates: string[];
  totalItems: number;
  completedItems: number;
  totalPoints: number;
  completedPoints: number;
  completionPercent: number;
  workItems: WorkItem[];
}> {
  const pointsField = options.pointsField ?? "Microsoft.VSTS.Scheduling.StoryPoints";
  const completedStates = options.completedStates ?? ["Done", "Closed", "Completed"];
  const response = await client.get<IterationWorkItems>(teamWorkPath(project, team, `teamsettings/iterations/${encodePathSegment(iterationId)}/workitems`), {
    "api-version": "7.1"
  });
  const ids = [...new Set((response.workItemRelations ?? []).flatMap((relation) => [relation.target?.id]).filter((id): id is number => Number.isInteger(id) && Number(id) > 0))];
  const workItems = await getWorkItemsBatch(client, ids, ["System.Id", "System.Title", "System.State", "System.WorkItemType", pointsField]);
  const completedSet = new Set(completedStates.map((state) => state.toLowerCase()));
  let totalPoints = 0;
  let completedPoints = 0;
  let completedItems = 0;
  for (const item of workItems) {
    const points = numericField(item.fields?.[pointsField]);
    totalPoints += points;
    if (completedSet.has(String(item.fields?.["System.State"] ?? "").toLowerCase())) {
      completedItems += 1;
      completedPoints += points;
    }
  }
  return {
    pointsField,
    completedStates,
    totalItems: workItems.length,
    completedItems,
    totalPoints,
    completedPoints,
    completionPercent: totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 10_000) / 100 : workItems.length > 0 ? Math.round((completedItems / workItems.length) * 10_000) / 100 : 0,
    workItems
  };
}

export async function reorderBacklogWorkItems(
  client: AzureDevOpsClient,
  project: string,
  team: string | undefined,
  options: { ids: number[]; iterationPath?: string; nextId?: number; previousId?: number; parentId?: number }
): Promise<unknown> {
  return client.patch<unknown>(
    teamWorkPath(project, team, "workitemsorder"),
    {
      ids: [...new Set(options.ids)],
      ...(options.iterationPath ? { iterationPath: options.iterationPath } : {}),
      ...(options.nextId !== undefined ? { nextId: options.nextId } : {}),
      ...(options.previousId !== undefined ? { previousId: options.previousId } : {}),
      ...(options.parentId !== undefined ? { parentId: options.parentId } : {})
    },
    { "api-version": "7.1" }
  );
}

function teamWorkPath(project: string, team: string | undefined, suffix: string): string {
  const prefix = team
    ? `${encodePathSegment(project)}/${encodePathSegment(team)}`
    : encodePathSegment(project);
  return `${prefix}/_apis/work/${suffix.replace(/^\/+/, "")}`;
}

function numericField(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}
