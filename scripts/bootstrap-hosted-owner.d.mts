export function bootstrapHostedOwner(
  client: { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> },
  email: string,
  displayName: string,
): Promise<{ status: 'initialized' | 'already-initialized'; userId: string }>
