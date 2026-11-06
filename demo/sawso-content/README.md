# October 30 owner content capture

This is a frozen, local-only content import, not a live-site sync. Three story
bodies come from the approved article files. The other 31 story pages,
Team, Annual Reports, Accountability and homepage were captured once. All live
copy and photos are **copied from live site, needs review**. Source addresses,
capture times and hashes are in sources.json; raw captures remain in the private
progress folder. No old page styling or scripts are imported.

content.json contains the complete extracted text, including the Venezuela
article. Rich-text body fields allow100,000 characters; other text retains
20,000. The full article is imported without trimming on replay. The three local files contribute only their main articles; related
story panels and video controls are excluded. photos.json.gz contains39 copied
images. The original homepage illustration is rasterized from its captured SVG
before normal Media processing; no active SVG or external dependency is served.
receipt.json pins the text and image-pack checksums.

The importer preserves unpublished work, replaces only requested story bodies
and sample information pages, and checks that the eight ministry pages and Ways
We Help remain identical. It keeps sample markers where content/images remain
missing. Privacy links externally. The unused local Privacy placeholder is archived
through its normal command when --archive-unused-privacy is supplied; its history is kept. Publication uses the normal reviewed release, including remaining sample
consent. No reset or direct table update is used.

To replay after starting the retained demo, run from the repository root with
Node24. The command refuses another database, port or hosted Media store:

```sh
DATABASE_URL=postgres://cms:cms@127.0.0.1:54329/cms_demo \
DATABASE_URL_AUTHENTICATED=postgres://cms_admin_app:devpassword@127.0.0.1:54329/cms_demo \
DATABASE_URL_WORKER=postgres://cms_worker_app:devpassword@127.0.0.1:54329/cms_demo \
MEDIA_PROVIDER=filesystem \
MEDIA_ROOT=/private/tmp/cms-v2-live-adaptation-demo/demo-media \
node --conditions=react-server --experimental-strip-types --no-warnings apps/admin/scripts/import-sawso-content.ts --archive-unused-privacy
```

The result receipt is saved in .r8-progress/sawso-owner-content-result.json.
