'use client'
import { Workbench, EmptyState, Button, ButtonLink } from '../../components/ui/index.ts'
import styles from '../../components/workspace.module.css'
export default function ReviewsError({ retry }: { retry: () => void }) {
  return (
    <main id="main">
      <Workbench
        queueLabel="Review requests"
        storageKey="cms.reviews.queue-width"
        queue={
          <div className={styles.queueHeading}>
            <h1>Reviews</h1>
            <p>Changes people sent you to approve</p>
          </div>
        }
      >
        <EmptyState title="Reviews could not be loaded">
          <p>
            The review list is unavailable. Try again, or return to your work. If you just made a decision, check its
            status before trying again.
          </p>
          <div className={styles.actions}>
            <Button onClick={() => retry()}>Try again</Button>
            <ButtonLink variant="secondary" href="/">
              Back to your work
            </ButtonLink>
          </div>
        </EmptyState>
      </Workbench>
    </main>
  )
}
