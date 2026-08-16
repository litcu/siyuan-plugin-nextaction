export const RPC_METHOD_NAMES = [
    "echo", "convertToTask", "convertToTaskWithChildren", "removeTask", "updateTask",
    "setRepeatRule", "skipRepeatOccurrence", "setRepeatPaused", "getTask", "getNextActions",
    "getAllTasks", "getCompletedTasksPage", "getTasksByParent", "recalcAllOrders", "rebuildCache",
    "getDoneTaskCount", "getContexts", "getTags", "rebuildParentRelationships", "getProjectReminders",
    "reorderTask", "getStatistics", "updateSettings", "getSettings", "validateAiProposal",
    "applyAiProposal", "getMcpStatus", "listMcpTargetNotebooks", "listMcpTargetDocuments",
    "searchMcpTargetDocuments", "resolveMcpDocumentTarget", "resolveChildTarget", "createTask",
    "getCustomFieldDiagnostics", "purgeCustomField", "purgeOrphanCustomField", "getMyDay",
    "addTaskToMyDay", "removeTaskFromMyDay", "reorderMyDayTask", "setMyDaySchedule",
    "removeMyDaySchedule", "getReviewData", "completeReview", "markTaskReviewed",
] as const;

export type RpcMethodName = typeof RPC_METHOD_NAMES[number];
