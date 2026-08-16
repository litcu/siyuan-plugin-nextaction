export function escapeSqlLiteral(value: string): string {
    return value.replace(/'/g, "''");
}

/** Every interpolation is encoded as a quoted SQL literal. */
export function sql(strings: TemplateStringsArray, ...values: readonly unknown[]): string {
    let result = strings[0];
    for (let index = 0; index < values.length; index++) {
        result += `'${escapeSqlLiteral(String(values[index]))}'${strings[index + 1]}`;
    }
    return result;
}
