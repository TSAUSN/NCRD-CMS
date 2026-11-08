// The portable core uses Postgres and these contracts for provider services.
// Local implementations support a complete run without a provider account.

export type Clock = { now(): Date }

export type StoredObject = {
  objectKey: string
  bytes: number
  contentType: string
}

export type SignedUpload = {
  url: string
  /** Opaque database intent. Object keys never cross the browser boundary. */
  intentId: string
  /** Bearer capability is sent as a header so it does not leak through URLs. */
  headers: Readonly<Record<string, string>>
  expiresAt: Date
  maxBytes: number
  allowedContentTypes: readonly string[]
}

/** Object storage with immutable, content-addressed keys (SPEC §6.11). */
export type MediaStore = {
  createSignedUpload(input: {
    /** A server-recorded intent whose constraints the receiver will re-read. */
    intentId: string
    uploadToken: string
    expiresAt: Date
    maxBytes: number
    allowedContentTypes: readonly string[]
  }): Promise<SignedUpload>
  put(objectKey: string, body: Uint8Array, contentType: string): Promise<StoredObject>
  get(objectKey: string): Promise<Uint8Array | null>
  /** Application soft-delete first: S3 compatibility does not imply versioning. */
  remove(objectKey: string): Promise<void>
}

export type DnsRecord = {
  type: 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'CAA'
  name: string
  value: string
  action?: 'ADD' | 'REMOVE'
}
export type DomainState = 'pending_dns' | 'verifying' | 'issuing_cert' | 'live' | 'error'
export type DomainSite = { siteId: string; stagingHostname: string; providerRef: string | null }

/** One provider is chosen in M5; the contract and a fake exist from M0. */
export type DomainProvisioner = {
  requiredRecords(hostname: string, site?: DomainSite): Promise<DnsRecord[]>
  attach(hostname: string, siteId: string, site?: DomainSite): Promise<{ providerRef: string }>
  check(
    hostname: string,
    verification?: { name: string; value: string },
    site?: DomainSite,
  ): Promise<{ state: DomainState; errorCode?: string; errorDetail?: string }>
  detach(hostname: string, site?: DomainSite): Promise<void>
}

/** Consumes the transactional outbox; failure retries, it never loses a publish. */
export type CacheInvalidator = {
  invalidate(input: { siteId: string; paths: readonly string[]; revision: number }): Promise<void>
}

export type Mailer = {
  send(input: { to: string; subject: string; text: string; idempotencyKey?: string }): Promise<{ id: string }>
}

export type ScreenshotViewport = {
  /** Capture the section bounds rather than an empty document viewport. */
  cropToSection?: boolean
  width: number
  height: number
  /**
   * Device pixels per CSS pixel, so a card that wants a sharp image on a 2x
   * display asks for one here. Asking for a bigger viewport instead would get a
   * different layout, which is a different picture and not a sharper one.
   */
  deviceScaleFactor?: number
}

/**
 * Where the pixels came from.
 *
 * An implementation is allowed to have no browser — a machine with no Chromium,
 * a test that must not launch one — and it is not allowed to answer as though it
 * did. `placeholder` is how such an implementation says so, and it travels in
 * the result rather than being a property of the object, because the caller that
 * stores an image is rarely the code that chose the implementation. A fallback
 * whose output is indistinguishable from a render is how a library page ends up
 * full of grey rectangles that everyone believes are sections.
 */
export type ScreenshotFidelity =
  /** A browser laid the document out and this is what it looked like. */
  | 'rendered'
  /** No browser was available; these bytes stand in for a picture and are not one. */
  | 'placeholder'

export type Screenshot = {
  png: Uint8Array
  /** The PNG's own pixel dimensions, i.e. after `deviceScaleFactor`. */
  width: number
  height: number
  fidelity: ScreenshotFidelity
}

/**
 * One self-contained HTML document in, one PNG out (SPEC §6.5, D3).
 *
 * No URL, no navigation, no cookies, no storage, and nothing that says which
 * browser: a hosted rendering API satisfies this contract as readily as a local
 * Chromium, which is the point of it being a port at all. A document that needs
 * to fetch something to look right will be screenshotted without it, so the
 * caller is the one responsible for handing over a document that stands alone.
 */
export type Screenshotter = {
  capture(input: { html: string; viewport: ScreenshotViewport }): Promise<Screenshot>
}

export type Platform = {
  clock: Clock
  media: MediaStore
  domains: DomainProvisioner
  cache: CacheInvalidator
  mail: Mailer
  screenshots: Screenshotter
}
