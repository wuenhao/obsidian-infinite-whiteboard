/** A board name must remain a single cross-platform file name. */
export function normalizedBoardName(value: string): string | null {
  const name = value.trim().replace(/\.board$/i, "").trim();
  if (!name || /[\\/:*?"<>|]/.test(name)) return null;
  return name;
}
