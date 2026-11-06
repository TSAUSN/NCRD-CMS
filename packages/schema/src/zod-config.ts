import { z } from 'zod'

// Zod 4 probes whether `new Function` may run so it can compile faster
// object parsers. The admin's Content Security Policy forbids `eval`, and a
// strict policy reports even a caught probe as a violation (AUTH-05). Every
// app shares this package, so the interpreted parsers apply everywhere; the
// schemas parsed here are small, and the cost is negligible.
z.config({ jitless: true })
