import type { TaskCacheEntry } from "./types";

const PROJECT_TYPE = "2";

export function isProjectTask(task: Pick<TaskCacheEntry, "identificationSource" | "taskType">): boolean {
    return task.identificationSource === "document" && task.taskType === PROJECT_TYPE;
}

export type ProjectMembershipRole = "project" | "action" | "stage" | "task";
export type ProjectMembershipEdgeSource = "parentId" | "childIds" | "root";
export type ProjectMembershipDiagnosticCode =
    | "childids-fallback-used"
    | "dangling-childids"
    | "conflicting-childids-parents"
    | "stale-childids-parent"
    | "orphan-effective-parent"
    | "self-parent"
    | "effective-parent-cycle"
    | "project-nesting";

export interface ProjectMembershipDiagnostic {
    code: ProjectMembershipDiagnosticCode;
    taskId: string;
    relatedIds: readonly string[];
}

export interface ProjectMembershipNode {
    readonly task: TaskCacheEntry;
    readonly role: ProjectMembershipRole;
    readonly effectiveParent: TaskCacheEntry | undefined;
    readonly effectiveParentId: string;
    readonly edgeSource: ProjectMembershipEdgeSource;
    readonly children: readonly TaskCacheEntry[];
    readonly ancestors: readonly TaskCacheEntry[];
    readonly project: TaskCacheEntry | undefined;
    readonly projectId: string;
    readonly nearestStage: TaskCacheEntry | undefined;
    readonly actions: readonly TaskCacheEntry[];
    readonly diagnostics: readonly ProjectMembershipDiagnostic[];
}

export interface ParentChangeInput {
    task: Pick<TaskCacheEntry, "blockId" | "identificationSource" | "taskType">;
    parentId: string;
}

export type ParentChangeAssessment =
    | { kind: "allowed"; resultingProjectId: string }
    | {
          kind: "rejected";
          reason: "project-cannot-have-parent" | "self-parent" | "circular-effective-parent" | "malformed-parent-chain";
          path: readonly string[];
      }
    | { kind: "incomplete"; missingTaskIds: readonly string[] };

export class ProjectMembershipGraphBuildError extends Error {
    constructor(
        readonly code: "empty-task-id" | "duplicate-task-id",
        readonly taskId: string,
    ) {
        super(`${code}: ${taskId}`);
        this.name = "ProjectMembershipGraphBuildError";
    }
}

export interface ProjectMembershipGraph {
    readonly diagnostics: readonly ProjectMembershipDiagnostic[];
    node(blockId: string): ProjectMembershipNode | undefined;
    assessParentChange(input: ParentChangeInput): ParentChangeAssessment;
}

const compareTasks = (left: TaskCacheEntry, right: TaskCacheEntry): number =>
    left.sort - right.sort || left.blockId.localeCompare(right.blockId);

class ImmutableProjectMembershipGraph implements ProjectMembershipGraph {
    readonly diagnostics: readonly ProjectMembershipDiagnostic[];

    private readonly taskById = new Map<string, TaskCacheEntry>();
    private readonly parentByChild = new Map<string, string>();
    private readonly edgeSourceByChild = new Map<string, Exclude<ProjectMembershipEdgeSource, "root">>();
    private readonly childrenByParent = new Map<string, readonly TaskCacheEntry[]>();
    private readonly diagnosticsByTask = new Map<string, readonly ProjectMembershipDiagnostic[]>();
    private readonly projectByTask = new Map<string, TaskCacheEntry>();
    private readonly nearestStageByTask = new Map<string, TaskCacheEntry>();
    private readonly actionsByProject = new Map<string, readonly TaskCacheEntry[]>();

    constructor(tasks: readonly TaskCacheEntry[]) {
        const diagnostics: ProjectMembershipDiagnostic[] = [];
        const diagnosticsByTask = new Map<string, ProjectMembershipDiagnostic[]>();
        const addDiagnostic = (
            code: ProjectMembershipDiagnosticCode,
            taskId: string,
            relatedIds: readonly string[] = [],
        ) => {
            const diagnostic: ProjectMembershipDiagnostic = Object.freeze({
                code,
                taskId,
                relatedIds: Object.freeze([...relatedIds]),
            });
            diagnostics.push(diagnostic);
            const entries = diagnosticsByTask.get(taskId) || [];
            entries.push(diagnostic);
            diagnosticsByTask.set(taskId, entries);
        };

        for (const task of tasks) {
            if (!task.blockId) throw new ProjectMembershipGraphBuildError("empty-task-id", task.blockId);
            if (this.taskById.has(task.blockId)) {
                throw new ProjectMembershipGraphBuildError("duplicate-task-id", task.blockId);
            }
            this.taskById.set(task.blockId, task);
        }

        const fallbackParentsByChild = new Map<string, Set<string>>();
        for (const parent of tasks) {
            for (const childId of parent.childIds || []) {
                const child = this.taskById.get(childId);
                if (!child) {
                    addDiagnostic("dangling-childids", parent.blockId, [childId]);
                    continue;
                }
                if (childId === parent.blockId) {
                    addDiagnostic("self-parent", childId, [parent.blockId]);
                    continue;
                }
                if (isProjectTask(child)) {
                    if (child.parentId !== parent.blockId) {
                        addDiagnostic("project-nesting", childId, [parent.blockId]);
                    }
                    continue;
                }
                const claims = fallbackParentsByChild.get(childId) || new Set<string>();
                claims.add(parent.blockId);
                fallbackParentsByChild.set(childId, claims);
            }
        }

        const fallbackBlocked = new Set<string>();
        for (const task of tasks) {
            if (isProjectTask(task)) {
                if (task.parentId) addDiagnostic("project-nesting", task.blockId, [task.parentId]);
                continue;
            }
            if (!task.parentId) continue;
            if (task.parentId === task.blockId) {
                addDiagnostic("self-parent", task.blockId, [task.parentId]);
                fallbackBlocked.add(task.blockId);
                continue;
            }
            if (!this.taskById.has(task.parentId)) {
                addDiagnostic("orphan-effective-parent", task.blockId, [task.parentId]);
                continue;
            }
            this.parentByChild.set(task.blockId, task.parentId);
            this.edgeSourceByChild.set(task.blockId, "parentId");
        }

        for (const task of tasks) {
            if (isProjectTask(task) || this.parentByChild.has(task.blockId) || fallbackBlocked.has(task.blockId)) {
                continue;
            }
            const fallbackParents = [...(fallbackParentsByChild.get(task.blockId) || [])].sort();
            if (fallbackParents.length === 1) {
                this.parentByChild.set(task.blockId, fallbackParents[0]);
                this.edgeSourceByChild.set(task.blockId, "childIds");
                addDiagnostic("childids-fallback-used", task.blockId, fallbackParents);
            } else if (fallbackParents.length > 1) {
                addDiagnostic("conflicting-childids-parents", task.blockId, fallbackParents);
            }
        }

        for (const [childId, fallbackParents] of fallbackParentsByChild) {
            const selectedParent = this.parentByChild.get(childId);
            if (!selectedParent || this.edgeSourceByChild.get(childId) !== "parentId") continue;
            const staleParents = [...fallbackParents].filter((parentId) => parentId !== selectedParent).sort();
            if (staleParents.length > 0) {
                addDiagnostic("stale-childids-parent", childId, [selectedParent, ...staleParents]);
            }
        }

        const processed = new Set<string>();
        for (const task of tasks) {
            if (processed.has(task.blockId)) continue;
            const path: string[] = [];
            const indexById = new Map<string, number>();
            let currentId = task.blockId;
            while (currentId && !processed.has(currentId) && !indexById.has(currentId)) {
                indexById.set(currentId, path.length);
                path.push(currentId);
                currentId = this.parentByChild.get(currentId) || "";
            }
            if (currentId && indexById.has(currentId)) {
                const cycle = path.slice(indexById.get(currentId));
                for (const cycleTaskId of cycle) {
                    addDiagnostic("effective-parent-cycle", cycleTaskId, cycle);
                    this.parentByChild.delete(cycleTaskId);
                    this.edgeSourceByChild.delete(cycleTaskId);
                }
            }
            for (const taskId of path) processed.add(taskId);
        }

        const mutableChildren = new Map<string, TaskCacheEntry[]>();
        for (const [childId, parentId] of this.parentByChild) {
            const child = this.taskById.get(childId);
            if (!child) continue;
            const children = mutableChildren.get(parentId) || [];
            children.push(child);
            mutableChildren.set(parentId, children);
        }
        for (const [parentId, children] of mutableChildren) {
            this.childrenByParent.set(parentId, Object.freeze(children.sort(compareTasks)));
        }

        const roots = tasks.filter((task) => !this.parentByChild.has(task.blockId)).sort(compareTasks);
        const visited = new Set<string>();
        const mutableActionsByProject = new Map<string, TaskCacheEntry[]>();
        for (const root of roots) {
            const stack: Array<{
                task: TaskCacheEntry;
                project: TaskCacheEntry | undefined;
                nearestStage: TaskCacheEntry | undefined;
            }> = [{ task: root, project: undefined, nearestStage: undefined }];
            while (stack.length > 0) {
                const current = stack.pop();
                if (!current || visited.has(current.task.blockId)) continue;
                visited.add(current.task.blockId);

                const currentProject = isProjectTask(current.task) ? current.task : current.project;
                if (currentProject) this.projectByTask.set(current.task.blockId, currentProject);
                if (current.nearestStage) this.nearestStageByTask.set(current.task.blockId, current.nearestStage);
                if (currentProject && !isProjectTask(current.task)) {
                    const actions = mutableActionsByProject.get(currentProject.blockId) || [];
                    actions.push(current.task);
                    mutableActionsByProject.set(currentProject.blockId, actions);
                }

                const nearestStageForChildren =
                    !isProjectTask(current.task) && current.task.actionKind === "stage"
                        ? current.task
                        : current.nearestStage;
                const children = this.childrenByParent.get(current.task.blockId) || [];
                for (let index = children.length - 1; index >= 0; index--) {
                    const child = children[index];
                    stack.push({
                        task: child,
                        project: isProjectTask(child) ? undefined : currentProject,
                        nearestStage: isProjectTask(child) ? undefined : nearestStageForChildren,
                    });
                }
            }
        }

        for (const [projectId, actions] of mutableActionsByProject) {
            this.actionsByProject.set(projectId, Object.freeze(actions));
        }
        for (const [taskId, entries] of diagnosticsByTask) {
            this.diagnosticsByTask.set(taskId, Object.freeze(entries));
        }
        this.diagnostics = Object.freeze(diagnostics);
    }

    node(blockId: string): ProjectMembershipNode | undefined {
        const task = this.taskById.get(blockId);
        if (!task) return undefined;
        const parentId = this.parentByChild.get(blockId) || "";
        const project = this.projectByTask.get(blockId);
        const graph = this;
        return Object.freeze({
            task,
            role: this.roleFor(task, project),
            effectiveParent: parentId ? this.taskById.get(parentId) : undefined,
            effectiveParentId: parentId,
            edgeSource: this.edgeSourceByChild.get(blockId) || "root",
            children: this.childrenByParent.get(blockId) || [],
            get ancestors() {
                return graph.collectAncestors(blockId);
            },
            project,
            projectId: project?.blockId || "",
            nearestStage: this.nearestStageByTask.get(blockId),
            actions: isProjectTask(task) ? this.actionsByProject.get(blockId) || [] : [],
            diagnostics: this.diagnosticsByTask.get(blockId) || [],
        });
    }

    assessParentChange(input: ParentChangeInput): ParentChangeAssessment {
        const { task, parentId } = input;
        if (!parentId) return { kind: "allowed", resultingProjectId: "" };
        if (parentId === task.blockId) {
            return { kind: "rejected", reason: "self-parent", path: [task.blockId] };
        }
        if (isProjectTask(task)) {
            return { kind: "rejected", reason: "project-cannot-have-parent", path: [task.blockId, parentId] };
        }

        const path = [task.blockId];
        const visited = new Set(path);
        let currentId = parentId;
        while (currentId) {
            if (visited.has(currentId)) {
                return { kind: "rejected", reason: "circular-effective-parent", path: [...path, currentId] };
            }
            visited.add(currentId);
            path.push(currentId);
            const current = this.taskById.get(currentId);
            if (!current) return { kind: "incomplete", missingTaskIds: [currentId] };
            if (isProjectTask(current)) return { kind: "allowed", resultingProjectId: current.blockId };

            const diagnostics = this.diagnosticsByTask.get(currentId) || [];
            const cycle = diagnostics.find((entry) => entry.code === "effective-parent-cycle");
            if (cycle) {
                return { kind: "rejected", reason: "malformed-parent-chain", path: [...path, ...cycle.relatedIds] };
            }
            if (diagnostics.some((entry) => entry.code === "self-parent")) {
                return { kind: "rejected", reason: "malformed-parent-chain", path };
            }
            const orphan = diagnostics.find((entry) => entry.code === "orphan-effective-parent");
            const nextParentId = this.parentByChild.get(currentId) || "";
            if (!nextParentId && orphan) return { kind: "incomplete", missingTaskIds: orphan.relatedIds };
            currentId = nextParentId;
        }
        return { kind: "allowed", resultingProjectId: "" };
    }

    private roleFor(task: TaskCacheEntry, project: TaskCacheEntry | undefined): ProjectMembershipRole {
        if (isProjectTask(task)) return "project";
        if (!project) return "task";
        return task.actionKind === "stage" ? "stage" : "action";
    }

    private collectAncestors(blockId: string): readonly TaskCacheEntry[] {
        const ancestors: TaskCacheEntry[] = [];
        const visited = new Set<string>([blockId]);
        let currentId = this.parentByChild.get(blockId) || "";
        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            const current = this.taskById.get(currentId);
            if (!current) break;
            ancestors.push(current);
            currentId = this.parentByChild.get(currentId) || "";
        }
        return ancestors;
    }
}

export function createProjectMembershipGraph(tasks: readonly TaskCacheEntry[]): ProjectMembershipGraph {
    return new ImmutableProjectMembershipGraph(tasks);
}
