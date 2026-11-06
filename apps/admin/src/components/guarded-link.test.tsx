import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const navigation = vi.hoisted(() => ({ confirm: vi.fn(), request: vi.fn(), push: vi.fn(), replace: vi.fn() }))
vi.mock('./navigation-guard.ts', () => ({
  confirmClientNavigation: navigation.confirm,
  requestClientNavigation: (proceed: () => void) =>
    navigation.request.getMockImplementation() ? navigation.request(proceed) : navigation.confirm(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: navigation.push, replace: navigation.replace }) }))
vi.mock('next/link', () => ({ default: 'a' }))
import { GuardedLink } from './guarded-link.tsx'
import { Crumbs } from './shell.tsx'

describe('guarded Next Link callback contract', () => {
  it('cancels Next navigation and skips downstream callbacks when the guard rejects', () => {
    navigation.confirm.mockReturnValue(false)
    const onNavigate = vi.fn()
    const element = GuardedLink({ href: '/sites/site-one', onNavigate, children: 'Pages' })
    const event = { preventDefault: vi.fn() }
    element.props.onNavigate(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('continues accepted navigation and retains the caller’s own cancellation', () => {
    navigation.confirm.mockReturnValue(true)
    const onNavigate = vi.fn((event: { preventDefault(): void }) => event.preventDefault())
    const element = GuardedLink({ href: '/sites/site-one', onNavigate, children: 'Pages' })
    const event = { preventDefault: vi.fn() }
    element.props.onNavigate(event)
    expect(onNavigate).toHaveBeenCalledWith(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('preserves ordinary Link props without intercepting onClick', () => {
    const onClick = vi.fn()
    const element = GuardedLink({
      href: '/sites/site-one',
      onClick,
      children: 'Pages',
      target: '_blank',
      prefetch: false,
      replace: true,
      scroll: false,
      'aria-label': 'Site pages',
    })
    expect(element.props).toMatchObject({
      href: '/sites/site-one',
      onClick,
      target: '_blank',
      prefetch: false,
      replace: true,
      scroll: false,
      'aria-label': 'Site pages',
    })
  })

  it('renders breadcrumb ancestors as guarded links and the current screen as text', () => {
    const html = renderToStaticMarkup(
      <Crumbs
        trail={[
          { label: 'Sites', href: '/' },
          { label: 'Example', href: '/sites/site-one' },
          { label: 'Header & footer', href: '/sites/site-one/global-elements' },
        ]}
      />,
    )
    expect(html).toContain('href="/sites"')
    expect(html).toContain('href="/sites/site-one"')
    expect(html).not.toContain('href="/sites/site-one/global-elements"')
    expect(html).toContain('<span aria-current="page">Header &amp; footer</span>')
  })
})

it('defers navigation and downstream callbacks until a draft choice resumes the exact destination', () => {
  let resume = () => {}
  navigation.request.mockImplementationOnce((next: () => void) => {
    resume = next
    return false
  })
  const onNavigate = vi.fn(),
    element = GuardedLink({
      href: '/sites/site-one/media',
      replace: true,
      scroll: false,
      onNavigate,
      children: 'Media',
    }),
    event = { preventDefault: vi.fn() }
  element.props.onNavigate(event)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(onNavigate).not.toHaveBeenCalled()
  resume()
  expect(onNavigate).toHaveBeenCalledOnce()
  expect(navigation.replace).toHaveBeenCalledWith('/sites/site-one/media', { scroll: false })
})
it('retains the caller cancellation after an asynchronous draft choice', () => {
  navigation.push.mockClear()
  let resume = () => {}
  navigation.request.mockImplementationOnce((next: () => void) => {
    resume = next
    return false
  })
  const element = GuardedLink({
    href: '/sites/site-one/media',
    onNavigate: event => event.preventDefault(),
    children: 'Media',
  })
  element.props.onNavigate({ preventDefault: vi.fn() })
  resume()
  expect(navigation.push).not.toHaveBeenCalled()
})
