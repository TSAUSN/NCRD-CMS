export function sectionVersionKey(id: string, version: number): string {
  return `${id}:${version}`
}

export function pinnedSectionCatalog<T extends { section_def_id: string; version: number }>(
  latest: T[],
  pinned: T[],
  known?: ReadonlyMap<string, T>,
): Map<string, T> {
  return new Map([
    ...(known?.entries() ?? []),
    ...[...latest, ...pinned].map(entry => [sectionVersionKey(entry.section_def_id, entry.version), entry] as const),
  ])
}

export function hasTrustedSectionTemplate(
  sections: { section_def_id: string; section_def_version: number }[],
  catalog: ReadonlyMap<string, { carries_trusted_code: boolean }>,
): boolean {
  return sections.some(
    section =>
      catalog.get(sectionVersionKey(section.section_def_id, section.section_def_version))?.carries_trusted_code ===
      true,
  )
}
