// The admin's icons, drawn here rather than depended on.
//
// There is no icon package in this workspace and adding one would put a few
// hundred glyphs and a build step behind the twenty-odd marks the product
// actually uses. Emoji were the alternative and they are not an option: an
// emoji is a *character*, so a screen reader reads "upwards black arrow" in the
// middle of a button's name, it renders in the user's own font at whatever
// weight that font has, and it changes shape between macOS, Windows and
// Android. None of those are things an interface control can afford.
//
// THE RULES EVERY ICON HERE FOLLOWS
//
// One grid (24), one stroke weight (1.75 at 24, so it holds at 16 and 20), round
// caps and joins, no fills except where a shape is genuinely solid. `currentColor`
// throughout, so an icon inherits the colour of the control it sits in and never
// has to be restyled for the navy bar, the red button and the muted rail
// separately.
//
// `aria-hidden` is not optional and not a default somebody can forget: these are
// decoration beside a name, or the whole content of a button that carries an
// `aria-label`. An icon that announced itself would double every label in the
// toolbar.
import type { ReactNode, SVGProps } from 'react'

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  /** Rendered size in pixels; the grid is always 24 (default 20). */
  size?: number
}

function Icon({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className="icon-svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/* ------------------------------------------------------------------ brand -- */
export function IconPeople(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M17 13a5 5 0 0 1 4 5v3" />
    </Icon>
  )
}
export function IconSettings(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 6h5m4 0h9M3 12h11m4 0h3M3 18h3m4 0h11" />
      <circle cx="10" cy="6" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="8" cy="18" r="2" />
    </Icon>
  )
}

/* ----------------------------------------------------------- editor tools -- */

export const IconUndo = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="M4 9h11a5 5 0 0 1 0 10h-6" />
    <path d="m8 5-4 4 4 4" />
  </Icon>
)
export const IconRedo = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="M20 9H9a5 5 0 0 0 0 10h6" />
    <path d="m16 5 4 4-4 4" />
  </Icon>
)
export const IconDesktop = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <rect x="2.5" y="4" width="19" height="12.5" rx="2" />
    <path d="M8.5 20.5h7M12 16.5v4" />
  </Icon>
)
export const IconTablet = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <rect x="5" y="2.5" width="14" height="19" rx="2.5" />
    <path d="M11 18.5h2" />
  </Icon>
)
export const IconMobile = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
    <path d="M11 18.5h2" />
  </Icon>
)
export const IconEye = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.75" />
  </Icon>
)
export const IconEyeOff = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="m3 3 18 18M10 5.7c5.5-1.2 10 4.8 11.5 6.3a18 18 0 0 1-3 3.6M6 6.7A19 19 0 0 0 2.5 12S6 18.5 12 18.5c1.4 0 2.7-.4 3.8-1M10.1 10.1a2.7 2.7 0 0 0 3.8 3.8" />
  </Icon>
)
export const IconExternal = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="M14 4h6v6" />
    <path d="M20 4 11 13" />
    <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5A1.5 1.5 0 0 1 5 6h4.5" />
  </Icon>
)
export const IconPlus = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)
export const IconSearch = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 4 4" />
  </Icon>
)
export const IconClose = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
)
export const IconArrowUp = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="M12 19V5" />
    <path d="m6 11 6-6 6 6" />
  </Icon>
)
export const IconArrowDown = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="M12 5v14" />
    <path d="m6 13 6 6 6-6" />
  </Icon>
)
export const IconChevronRight = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="m9 5 7 7-7 7" />
  </Icon>
)
export const IconChevronDown = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="m5 9 7 7 7-7" />
  </Icon>
)
export const IconChevronLeft = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="m15 5-7 7 7 7" />
  </Icon>
)
export const IconMenu = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="M4 6.5h16M4 12h16M4 17.5h16" />
  </Icon>
)
export const IconMore = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p} strokeWidth={2}>
    <circle cx="5.5" cy="12" r="1.1" fill="currentColor" />
    <circle cx="12" cy="12" r="1.1" fill="currentColor" />
    <circle cx="18.5" cy="12" r="1.1" fill="currentColor" />
  </Icon>
)
export const IconTrash = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="M4 7h16" />
    <path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
    <path d="M6.5 7 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
  </Icon>
)
export const IconRevert = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="M3.5 5.5v5h5" />
    <path d="M4.6 13a8 8 0 1 0 1.5-5.4L3.5 10.5" />
  </Icon>
)
export const IconDrag = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p} strokeWidth={2}>
    <circle cx="9" cy="6" r=".9" fill="currentColor" />
    <circle cx="15" cy="6" r=".9" fill="currentColor" />
    <circle cx="9" cy="12" r=".9" fill="currentColor" />
    <circle cx="15" cy="12" r=".9" fill="currentColor" />
    <circle cx="9" cy="18" r=".9" fill="currentColor" />
    <circle cx="15" cy="18" r=".9" fill="currentColor" />
  </Icon>
)
export const IconCode = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="m8.5 8-4.5 4 4.5 4M15.5 8l4.5 4-4.5 4" />
  </Icon>
)
export const IconBrush = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="M15.5 3.5 20.5 8.5 11 18a3 3 0 0 1-1.6.8l-4.2.7.7-4.2A3 3 0 0 1 6.7 13Z" />
    <path d="m13.5 5.5 5 5" />
  </Icon>
)

/* --------------------------------------------------------------- content -- */

export const IconPage = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="M6 3.5h7l5 5v12a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20.5v-15A2 2 0 0 1 6 3.5Z" />
    <path d="M13 3.5v5h5" />
  </Icon>
)
export const IconSections = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <rect x="3.5" y="4" width="17" height="5" rx="1.5" />
    <rect x="3.5" y="12" width="17" height="8" rx="1.5" />
  </Icon>
)
export const IconHome = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" />
  </Icon>
)
export const IconLocation = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" />
    <circle cx="12" cy="10" r="2.5" />
  </Icon>
)
export const IconSite = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
    <path d="M3 9.5h18" />
    <path d="M6.5 7h.01M9 7h.01" />
  </Icon>
)
export const IconFrame = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <rect x="3" y="3.5" width="18" height="17" rx="2" />
    <path d="M3 8.5h18M3 15.5h18" />
    <path d="M7 6h6M7 18h10" />
  </Icon>
)
export const IconCollection = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <rect x="3.5" y="4" width="17" height="4.5" rx="1.5" />
    <rect x="3.5" y="10" width="17" height="4.5" rx="1.5" />
    <rect x="3.5" y="16" width="17" height="4.5" rx="1.5" />
    <path d="M7 6.25h.01M7 12.25h.01M7 18.25h.01" />
  </Icon>
)

/* ------------------------------------------------------------ field kinds -- */

export const IconText = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="M5 6.5V5h14v1.5" />
    <path d="M12 5v14" />
    <path d="M9 19h6" />
  </Icon>
)
export const IconParagraph = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="M4.5 6h15M4.5 10.5h15M4.5 15h11M4.5 19.5h7" />
  </Icon>
)
export const IconImage = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="m4.5 17 4.7-4.4a1.5 1.5 0 0 1 2 0L16 17M14 14.5l1.4-1.3a1.5 1.5 0 0 1 2 0l2.1 2" />
  </Icon>
)
export const IconLink = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.3 1.3" />
    <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.3-1.3" />
  </Icon>
)
export const IconButton = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <rect x="3" y="7.5" width="18" height="9" rx="4.5" />
    <path d="M8.5 12h7" />
  </Icon>
)
export const IconRepeat = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <rect x="3.5" y="4.5" width="17" height="5" rx="1.5" />
    <rect x="3.5" y="14.5" width="17" height="5" rx="1.5" />
  </Icon>
)

/** The mark for a declared field kind, chosen once so every rail agrees. */
export function SlotIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  switch (kind) {
    case 'icon':
      return (
        <Icon width={size} height={size}>
          <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" />
        </Icon>
      )
    case 'richtext':
      return <IconParagraph size={size} />
    case 'image':
      return <IconImage size={size} />
    case 'link':
      return <IconLink size={size} />
    case 'button':
      return <IconButton size={size} />
    case 'repeat':
      return <IconRepeat size={size} />
    default:
      return <IconText size={size} />
  }
}

/* ---------------------------------------------------------------- states -- */

export const IconCheck = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
)
export const IconAlert = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="M12 4.5 21 20H3Z" />
    <path d="M12 10v4" />
    <path d="M12 17h.01" />
  </Icon>
)
export const IconInfo = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 8h.01" />
  </Icon>
)
export const IconClock = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.2l3.2 2" />
  </Icon>
)
export const IconLock = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <rect x="4.5" y="10" width="15" height="10.5" rx="2.5" />
    <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
  </Icon>
)
export const IconSignOut = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <path d="M14 4.5h4A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5h-4" />
    <path d="M11 8.5 14.5 12 11 15.5" />
    <path d="M14 12H4.5" />
  </Icon>
)
export const IconMail = (p: Omit<IconProps, 'children'>) => (
  <Icon {...p}>
    <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
    <path d="m3.8 7.5 7.3 5.2a1.5 1.5 0 0 0 1.8 0l7.3-5.2" />
  </Icon>
)
