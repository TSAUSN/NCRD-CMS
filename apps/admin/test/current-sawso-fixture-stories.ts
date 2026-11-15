import { sawsoStoryRows } from '@cms/seeds/sawso-stories'
import type { TestDatabase } from '@cms/schema/testing'

/** The approved source remains verbatim; expected coverage follows its UTC window. */
export async function currentSawsoFixtureStories(db: TestDatabase) {
  const { today, cutoff } = await db.as(
    'owner',
    async client =>
      (
        await client.query(
          "SELECT to_char((statement_timestamp() AT TIME ZONE 'UTC')::date,'YYYY-MM-DD') AS today,to_char(((statement_timestamp() AT TIME ZONE 'UTC')::date-interval '13 months')::date,'YYYY-MM-DD') AS cutoff",
        )
      ).rows[0]!,
  )
  return sawsoStoryRows().filter(row => row.values.published_date >= cutoff && row.values.published_date <= today)
}
