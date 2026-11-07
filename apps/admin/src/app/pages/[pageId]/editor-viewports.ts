import { IconDesktop, IconMobile, IconTablet } from '../../../components/icons.tsx'

// Fixed device sizes remain available alongside an unscaled workspace view.
export const VIEWPORTS = {
  desktop: { width: 1280, label: 'Desktop', Icon: IconDesktop },
  tablet: { width: 768, label: 'Tablet', Icon: IconTablet },
  mobile: { width: 390, label: 'Phone', Icon: IconMobile },
} as const
export type Viewport = keyof typeof VIEWPORTS
