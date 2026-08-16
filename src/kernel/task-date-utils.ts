export function addLocalDays(dateString: string, days: number): string {
    const date = new Date(dateString + "T00:00:00");
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
