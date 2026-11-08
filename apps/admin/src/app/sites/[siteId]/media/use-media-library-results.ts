import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  fetchMediaLibrary,
  MediaRequestError,
  type MediaAsset,
  type MediaLibraryResult,
} from '../../../../lib/media-library.ts'
import { DEFAULT_MEDIA_LIBRARY_QUERY } from '../../../../lib/media-library-defaults.ts'

export function useMediaLibraryResults(
  siteId: string,
  initial: MediaLibraryResult,
  setSelectedId: Dispatch<SetStateAction<string | null>>,
) {
  const [result, setResult] = useState(initial)
  const [query, setQuery] = useState(DEFAULT_MEDIA_LIBRARY_QUERY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSequence = useRef(0)
  const activeQuery = useRef(query)

  useEffect(() => {
    // Server rendering has already loaded the initial page.
    if (activeQuery.current === query) return
    activeQuery.current = query
    const sequence = ++requestSequence.current
    setLoading(true)
    fetchMediaLibrary(siteId, query)
      .then(next => {
        if (sequence !== requestSequence.current) return
        setResult(next)
        setSelectedId(current => (next.assets.some(asset => asset.id === current) ? current : null))
      })
      .catch(reason => {
        if (sequence === requestSequence.current)
          setError(reason instanceof MediaRequestError ? reason.message : 'The media library could not be refreshed.')
      })
      .finally(() => {
        if (sequence === requestSequence.current) setLoading(false)
      })
  }, [query, siteId, setSelectedId])

  async function refresh() {
    const sequence = ++requestSequence.current
    try {
      const next = await fetchMediaLibrary(siteId, activeQuery.current)
      if (sequence === requestSequence.current) setResult(next)
      return next
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }

  function rememberAssets(assets: MediaAsset[]) {
    const changed = new Map(assets.map(asset => [asset.id, asset]))
    setResult(current => ({
      ...current,
      assets: current.assets.map(asset => changed.get(asset.id) ?? asset),
    }))
  }

  return { result, query, setQuery, loading, setLoading, error, setError, refresh, rememberAssets }
}
