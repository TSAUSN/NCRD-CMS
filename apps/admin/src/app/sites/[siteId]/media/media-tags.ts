export function normalizedTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map(tag => tag.trim().toLocaleLowerCase())
        .filter(Boolean),
    ),
  ].sort()
}
