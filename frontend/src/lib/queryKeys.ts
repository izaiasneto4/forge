export const queryKeys = {
  bootstrap: ['bootstrap'] as const,
  pullRequestBoard: ['pull_request_board'] as const,
  reviewTaskBoard: ['review_task_board'] as const,
  reviewTaskDetailRoot: ['review_task_detail'] as const,
  repositories: ['repositories'] as const,
  settings: ['settings'] as const,
  reviewTaskDetail: (id: string) => ['review_task_detail', id] as const,
}
