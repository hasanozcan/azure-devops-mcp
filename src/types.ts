export type AzureDevOpsAuthMode = "pat" | "azcli";

export interface AzureDevOpsConfig {
  organization: string;
  baseUrl: string;
  apiVersion: string;
  authMode: AzureDevOpsAuthMode;
  pat?: string;
  defaultProject?: string;
  userAgent: string;
  requestTimeoutMs: number;
  retryCount: number;
  writeToolsEnabled: boolean;
  maxDiffFileBytes: number;
  maxDiffLines: number;
}

export interface AppConfig {
  azureDevOps: AzureDevOpsConfig;
}

export interface IdentityRef {
  id?: string;
  displayName?: string;
  uniqueName?: string;
  imageUrl?: string;
  url?: string;
}

export interface AzureDevOpsProject {
  id: string;
  name: string;
  description?: string;
  url?: string;
  state?: string;
  revision?: number;
  visibility?: string;
  lastUpdateTime?: string;
}

export interface AzureDevOpsRepository {
  id: string;
  name: string;
  url?: string;
  project?: Pick<AzureDevOpsProject, "id" | "name">;
  defaultBranch?: string;
  size?: number;
  remoteUrl?: string;
  sshUrl?: string;
  webUrl?: string;
  isDisabled?: boolean;
  isInMaintenance?: boolean;
}

export interface AzureDevOpsRef {
  name: string;
  objectId: string;
  creator?: IdentityRef;
  url?: string;
  isLocked?: boolean;
}

export interface GitCommitRef {
  commitId: string;
  comment?: string;
  url?: string;
  author?: GitUserDate;
  committer?: GitUserDate;
  changeCounts?: Record<string, number>;
  remoteUrl?: string;
}

export interface GitUserDate {
  name?: string;
  email?: string;
  date?: string;
  imageUrl?: string;
}

export interface PullRequestReviewer extends IdentityRef {
  vote?: number;
  isRequired?: boolean;
  hasDeclined?: boolean;
  isFlagged?: boolean;
}

export interface AzureDevOpsPullRequest {
  pullRequestId: number;
  artifactId?: string;
  codeReviewId?: number;
  status: string;
  title: string;
  description?: string;
  creationDate?: string;
  closedDate?: string;
  createdBy?: IdentityRef;
  sourceRefName: string;
  targetRefName: string;
  mergeStatus?: string;
  isDraft?: boolean;
  url?: string;
  repository: AzureDevOpsRepository;
  reviewers?: PullRequestReviewer[];
  commits?: GitCommitRef[];
  workItemRefs?: ResourceRef[];
  lastMergeSourceCommit?: GitCommitRef;
  lastMergeTargetCommit?: GitCommitRef;
  lastMergeCommit?: GitCommitRef;
}

export interface ResourceRef {
  id: string;
  url?: string;
}

export interface PullRequestIteration {
  id: number;
  description?: string;
  author?: IdentityRef;
  createdDate?: string;
  updatedDate?: string;
  sourceRefCommit?: GitCommitRef;
  targetRefCommit?: GitCommitRef;
  commonRefCommit?: GitCommitRef;
  hasMoreCommits?: boolean;
}

export interface GitItem {
  objectId?: string;
  originalObjectId?: string;
  gitObjectType?: string;
  commitId?: string;
  path: string;
  isFolder?: boolean;
  url?: string;
}

export interface PullRequestChange {
  changeId?: number;
  changeTrackingId: number;
  changeType: string;
  item: GitItem;
  originalPath?: string;
}

export interface PullRequestIterationChanges {
  changeEntries: PullRequestChange[];
  nextSkip?: number;
  nextTop?: number;
}

export type CommentThreadStatus = "unknown" | "active" | "fixed" | "wontFix" | "closed" | "byDesign" | "pending";

export interface PullRequestComment {
  id?: number;
  parentCommentId?: number;
  content: string;
  author?: IdentityRef;
  commentType?: string;
  publishedDate?: string;
  lastUpdatedDate?: string;
  isDeleted?: boolean;
}

export interface CommentPosition {
  line: number;
  offset: number;
}

export interface PullRequestThread {
  id?: number;
  status?: CommentThreadStatus;
  comments?: PullRequestComment[];
  threadContext?: {
    filePath?: string;
    leftFileStart?: CommentPosition;
    leftFileEnd?: CommentPosition;
    rightFileStart?: CommentPosition;
    rightFileEnd?: CommentPosition;
  };
  pullRequestThreadContext?: {
    changeTrackingId?: number;
    iterationContext?: {
      firstComparingIteration: number;
      secondComparingIteration: number;
    };
  };
  publishedDate?: string;
  lastUpdatedDate?: string;
  isDeleted?: boolean;
}

export interface AzureDevOpsListResponse<T> {
  count?: number;
  value: T[];
}

export interface PageResult<T> {
  items: T[];
  count: number;
  continuationToken?: string;
}

export type QueryValue = string | number | boolean | undefined;
export type QueryParams = Record<string, QueryValue>;

export interface FileDiffResult {
  path: string;
  originalPath?: string;
  changeType: string;
  changeTrackingId: number;
  oldCommitId: string;
  newCommitId: string;
  additions: number;
  deletions: number;
  oldLineCount: number;
  newLineCount: number;
  binary: boolean;
  tooLarge: boolean;
  patch: string | null;
  message?: string;
}

export interface PullRequestDiffBundle {
  project: string;
  repositoryId: string;
  pullRequestId: number;
  iterationId: number;
  baseCommitId: string;
  sourceCommitId: string;
  files: FileDiffResult[];
  totalFiles: number;
  processedFiles: number;
  additions: number;
  deletions: number;
  binaryFiles: number;
  oversizedFiles: number;
  truncated: boolean;
}

export type PullRequestVote = "approve" | "approveWithSuggestions" | "noVote" | "waitForAuthor" | "reject";
