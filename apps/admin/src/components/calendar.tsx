'use client'
import type { ReactNode } from 'react'
import { calendarMonth } from '../lib/story-calendar.ts'
import styles from './calendar-styles.module.css'
/** Shared month grid: all seven days remain visible and keyboard reachable. */
export function Calendar({
  month,
  renderDay,
  onDropDay,
}: {
  month: string
  renderDay: (day: string) => ReactNode
  onDropDay?: (day: string, id: string) => void
}) {
  return (
    <div className={styles.calendar} role="group" aria-label="Story calendar">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
        <strong className={styles.calendarWeekday} key={day}>
          {day}
        </strong>
      ))}
      {calendarMonth(month).map((day, index) =>
        day ? (
          <div
            key={day}
            className={styles.calendarDay}
            onDragOver={
              onDropDay
                ? event => {
                    if (event.dataTransfer.types.includes('application/x-cms-story')) event.preventDefault()
                  }
                : undefined
            }
            onDrop={
              onDropDay
                ? event => {
                    event.preventDefault()
                    onDropDay(day, event.dataTransfer.getData('application/x-cms-story'))
                  }
                : undefined
            }
          >
            <time dateTime={day}>{Number(day.slice(-2))}</time>
            {renderDay(day)}
          </div>
        ) : (
          <div key={'blank-' + index} aria-hidden="true" />
        ),
      )}
    </div>
  )
}
