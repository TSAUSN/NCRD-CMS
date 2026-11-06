Approved local use, October28,2026. Original bytes copied from the
organization's local AO Hub fonts folder; never fetched from a live site.
Exact filenames, weights, sizes and hashes are in the renderer font registry.
These assets sit outside public/ and are served only by the new local-only
font route after a build. The running demo's existing assets are unchanged.

The maintainer approved public delivery of these same seven files on November 4,
2026, after reviewing the licence evidence below. Hosted delivery requires the
explicit CMS_SERVE_LICENSED_BRAND_FONTS=true setting.


November 4 licence evidence: the bundled regular WOFF2 identifies Copyright (c)
2021 Anugrah Pasau and the SIL OFL URL in its name table. The author's release at
https://www.dafont.com/creato-display.font states SIL Open Font License 1.1; its
archive SHA-256 is 36eaf9a02625f967afa6a9a97b647ae1252a9e3045c4efeadbf9a5bcdcc8846d.
The release's complete copyright/licence notice is preserved in OFL.txt and at
/cms-licenses/creato-display-OFL.txt in both apps. No font bytes were changed.

The approved personal review enables CMS_SERVE_LICENSED_BRAND_FONTS=true.
Other installations must review their asset rights before enabling that setting.
The default route continues to require local mode and a loopback host. The opt-in
retains the fixed seven-file allowlist, exact byte count and SHA-256 checks; it
cannot serve arbitrary files. Never use CMS_LOCAL_TEST_MODE on hosted services.
