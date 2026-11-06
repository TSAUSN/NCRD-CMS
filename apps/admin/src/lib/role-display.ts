/** Display wording only. Stored roles and their permission checks stay unchanged. */
export function roleDisplayName(role: string): string {
  const labels: Record<string, string> = {
    super_admin: 'Super admin',
    admin: 'Admin',
    site_admin: 'Admin',
    editor: 'Site editor',
    contributor: 'Content creator',
  }
  const words = role.replace(/_/g, ' ')
  return labels[role] ?? words.charAt(0).toUpperCase() + words.slice(1)
}
