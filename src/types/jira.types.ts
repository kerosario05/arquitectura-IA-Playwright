export type RawJiraIssue = {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: AdfDocument | string | null;
    status?: { name: string };
    issuetype?: { name: string };
    priority?: { name: string };
    [key: string]: unknown;
  };
};

export type AdfDocument = {
  type: "doc";
  version: number;
  content?: AdfNode[];
};

export type AdfNode = {
  type: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string }>;
};

export type JiraSearchResult = {
  issues: RawJiraIssue[];
  nextPageToken?: string;
  // legacy fields (v2 API)
  total?: number;
  startAt?: number;
  maxResults?: number;
};

export type RequiredJiraRuntimeConfig = {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey?: string;
  acceptanceCriteriaField: string;
  defaultJql?: string;
};

export type JiraProject = {
  id: string;
  key: string;
  name: string;
  projectTypeKey?: string;
};

export type JiraBoard = {
  id: number;
  name: string;
  type: "scrum" | "kanban" | string;
  location?: {
    projectId?: number;
    projectKey?: string;
    projectName?: string;
  };
};

export type JiraSprint = {
  id: number;
  name: string;
  state: "active" | "future" | "closed";
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  originBoardId?: number;
};
