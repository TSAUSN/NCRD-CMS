'use client'
import { useEffect, useRef, useState } from 'react'
import { Dialog, Button, EmptyState } from '../../../components/ui/index.ts'
import { ScriptlessPreview } from '../../../components/scriptless-preview.tsx'
import type { ReplacementOption } from './section-replacement-actions.ts'
import styles from './layout-chooser.module.css'
export function LayoutChooser({
  options,
  error,
  onClose,
  onChoose,
}: {
  options: ReplacementOption[] | null
  error: string | null
  onClose: () => void
  onChoose: (option: ReplacementOption) => void
}) {
  const [others, setOthers] = useState(false)
  const [search, setSearch] = useState('')
  const shown =
    options?.filter(
      option =>
        (others || !option.notCarried.length) &&
        option.definition.name.toLowerCase().includes(search.trim().toLowerCase()),
    ) ?? []
  return (
    <Dialog title="Choose a layout" size="wide" onClose={onClose}>
      <p>See your section's content in each layout. Nothing changes until you review and apply.</p>
      <label htmlFor="layout-search">Find a layout</label>
      <input id="layout-search" type="search" value={search} onChange={event => setSearch(event.target.value)} />
      {error ? (
        <p role="alert">{error}</p>
      ) : !options ? (
        <p role="status">Finding layouts that work with this content…</p>
      ) : (
        <>
          {options.some(option => option.notCarried.length) && (
            <Button variant="tertiary" aria-pressed={others} onClick={() => setOthers(current => !current)}>
              {others ? 'Show compatible layouts' : 'Show other layouts'}
            </Button>
          )}
          <div className={styles.grid}>
            {shown.map(option => (
              <article className={styles.card} key={option.definition.section_def_id}>
                <MiniPreview html={option.html} name={option.definition.name} />
                <div className={styles.body}>
                  <h3>{option.definition.name}</h3>
                  {option.notCarried.length > 0 && (
                    <p className="warn-inline">
                      {option.notCarried.join(', ')} will not appear in this layout. Your earlier content stays in
                      history.
                    </p>
                  )}
                  <Button variant="secondary" onClick={() => onChoose(option)}>
                    Review {option.definition.name}
                  </Button>
                </div>
              </article>
            ))}
          </div>
          {!shown.length && (
            <EmptyState title="No matching layouts">
              <p>
                {search
                  ? 'Try a different name.'
                  : options.length
                    ? 'No other layout keeps every field. Choose Show other layouts to review the available choices and what each leaves out.'
                    : 'This content needs its current layout. You can add a different section alongside it.'}
              </p>
            </EmptyState>
          )}
        </>
      )}
    </Dialog>
  )
}
function MiniPreview({ html, name }: { html: string; name: string }) {
  const host = useRef<HTMLDivElement>(null),
    frame = useRef<HTMLIFrameElement>(null)
  const [width, setWidth] = useState(320),
    [height, setHeight] = useState(240)
  useEffect(() => {
    if (!host.current) return
    const observer = new ResizeObserver(() => setWidth(host.current?.clientWidth ?? 320))
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const body = frame.current?.contentDocument?.body
    if (!body) return
    const observer = new ResizeObserver(() => setHeight(body.getBoundingClientRect().height))
    observer.observe(body)
    return () => observer.disconnect()
  }, [height, html])
  const scale = width / 768
  return (
    <div ref={host} className={styles.preview} style={{ height: Math.min(height * scale, 240) }}>
      <ScriptlessPreview
        ref={frame}
        title={name + ' with your content'}
        srcDoc={html}
        tabIndex={-1}
        className={styles.frame}
        style={{ width: 768, height, transform: `scale(${scale})` }}
        onLoad={event => setHeight(event.currentTarget.contentDocument?.body.getBoundingClientRect().height ?? 240)}
      />
    </div>
  )
}
