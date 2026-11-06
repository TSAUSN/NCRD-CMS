# Demo data

`pnpm demo` builds a local CMS from these site archives (the product's own
`cms-site-content` format) through the normal import and first-release commands.
SAWSO uses the native page/list/preset builders and a checked offline photo pack
through normal Media processing; this keeps its sections linked to the shared core.

These examples are independent local copies of the approved TSA rebuilds and
local source files. They do not connect BetterTogether2027.org, Human Needs
Index or any other Salvation Army production website to this CMS. Do not use
Salvation Army credentials or access Zesty/cPanel to edit live pages for this
project. `Publish` here changes only the local demo.

| Archive | Where it came from |
| --- | --- |
| `sawso-photos.json.gz` | Lead native demo:40 approved local photo copies with focus/review metadata. Exact pack bytes are checked; images pass normal Media receipts and the guarded worker processor. Native preset/page/list/frame/redirect builders create49 pages and34 stories without live requests. Labelled sample bodies/footer destinations/process artwork remain explicit. |
| `better-together-2027-original.cms-site.json.gz` | all nine BT2027 marketing pages from the approved local copy, original reviewed CSS/scripts, native Speakers (6), Sponsors (8) and Workshops (125), editable original menus and shared footer. Approved file bytes and their sources are preserved. The demo loader hash-checks this exact reviewed fixture before importing it. No sponsor registration, booth or dashboard application is included. |
| `human-needs-index.cms-site.json.gz` | The local V1 HNI rebuild, migrated and corrected until it matched V1 ([v1-migration](../docs/v1-migration.md)), exported with `apps/admin/scripts/demo-export.ts`. Published local pages, the V1 section library and page templates; migration scaffolding left out. |
| `echelon-symposium.cms-site.json.gz` | The V1 Echelon site, the same way. Speakers, agenda and registration are clearly labelled placeholders until real content exists. |
| `better-together-2027.cms-site.json.gz` | Earlier generic import retained as a historical fixture; fresh demos use the original-design archive above. |
| `event-editing-example.cms-site.json.gz` | Fictional event test fixture, retained for tests and omitted from fresh demo bootstrap. |

To regenerate one, run the command named above and replace the file; `pnpm demo --reset`
then loads it. Archives are large (pictures and PDFs travel inside them), so replace
them only when their content changes. Never reset a retained demo containing
editorial work. A normal restart leaves existing sites and drafts untouched.

BT2027 deliberately keeps the local source's older Workshop content and known
unavailable images. Adobe font reuse on a hosted domain needs owner confirmation.
The private run progress records source comparisons and remaining differences.
