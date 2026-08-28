import { Mutex } from "./mutex";
import {
    createDefaultProjectBoardPreferences,
    getProjectBoardPreference,
    normalizeProjectBoardPreferences,
    withProjectBoardPreference,
    type ProjectBoardPreference,
    type ProjectBoardPreferences,
} from "../shared/project-board-preferences";

const PROJECT_BOARD_PREFERENCES_PATH = "project-board-preferences.json";

interface ProjectBoardPreferenceStorageHost {
    storage: {
        get(path: string): Promise<{ json(): Promise<unknown> }>;
        put(path: string, value: string): Promise<unknown>;
    };
    logger?: { warn?: (message: string) => Promise<unknown> | unknown };
}

/** Versioned per-project board preferences, serialized through one kernel mutex. */
export class ProjectBoardPreferenceManager {
    private state: ProjectBoardPreferences = createDefaultProjectBoardPreferences();
    private loaded = false;
    private readonly mutex = new Mutex();

    constructor(private readonly siyuan: ProjectBoardPreferenceStorageHost) {}

    async load(): Promise<ProjectBoardPreferences> {
        const { promise } = this.mutex.acquire();
        const lock = await promise;
        try {
            if (this.loaded) return this.snapshot();
            let shouldPersist = false;
            try {
                const data = await this.siyuan.storage.get(PROJECT_BOARD_PREFERENCES_PATH);
                const raw = await data.json();
                this.state = normalizeProjectBoardPreferences(raw);
                shouldPersist = JSON.stringify(raw) !== JSON.stringify(this.state);
            } catch (_error) {
                this.state = createDefaultProjectBoardPreferences();
                shouldPersist = true;
            }
            if (shouldPersist) {
                try {
                    await this.persist();
                } catch (error) {
                    await this.siyuan.logger?.warn?.(
                        `ProjectBoardPreferenceManager: failed to repair preferences: ${error}`,
                    );
                }
            }
            this.loaded = true;
            return this.snapshot();
        } finally {
            lock.release();
        }
    }

    async get(): Promise<ProjectBoardPreferences> {
        if (!this.loaded) await this.load();
        return this.snapshot();
    }

    async update(projectId: string, preference: ProjectBoardPreference): Promise<ProjectBoardPreferences> {
        const { promise } = this.mutex.acquire();
        const lock = await promise;
        try {
            if (!this.loaded) {
                try {
                    const data = await this.siyuan.storage.get(PROJECT_BOARD_PREFERENCES_PATH);
                    this.state = normalizeProjectBoardPreferences(await data.json());
                } catch (_error) {
                    this.state = createDefaultProjectBoardPreferences();
                }
                this.loaded = true;
            }
            const previous = this.state;
            this.state = withProjectBoardPreference(previous, projectId, preference);
            try {
                await this.persist();
            } catch (error) {
                this.state = previous;
                throw error;
            }
            return this.snapshot();
        } finally {
            lock.release();
        }
    }

    private async persist(): Promise<void> {
        await this.siyuan.storage.put(PROJECT_BOARD_PREFERENCES_PATH, JSON.stringify(this.state));
    }

    private snapshot(): ProjectBoardPreferences {
        const projects = Object.fromEntries(
            Object.entries(this.state.projects).map(([id, preference]) => [
                id,
                getProjectBoardPreference(this.state, id),
            ]),
        );
        return { version: this.state.version, projects };
    }
}
