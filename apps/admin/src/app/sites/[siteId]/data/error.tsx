'use client'
import { EmptyState, Button, ButtonLink } from '../../../../components/ui/index.ts'
import shared from '../../../../components/workspace.module.css'
export default function NumbersError({ retry }: { retry: () => void }) {
  return (
    <main id="main" className={'wrap ' + shared.page}>
      <h1>Data values</h1>
      <EmptyState title="Saved numbers could not be loaded">
        <p>
          Try again, or return to your work. If you just saved a number, check the saved list before trying the save
          again.
        </p>
        <div className="button-row">
          <Button onClick={() => retry()}>Try again</Button>
          <ButtonLink href="/" variant="secondary">
            Back to your work
          </ButtonLink>
        </div>
      </EmptyState>
    </main>
  )
}
