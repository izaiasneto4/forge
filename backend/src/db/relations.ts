import { relations } from "drizzle-orm/relations";
import { reviewTasks, agentLogs, pullRequests, pullRequestSnapshots, reviewComments, reviewIterations } from "./schema";

export const agentLogsRelations = relations(agentLogs, ({one}) => ({
	reviewTask: one(reviewTasks, {
		fields: [agentLogs.reviewTaskId],
		references: [reviewTasks.id]
	}),
}));

export const reviewTasksRelations = relations(reviewTasks, ({one, many}) => ({
	agentLogs: many(agentLogs),
	reviewComments: many(reviewComments),
	reviewIterations: many(reviewIterations),
	pullRequest: one(pullRequests, {
		fields: [reviewTasks.pullRequestId],
		references: [pullRequests.id]
	}),
	pullRequestSnapshot: one(pullRequestSnapshots, {
		fields: [reviewTasks.pullRequestSnapshotId],
		references: [pullRequestSnapshots.id]
	}),
}));

export const pullRequestSnapshotsRelations = relations(pullRequestSnapshots, ({one, many}) => ({
	pullRequest: one(pullRequests, {
		fields: [pullRequestSnapshots.pullRequestId],
		references: [pullRequests.id]
	}),
	reviewTasks: many(reviewTasks),
}));

export const pullRequestsRelations = relations(pullRequests, ({many}) => ({
	pullRequestSnapshots: many(pullRequestSnapshots),
	reviewTasks: many(reviewTasks),
}));

export const reviewCommentsRelations = relations(reviewComments, ({one}) => ({
	reviewTask: one(reviewTasks, {
		fields: [reviewComments.reviewTaskId],
		references: [reviewTasks.id]
	}),
}));

export const reviewIterationsRelations = relations(reviewIterations, ({one}) => ({
	reviewTask: one(reviewTasks, {
		fields: [reviewIterations.reviewTaskId],
		references: [reviewTasks.id]
	}),
}));