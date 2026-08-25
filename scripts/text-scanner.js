export function findTemplateLiterals(source) {
    const literals = [];
    let cursor = 0;

    while (cursor < source.length) {
        const start = source.indexOf("`", cursor);
        if (start === -1) break;

        let end = start + 1;
        while (end < source.length) {
            if (source[end] === "\\") {
                end += 2;
                continue;
            }
            if (source[end] === "`") {
                end += 1;
                literals.push({
                    index: start,
                    literal: source.slice(start, end),
                });
                break;
            }
            end += 1;
        }

        if (end >= source.length && source[end - 1] !== "`") break;
        cursor = end;
    }

    return literals;
}
