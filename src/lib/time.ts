/** Normalize a date input to an ISO string for API/storage helpers. */
export function toIsoUtc(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  return d.toISOString();
}

export function fromStoredDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (value.includes("T") || value.endsWith("Z")) return new Date(value);
  return new Date(value.replace(" ", "T") + "Z");
}
