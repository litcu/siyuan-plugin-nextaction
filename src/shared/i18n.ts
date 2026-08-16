export type I18nResource = typeof import("../i18n/en.json");
export type I18nKey = keyof I18nResource;
export type I18nStrings = { [Key in I18nKey]: string };

/**
 * Narrow SiYuan's open-ended plugin translation record at the application
 * boundary. The runtime key-set test guarantees that both bundled resources
 * contain every key represented by I18nStrings.
 */
export function asI18nStrings(value: Record<string, string>): I18nStrings {
    return value as I18nStrings;
}
