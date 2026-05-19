export function normalizeTaskPersonKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

export function buildTaskPersonKeys(person: string): string[] {
  const values = person
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)

  const keys = new Set<string>()
  values.forEach((value) => {
    const normalized = normalizeTaskPersonKey(value)
    if (!normalized) return

    keys.add(normalized)
    keys.add(normalized.replace(/\s+/g, ""))

    const emailLocal = normalized.includes("@") ? normalized.split("@")[0] : ""
    if (emailLocal) {
      keys.add(emailLocal)
      keys.add(emailLocal.replace(/[._-]+/g, " "))
      keys.add(emailLocal.replace(/[._\-\s]+/g, ""))
    }
  })

  return Array.from(keys).filter(Boolean).sort((a, b) => a.localeCompare(b, "ko"))
}

export function buildTaskPersonKeysFromValues(values: string[]): string[] {
  return Array.from(new Set(values.flatMap((value) => buildTaskPersonKeys(value)))).sort((a, b) =>
    a.localeCompare(b, "ko"),
  )
}
