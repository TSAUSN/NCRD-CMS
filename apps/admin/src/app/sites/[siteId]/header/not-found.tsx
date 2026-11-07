'use client'
import { useParams } from 'next/navigation'
import { ButtonLink, Card, PageHeader } from '../../../../components/ui/index.ts'
import styles from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
export default function HeaderUnavailable() {
  const params = useParams<{ siteId: string }>(),
    site = typeof params.siteId === 'string' ? '/sites/' + params.siteId : '/sites'
  return (
    <main id="main" className={'wrap ' + styles.page + ' ' + workspaceFormsStyles.readableForm}>
      <PageHeader showWayfinding={false} title="Header & menu is unavailable" />
      <Card>
        <p>
          This screen is available to Site admins and Super admins. Return to the site to continue editing, or ask a
          Site admin for help.
        </p>
        <div className={workspaceFormsStyles.actions}>
          <ButtonLink href={site}>Return to the site</ButtonLink>
          <ButtonLink variant="secondary" href="/">
            Home
          </ButtonLink>
        </div>
      </Card>
    </main>
  )
}
