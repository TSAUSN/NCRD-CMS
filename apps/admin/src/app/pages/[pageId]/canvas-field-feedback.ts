/** Native feedback stays quiet at rest, including insertion previews without
 * editing controls. Original imports keep their existing controls; this style
 * never reaches a public document. */
const feedback = `
[data-cms-native-field-feedback] [data-cms-frame]:not(:hover):not([data-cms-sitewide]),
[data-cms-native-field-feedback] [data-cms-section]:not(:hover):not([data-cms-selected]):not([data-cms-selected-within]),
[data-cms-native-field-feedback] [data-cms-slot]:not(:hover):not(:focus-within):not([data-cms-selected]):not([contenteditable]),
[data-cms-native-field-feedback] [data-cms-slot]:not(:hover):not(:focus-within):not([data-cms-selected]):not([contenteditable])>*,
[data-cms-native-field-feedback] .cms-repeat-preview:not(:hover):not(:focus-within):not([data-cms-selected])>*{outline:none}
`
export function installNativeFieldFeedback(doc: Document) {
  doc.documentElement.setAttribute('data-cms-native-field-feedback', '')
  if (doc.querySelector('style[data-cms-native-field-feedback]')) return
  const style = doc.createElement('style')
  style.setAttribute('data-cms-native-field-feedback', '')
  style.textContent = feedback
  doc.head.append(style)
}
