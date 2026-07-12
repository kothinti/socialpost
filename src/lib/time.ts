/** Store timestamps in SQLite-friendly UTC: "YYYY-MM-DD HH:MM:SS" */
export function toSqliteUtc(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

export function fromSqliteUtc(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (value.includes("T") || value.endsWith("Z")) return new Date(value);
  return new Date(value.replace(" ", "T") + "Z");
}
