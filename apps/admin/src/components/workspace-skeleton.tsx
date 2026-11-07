import shared from './workspace.module.css'
import ownedStyles from './workspace-skeleton-styles.module.css'
import state from './state.module.css'
/** The same quiet content placeholders inside the route's normal workspace shell. */
export function WorkspaceSkeleton({ title, message }: { title: string; message: string }) {
  return (
    <main id="main" className={'wrap wrap-wide ' + shared.page} aria-busy="true">
      <h1>{title}</h1>
      <p role="status">{message}</p>
      <div className={ownedStyles.skeletonRows} aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className={state.skeleton} />
        ))}
      </div>
    </main>
  )
}
