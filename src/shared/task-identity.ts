export type TaskIdentificationSource = "document" | "native";

export interface TaskHostIdentity {
    blockId: string;
    identificationSource: TaskIdentificationSource;
    attrHostId: string;
    contentBlockId?: string;
    structuralParentId: string;
    effectiveParentId: string;
    taskType: "1" | "2";
    defaultStatus: string;
    title: string;
    sort: number;
    updated: string;
}

export interface NativeTaskStructure {
    type: string;
    subtype: string;
    parentType?: string;
    parentSubtype?: string;
}

/** A native task may be marked on the item itself or inherited from its direct list. */
export function isNativeTaskStructure(structure: NativeTaskStructure): boolean {
    return (
        structure.type === "i" &&
        (structure.subtype === "t" || (structure.parentType === "l" && structure.parentSubtype === "t"))
    );
}

export function resolveEffectiveTaskParent(explicitParentId: string | undefined, structuralParentId: string): string {
    return explicitParentId || structuralParentId;
}

export function nativeTaskDefaultStatus(markdown: string): "inbox" | "done" {
    const marker = markdown.match(/\[(.)\]/s)?.[1] || " ";
    return marker === " " ? "inbox" : "done";
}
