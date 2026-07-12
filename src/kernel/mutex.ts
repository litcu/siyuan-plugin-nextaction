export class Mutex {
    private queue: (() => void)[] = [];
    private locked = false;
    private _acquiredCount = 0;

    acquire(): { promise: Promise<{ release: () => void }>; cancel: () => void } {
        if (!this.locked) {
            this.locked = true;
            this._acquiredCount++;
            return {
                promise: Promise.resolve({ release: () => this._release() }),
                cancel: () => {}, // nothing to cancel, already acquired
            };
        }
        let queuedFn: (() => void) | null = null;
        const promise = new Promise<{ release: () => void }>((resolve) => {
            queuedFn = () => {
                this._acquiredCount++;
                resolve({ release: () => this._release() });
            };
            this.queue.push(queuedFn!);
        });
        return {
            promise,
            cancel: () => {
                if (queuedFn) {
                    const idx = this.queue.indexOf(queuedFn);
                    if (idx !== -1) {
                        this.queue.splice(idx, 1);
                    }
                    queuedFn = null;
                }
            },
        };
    }

    private _release(): void {
        if (this._acquiredCount > 0) {
            this._acquiredCount--;
        }
        if (this._acquiredCount > 0) return;

        if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            next();
        } else {
            this.locked = false;
        }
    }

    /**
     * Legacy compatibility: acquire without release handle.
     * Callers MUST call release() exactly once.
     */
    async acquireLegacy(): Promise<void> {
        if (!this.locked) {
            this.locked = true;
            this._acquiredCount++;
            return;
        }
        return new Promise<void>((resolve) => {
            this.queue.push(() => {
                this._acquiredCount++;
                resolve();
            });
        });
    }

    release(): void {
        this._release();
    }
}
