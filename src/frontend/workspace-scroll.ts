import { get } from "svelte/store";
import { useWorkspace } from "./workspace-context";

/** 用稳定的视图/区域标识保存滚动，不依赖列表项的 DOM 顺序。 */
export function useWorkspaceScroll() {
    const session = useWorkspace()?.session;
    return (node: HTMLElement, region: string) => {
        const view = session ? get(session).activeView : "";
        let key = `${view}:scroll:${region}`;
        let frame = 0;
        let restoring = false;
        const save = () => {
            if (!restoring) session?.remember(key, { top: node.scrollTop, left: node.scrollLeft });
        };
        const restore = () => {
            cancelAnimationFrame(frame);
            restoring = true;
            frame = requestAnimationFrame(() => {
                const saved = session?.read(key, { top: 0, left: 0 });
                if (saved) {
                    node.scrollTop = saved.top;
                    node.scrollLeft = saved.left;
                }
                restoring = false;
            });
        };
        node.addEventListener("scroll", save, { passive: true });
        restore();
        return {
            update(next: string) {
                if (next === region) return;
                save();
                region = next;
                key = `${view}:scroll:${region}`;
                restore();
            },
            destroy() {
                cancelAnimationFrame(frame);
                node.removeEventListener("scroll", save);
            },
        };
    };
}
