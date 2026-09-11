import type { CreateTaskInput, CreateTaskResult } from "../../shared/task-creation";

export function createTaskSubmission<Task>(options: {
    create(input: CreateTaskInput): Promise<CreateTaskResult>;
    resolve(id: string): Promise<Task>;
}) {
    let created: CreateTaskResult | null = null;
    let pending: Promise<{ task: Task; result: CreateTaskResult }> | null = null;
    async function perform(input: CreateTaskInput) {
        created ??= await options.create(input);
        const task = await options.resolve(created.task.id);
        return { task, result: created };
    }
    return {
        get createdId() {
            return created?.task.id ?? "";
        },
        submit(input: CreateTaskInput) {
            if (!pending)
                pending = perform(input).finally(() => {
                    pending = null;
                });
            return pending;
        },
    };
}
