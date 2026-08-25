import { buildProjectSummaries, type ProjectDomainOptions } from "./project-domain";
import type {
    ProjectControlProject,
    ProjectControlRisk,
    ProjectControlSelection,
    ProjectControlState,
    ProjectSummary,
    TaskCacheEntry,
} from "./types";

export interface ProjectControlOptions extends ProjectDomainOptions {
    selection?: Partial<ProjectControlSelection>;
}

function riskWeight(severity: ProjectControlRisk["severity"]): number {
    return severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}

function containsTask(summary: ProjectSummary, taskId: string): boolean {
    return summary.project.blockId === taskId || summary.descendants.some((task) => task.blockId === taskId);
}

function resolveProjectRisks(summary: ProjectSummary): ProjectControlRisk[] {
    return summary.risks.map((risk) => {
        const target = summary.descendants.find((task) => task.blockId === risk.taskId) || summary.project;
        return {
            ...risk,
            projectId: summary.project.blockId,
            targetKind: target.blockId === summary.project.blockId ? "project" : "action",
            target,
        };
    });
}

export function buildProjectControlState(
    tasks: TaskCacheEntry[],
    options: ProjectControlOptions = {},
): ProjectControlState {
    const summaries = buildProjectSummaries(tasks, options);
    const projects: ProjectControlProject[] = summaries.map((summary) => ({
        summary,
        risks: resolveProjectRisks(summary),
    }));
    const projectOrder = new Map(projects.map((project, index) => [project.summary.project.blockId, index]));
    const riskOrder = new Map<ProjectControlRisk, number>();
    const risks = projects.flatMap((project) => project.risks);
    risks.forEach((risk, index) => riskOrder.set(risk, index));
    risks.sort(
        (left, right) =>
            riskWeight(right.severity) - riskWeight(left.severity) ||
            (projectOrder.get(left.projectId) || 0) - (projectOrder.get(right.projectId) || 0) ||
            (riskOrder.get(left) || 0) - (riskOrder.get(right) || 0),
    );

    const requestedProjectId = options.selection?.projectId || "";
    const requestedTaskId = options.selection?.taskId || "";
    const requestedProject = projects.find((project) => project.summary.project.blockId === requestedProjectId);
    const taskProject = requestedTaskId
        ? projects.find((project) => containsTask(project.summary, requestedTaskId))
        : undefined;
    const selectedProject = requestedProject || taskProject || projects[0] || null;
    const selectedTask =
        selectedProject && requestedTaskId && containsTask(selectedProject.summary, requestedTaskId)
            ? tasks.find((task) => task.blockId === requestedTaskId) || null
            : null;

    return {
        tasks,
        projects,
        risks,
        selection: {
            projectId: selectedProject?.summary.project.blockId || "",
            taskId: selectedTask?.blockId || "",
        },
        selectedProject,
        selectedTask,
    };
}
