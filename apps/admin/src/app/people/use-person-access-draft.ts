import { useId, useLayoutEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useBrowserSetup } from '../../components/use-browser-setup.ts'
import type { NavigationGuardState } from '../../lib/navigation-guard.ts'
import type { PersonRow, SiteAssignment } from '../../lib/people.ts'
import { addPerson, invitePerson, updatePerson, type PeopleResult } from './actions.ts'

export type AccessSite = { id: string; name: string; archived: boolean }
export type PersonEditorProps = {
  person: PersonRow | null
  sites: AccessSite[]
  currentUserId: string
  invitationsEnabled: boolean
  leaveRef: { current: () => NavigationGuardState }
  onCancel: () => void
  onSaved: (message: string) => void
  onBusy: (busy: boolean) => void
}

export function usePersonAccessDraft({
  person,
  sites,
  currentUserId,
  invitationsEnabled,
  leaveRef,
  onSaved,
  onBusy,
}: PersonEditorProps) {
  const router = useRouter()
  const formId = useId()
  const [result, setResult] = useState<PeopleResult | null>(null)
  const [pending, startTransition] = useTransition()
  const inFlight = useRef(false)
  const [confirm, setConfirm] = useState(false)
  const initial = {
    name: person?.display_name ?? '',
    email: person?.email ?? '',
    status: person?.status ?? 'active',
    memberships: person?.memberships ?? [],
    revision: person?.revision ?? '0',
  }
  const setup = useBrowserSetup({
    storageKey: 'cms.people-access.' + currentUserId + '.' + (person?.id ?? 'invite'),
    initial,
    label: person ? 'Account access choices' : invitationsEnabled ? 'Invitation choices' : 'New person choices',
    pending: () => pending || inFlight.current,
    read: value => {
      const data = value as typeof initial
      if (
        !data ||
        typeof data.name !== 'string' ||
        data.name.length > 200 ||
        typeof data.email !== 'string' ||
        data.email.length > 254 ||
        !['active', 'disabled'].includes(data.status) ||
        typeof data.revision !== 'string' ||
        !/^\d{1,30}$/.test(data.revision) ||
        !Array.isArray(data.memberships) ||
        data.memberships.length > 1000
      )
        return null
      const memberships: SiteAssignment[] = []
      const seenSites = new Set<string>()
      for (const item of data.memberships) {
        if (
          !item ||
          typeof item.siteId !== 'string' ||
          item.siteId.length !== 36 ||
          !['contributor', 'editor', 'site_admin'].includes(item.role) ||
          seenSites.has(item.siteId)
        )
          return null
        seenSites.add(item.siteId)
        memberships.push({ siteId: item.siteId, role: item.role })
      }
      return { name: data.name, email: data.email, status: data.status, memberships, revision: data.revision }
    },
  })
  const { name, email, status, memberships, revision } = setup.value
  const busy = pending || setup.loading
  const assignedSites = new Set(person?.memberships.map(item => item.siteId))
  const availableSites = sites.filter(site => !site.archived || assignedSites.has(site.id))
  const availableIds = new Set(availableSites.map(site => site.id))
  const unavailable = memberships.some(item => !availableIds.has(item.siteId))
  useLayoutEffect(() => {
    leaveRef.current = setup.leaveState
    return () => {
      leaveRef.current = () => ({ dirty: false, pending: false })
    }
  }, [leaveRef, setup.leaveState])
  function change(value: Partial<typeof initial>) {
    setResult(null)
    setup.setValue(previous => ({ ...previous, ...value }))
  }

  function run(action: () => Promise<PeopleResult>, close = true) {
    if (inFlight.current || setup.loading) return
    inFlight.current = true
    onBusy(true)
    setResult(null)
    startTransition(async () => {
      try {
        const outcome = await action()
        setResult(outcome)
        if (outcome.ok) {
          setConfirm(false)
          if (close) {
            setup.finish()
            onSaved(outcome.message)
          } else router.refresh()
        }
      } catch {
        setResult({
          ok: false,
          message: 'The change could not be confirmed. Reload to check its status before trying again.',
        })
      } finally {
        inFlight.current = false
        onBusy(false)
      }
    })
  }
  function save() {
    run(() =>
      person
        ? updatePerson({ id: person.id, revision, name, status, memberships })
        : invitationsEnabled
          ? invitePerson({ email, name, memberships })
          : addPerson({ email, name, memberships }),
    )
  }

  return {
    formId,
    result,
    setResult,
    pending,
    inFlight,
    confirm,
    setConfirm,
    setup,
    name,
    email,
    status,
    memberships,
    busy,
    availableSites,
    unavailable,
    change,
    run,
    save,
  }
}
