export interface JiraIssue {
  key: string;
  title: string;
  body: string;
  issueType?: string;
}

export interface JiraIssueDraft {
  summary: string;
  description: string;
  issueType?: string;
}

export interface JiraCreatedIssue {
  id: string;
  key: string;
  url: string;
}
