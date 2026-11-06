/** Consume at most the stated limit, including requests without Content-Length. */
export async function readBoundedRequestBody(request: Request, limit: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel().catch(() => {})
        throw new Error('too-large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
