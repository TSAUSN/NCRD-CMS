import { PREVIEW_MESSAGE } from '@cms/renderer/preview-messages'
import { reportPreviewFonts } from './isolated-font-check.ts'
import { reportFramePreviewSize } from './report-frame-preview-size.ts'
import { revealPreviewArea } from './preview-scroll.ts'
/** Runs before reviewed site scripts, exclusively in an isolated canvas. */
const token = document.documentElement.getAttribute('data-cms-ticket')
if (token && /^[a-f0-9]{64}$/.test(token)) {
  if (new URLSearchParams(location.search).get('fonts') === '1')
    window.addEventListener('load', () => void reportPreviewFonts(), { once: true })
  const prefix = `/__cms/read/${token}`
  let paths: string[] = []
  try {
    const value = JSON.parse(document.documentElement.getAttribute('data-cms-resource-paths') ?? '[]')
    if (
      Array.isArray(value) &&
      value.length <= 2000 &&
      value.every(
        path => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && path.length <= 2048,
      )
    )
      paths = value
  } catch {
    /* No authored code is read. */
  }
  const originalPath = document.documentElement.getAttribute('data-cms-page-path') ?? '/'
  const base =
    originalPath.startsWith('/') && !originalPath.startsWith('//')
      ? new URL(originalPath, location.origin)
      : new URL('/', location.origin)
  const resource = (value: string | URL) => {
    const url = new URL(String(value), paths.length ? base : location.href)
    return url.origin === location.origin &&
      (/^\/(?:media|assets|site-files)\//.test(url.pathname) || paths.includes(url.pathname))
      ? prefix + url.pathname + url.search + url.hash
      : String(value)
  }
  // Native resource setters can load before a node is attached (new Image,
  // lazy loaders, carousel clones). Rewrite before the browser starts delivery;
  // every resulting request still needs a frozen own-ticket reference.
  const safelyResource = (value: string) => {
    try {
      return resource(value)
    } catch {
      return value
    }
  }
  const srcset = (value: string) =>
    value.replace(/(^|,)(\s*)([^\s,]+)(?=\s|,|$)/g, (_all, comma, spaces, url) => comma + spaces + safelyResource(url))
  for (const [prototype, keys] of [
    [HTMLImageElement.prototype, ['src', 'srcset']],
    [HTMLSourceElement.prototype, ['src', 'srcset']],
    [HTMLScriptElement.prototype, ['src']],
    [HTMLLinkElement.prototype, ['href']],
    [HTMLMediaElement.prototype, ['src']],
    [HTMLVideoElement.prototype, ['poster']],
  ] as const) {
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, key)
      if (!descriptor?.set || !descriptor.configurable) continue
      Object.defineProperty(prototype, key, {
        ...descriptor,
        set(value: string) {
          descriptor.set!.call(this, key === 'srcset' ? srcset(String(value)) : safelyResource(String(value)))
        },
      })
    }
  }
  const setAttribute = Element.prototype.setAttribute
  Element.prototype.setAttribute = function (name: string, value: string) {
    const key = name.toLowerCase()
    const tag = this.tagName.toLowerCase()
    const network =
      (key === 'src' && ['img', 'source', 'script', 'video', 'audio'].includes(tag)) ||
      (key === 'poster' && tag === 'video') ||
      (key === 'href' && tag === 'link')
    return setAttribute.call(
      this,
      name,
      key === 'srcset' && ['img', 'source'].includes(tag)
        ? srcset(String(value))
        : network || ['data-src', 'data-url', 'data-background'].includes(key)
          ? safelyResource(String(value))
          : value,
    )
  }
  const fetchOriginal = window.fetch.bind(window)
  window.fetch = (input, init) => {
    if (input instanceof Request) {
      const url = resource(input.url)
      return fetchOriginal(url === input.url ? input : new Request(url, input), init)
    }
    return fetchOriginal(resource(input), init)
  }
  const open = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async: boolean = true,
    username?: string | null,
    password?: string | null,
  ) {
    return open.call(this, method, resource(url), async, username, password)
  }
  const interval = window.setInterval.bind(window)
  const timeout = window.setTimeout.bind(window)
  const clear = window.clearTimeout.bind(window)
  const raf = window.requestAnimationFrame.bind(window)
  let paused = false
  let initializing = true
  let siteCallback = false
  let editingCode = false
  const runSite = (callback: () => void) => {
    const previous = siteCallback
    siteCallback = true
    try {
      callback()
    } finally {
      siteCallback = previous
    }
  }
  const pending = new Map<number, () => void>()
  window.setInterval = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    const site = !editingCode && (initializing || siteCallback)
    return interval(
      typeof callback === 'function' && site
        ? () => {
            if (!paused) runSite(() => callback(...args))
          }
        : callback,
      delay,
      ...(!site ? args : []),
    )
  }) as typeof window.setInterval
  window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (typeof callback !== 'function' || editingCode || (!initializing && !siteCallback))
      return timeout(callback, delay, ...args)
    let id = 0
    id = timeout(() => {
      if (paused) pending.set(id, () => runSite(() => callback(...args)))
      else runSite(() => callback(...args))
    }, delay)
    return id
  }) as typeof window.setTimeout
  window.clearTimeout = ((id?: number) => {
    if (id !== undefined) pending.delete(id)
    clear(id)
  }) as typeof window.clearTimeout
  window.clearInterval = window.clearTimeout
  const clock = Object.freeze({
    timeout,
    interval,
    raf,
    finishSiteInitialization() {
      initializing = false
    },
    editor<T>(callback: () => T): T {
      const previous = editingCode
      editingCode = true
      try {
        return callback()
      } finally {
        editingCode = previous
      }
    },
    pause(value: boolean) {
      paused = value
      document.documentElement.toggleAttribute('data-cms-interactions-paused', value)
      if (!value) {
        const callbacks = [...pending.values()]
        pending.clear()
        for (const callback of callbacks) timeout(callback, 0)
      }
    },
  })
  Object.defineProperty(window, '__cmsCanvasClock', { value: clock })
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => timeout(() => clock.finishSiteInitialization(), 0), {
      once: true,
    })
  else clock.finishSiteInitialization()
  // Read-only Site look uses an owned fragment to reveal the real footer.
  // No parent reads or writes a site document across origins.
  if (new URL(location.href).searchParams.get('visit') === '1') {
    const reveal = () => {
      if (location.hash === '#cms-preview-footer') {
        revealPreviewArea(document, window, 'footer')
        reportFramePreviewSize(document, window)
      } else if (location.hash === '#cms-preview-header') {
        revealPreviewArea(document, window, 'header')
        reportFramePreviewSize(document, window, 'header')
      }
    }
    // A cross-origin frame can be throttled before it is revealed. DOM
    // readiness, not a paint callback or every image finishing, opens it.
    const ready = () => {
      reveal()
      void document.fonts.ready.then(reveal)
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true })
    else ready()
    const parentOrigin = document.documentElement.getAttribute('data-cms-parent-origin')
    const channel = document.documentElement.getAttribute('data-cms-channel')
    if (parentOrigin && channel && window.parent !== window)
      window.addEventListener('message', event => {
        if (
          event.source === window.parent &&
          event.origin === parentOrigin &&
          event.data?.type === PREVIEW_MESSAGE.requestFrameSize &&
          event.data.channel === channel
        )
          reveal()
      })
    window.addEventListener('load', reveal, { once: true })
    window.addEventListener('hashchange', reveal)
    window.addEventListener('resize', () => raf(reveal))
  }
  // Pause on the first field selection, before another carousel timer can move
  // the clicked words. Ordinary navigation/menu interaction keeps running.
  document.addEventListener(
    'pointerdown',
    event => {
      const target = event.target as Element | null
      if (target?.closest('[data-cms-slot]')) clock.pause(true)
    },
    true,
  )
}
export {}
