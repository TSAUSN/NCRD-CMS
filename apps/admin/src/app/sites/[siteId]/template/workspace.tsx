'use client'
import { GuardedLink as Link } from '../../../../components/guarded-link.tsx'
import { Button, Card, PageHeader, Note } from '../../../../components/ui/index.ts'
import { IconLock, IconCheck } from '../../../../components/icons.tsx'
import styles from '../../../../components/workspace.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import siteSummaryStyles from '../../../../components/workspace-styles/site-summary.module.css'
import { useNationalTemplate, type NationalTemplateProps } from './use-national-template.ts'
import { TemplateReviewDialog } from './template-review-dialog.tsx'
import { TemplateStartDialog } from './template-start-dialog.tsx'

const shared = [
  ['Colours and buttons', 'National red, navy and button styles'],
  ['Approved fonts', 'Fonts from the Adobe Fonts kit'],
  ['Header and footer design', 'Floating header, navy footer'],
  ['Page rule', 'All content sits in a white box on the grey page'],
  ['Hover and motion', 'Tile outline, hero chevrons, reduced motion'],
  ['Shared sections', 'Hero, cards, tiles, stories, FAQ, contact and more'],
]
const own = [
  ['Logo', 'Each site uploads its own'],
  ['Heading font', 'Chosen from the approved fonts'],
  ['Menu', 'Each site builds its own'],
  ['Footer text and links', 'Each site writes its own'],
  ['Pages and content', 'Words, photos and stories'],
  ['Tags', 'Each site names its own'],
]

export function NationalTemplateWorkspace(props: NationalTemplateProps) {
  const { siteId } = props
  const model = useNationalTemplate(props)
  const { sites, notice, open, startSite, review } = model
  return (
    <>
      <PageHeader
        density="compact"
        showWayfinding={false}
        title="National template"
        lede="The one design SAWSO and Echelon share. Change it here and it can be rolled out to both."
        actions={
          <>
            <Button variant={sites.length ? 'secondary' : 'primary'} onClick={startSite}>
              Start a site from this
            </Button>
            {!!sites.length && <Button onClick={review}>Review an update</Button>}
          </>
        }
      />
      <Note icon={<IconLock size={16} />}>
        Only Super admins see this screen. Editors never change the template, so sites stay matched to the national
        look.
      </Note>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <div className={styles.threeColumns}>
        <Card density="summary" title="Sites using it">
          {!sites.length && <p>No sites use this template yet. Start a site from this to add one.</p>}
          <ul className={siteSummaryStyles.rowList}>
            {sites.map(site => (
              <li key={site.id}>
                <div className={recordTableStyles.rowCopy}>
                  <Link href={'/sites/' + site.id}>{site.name}</Link>
                </div>
                <span className="muted">
                  {!site.connected
                    ? 'Ready to connect'
                    : site.themeChanged || site.changedPages.length
                      ? 'Update waiting'
                      : 'Up to date'}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted">
            Sites brought in with their own design, like Better Together 2027, don't use this template.
          </p>
        </Card>
        <Card density="summary" title="Comes from the template">
          <p className="muted">The same on every site.</p>
          <ul className={siteSummaryStyles.rowList}>
            {shared.map(([title, text]) => (
              <li key={title}>
                <IconLock size={14} />
                <div className={recordTableStyles.rowCopy}>
                  <strong>
                    {title === 'Shared sections' ? <Link href={'/sites/' + siteId + '/sections'}>{title}</Link> : title}
                  </strong>
                  <span className="muted">{text}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card density="summary" title="Each site sets its own">
          <p className="muted">Editors with the right role can change these.</p>
          <ul className={siteSummaryStyles.rowList}>
            {own.map(([title, text]) => (
              <li key={title}>
                <IconCheck size={14} />
                <div className={recordTableStyles.rowCopy}>
                  <strong>{title}</strong>
                  <span className="muted">{text}</span>
                </div>
              </li>
            ))}
          </ul>
          <p>Sites may change their colours</p>
          <p className="muted">
            {sites.some(site => site.mayChangeColours)
              ? 'Allowed only on sites with that permission.'
              : 'Off for these sites.'}
          </p>
        </Card>
      </div>

      {open === 'review' && <TemplateReviewDialog model={model} />}
      {open === 'start' && <TemplateStartDialog model={model} />}
    </>
  )
}
