/** Owner-approved local font bytes. Public-hosting licence remains an owner gate. */
export const LOCAL_BRAND_FONTS = [
  {
    source: 'creatodisplay-regular-webfont.woff2',
    file: 'creato-display-regular.5af63ab19016.woff2',
    weight: 400,
    style: 'normal',
    sha256: '5af63ab19016ecba9ae6ffb867466de41c05cfbf614b59a1de10d917a349ad37',
    bytes: 19140,
  },
  {
    source: 'creatodisplay-medium-webfont.woff2',
    file: 'creato-display-medium.69fe616343ee.woff2',
    weight: 500,
    style: 'normal',
    sha256: '69fe616343eeb89b76e1f0007d09c8f002fa7f526b929ef5ffd6d3c79b62b07a',
    bytes: 19292,
  },
  {
    source: 'creatodisplay-light-webfont.woff2',
    file: 'creato-display-light.81d84df3e5f3.woff2',
    weight: 300,
    style: 'normal',
    sha256: '81d84df3e5f3e3e0cfd80282d245b6b56aaff446f4a5248cca6262331b1b9ef1',
    bytes: 19088,
  },
  {
    source: 'creatodisplay-lightitalic-webfont.woff2',
    file: 'creato-display-lightitalic.aa99d1471d93.woff2',
    weight: 300,
    style: 'italic',
    sha256: 'aa99d1471d93358b1a3ee1a59caf43ff5151285ea50dd6d6aeb86467087549e7',
    bytes: 21688,
  },
  {
    source: 'creatodisplay-bold-webfont.woff2',
    file: 'creato-display-bold.80cedc7f30df.woff2',
    weight: 700,
    style: 'normal',
    sha256: '80cedc7f30df20cff27b37991944d4dc2fe0f1f2ba811ca79a796af2b9be3a3c',
    bytes: 19696,
  },
  {
    source: 'creatodisplay-bolditalic-webfont.woff2',
    file: 'creato-display-bolditalic.864a6ee619e0.woff2',
    weight: 700,
    style: 'italic',
    sha256: '864a6ee619e0430822a22614fa4ed98867a5d050f00aa643c3482aa81f87ce3d',
    bytes: 21972,
  },
  {
    source: 'creatodisplay-extrabolditalic-webfont.woff2',
    file: 'creato-display-extrabolditalic.7efbb276a68b.woff2',
    weight: 800,
    style: 'italic',
    sha256: '7efbb276a68b4d402e6bc88d40956718f481d14f8b7cdb93c928e8fd0b87a8a0',
    bytes: 21588,
  },
] as const
export function localBrandFont(file: string) {
  return LOCAL_BRAND_FONTS.find(face => face.file === file) ?? null
}
export function localBrandFontCss(): string {
  return LOCAL_BRAND_FONTS.map(
    face =>
      `@font-face{font-family:'Creato Display';src:url('/__cms/fonts/${face.file}') format('woff2');font-weight:${face.weight};font-style:${face.style};font-display:swap}`,
  ).join('')
}
