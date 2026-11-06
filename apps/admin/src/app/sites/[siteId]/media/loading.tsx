import state from '../../../../components/state.module.css'
export default function MediaLibraryLoading() {
  return (
    <main className="wrap wrap-wide" aria-busy="true" aria-label="Loading media library">
      <div className={'media-loading media-loading-head ' + state.skeleton} />
      <div className={'media-loading media-loading-summary ' + state.skeleton} />
      <div className={'media-loading media-loading-browser ' + state.skeleton} />
    </main>
  )
}
