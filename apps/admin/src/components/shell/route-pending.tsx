/** A route can report its destination before the full workspace loads. */
export function RoutePending({ title, message }: { title: string; message: string }) {
  return (
    <main id="main" className="wrap wrap-wide" aria-busy="true">
      <h1>{title}</h1>
      <p role="status">{message}</p>
    </main>
  )
}
