import { Workbench } from '../../components/ui/index.ts'
import reviewWorkbenchStyles from '../../components/workspace-styles/review-workbench.module.css'
export default function LoadingReviews() {
  return (
    <main id="main">
      <Workbench
        queueLabel="Review requests"
        storageKey="cms.reviews.queue-width"
        queue={
          <div className={reviewWorkbenchStyles.queueHeading}>
            <h1>Reviews</h1>
            <p>Changes people sent you to approve</p>
          </div>
        }
      >
        <p role="status">Loading reviews… Your saved changes are safe.</p>
      </Workbench>
    </main>
  )
}
