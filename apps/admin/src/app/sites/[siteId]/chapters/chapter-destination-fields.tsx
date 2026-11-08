import { chapterDestinationLabel, chapterUsesLinkedPage, type ChapterSetup } from '@cms/schema'
import { Field } from '../../../../components/ui/field.tsx'
import workspace from '../../../../components/workspace.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'

/** Where visitors go, and the address required for a chapter hosted elsewhere. */
export function ChapterDestinationFields({
  currentDestination,
  externalUrl,
  onDestination,
  onAddress,
}: {
  currentDestination: ChapterSetup['destination']
  externalUrl: ChapterSetup['externalUrl']
  onDestination: (destination: ChapterSetup['destination']) => void
  onAddress: (address: string) => void
}) {
  const divisionPage = currentDestination === 'division'
  return (
    <>
      <div role="radiogroup" aria-labelledby="chapter-destination-label" className={workspace.denseStack}>
        <strong id="chapter-destination-label">Where does this chapter send visitors?</strong>
        <div className={selectionControlsStyles.choiceRows}>
          {(['page', 'division', 'external', 'unlisted'] as const).map(destination => (
            <label key={destination}>
              <input
                type="radio"
                name="chapter-destination"
                aria-label={chapterDestinationLabel(destination)}
                checked={currentDestination === destination}
                onChange={() => onDestination(destination)}
              />
              <span>
                <strong>{chapterDestinationLabel(destination)}</strong>
                <br />
                <span className={recordTableStyles.meta}>
                  {destination === 'page'
                    ? 'A page on this site, from the chapter template.'
                    : destination === 'division'
                      ? 'A page on a Salvation Army division site. Their division keeps it up to date.'
                      : destination === 'external'
                        ? 'Outside The Salvation Army’s sites.'
                        : 'Not listed until it is ready.'}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>
      {chapterUsesLinkedPage(currentDestination) && (
        <Field
          density="compact"
          id="chapter-website"
          label={divisionPage ? 'Page address' : 'Chapter website'}
          help="Use the full https address."
          required
        >
          <input type="url" value={externalUrl ?? ''} onChange={event => onAddress(event.target.value)} />
        </Field>
      )}
    </>
  )
}
