export function referenceArea(name: string): string
export function withoutFunctionBodies(list: string): string
export function referenceFiles(
  connectionString: string,
  options?: { localTestPort?: string },
): Promise<Map<string, string>>
export function staleReference(files: Map<string, string>, directory: string): string[]
