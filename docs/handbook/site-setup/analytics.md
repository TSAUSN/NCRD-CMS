# Google Analytics

Connect a site's GA4 web data stream through typed settings.

For: Admins and Super admins.

1. In Google Analytics, create or select the approved property and web data
   stream for this site. Copy its **Measurement ID** beginning `G-`.
2. Open **Settings → Analytics** in the CMS. Enter that ID. There are no API
   keys or script snippets to paste into this screen. Each site has its own ID.
3. Choose **Enable tracking on published pages** when the property is ready.
   Tracking is off by default.
4. Leave **Also collect on test addresses** off to exclude native test hosts.
   Enable it deliberately when testing a property on a CMS test address.
5. **Save draft**, then review the ID and both switches in **Publish**.
   Confirm the intended site settings. Saving privately sends no visitor events.
6. Open a published page on an included hostname and check the intended GA4
   property's Realtime view. Private previews and CMS screens are excluded.

This first phase sends basic page activity to Google Analytics. It does not
show reports inside the CMS. A later reporting connection needs the property's
numeric ID, enabled Data API and approved read access. A Measurement ID alone
cannot read reports. Do not create a second tag in page fields or a site file;
that can double-count visits. The built-in initial page URL omits query strings.

This feature requires migration 0210 and the matching application. The owning
database operator applies the reviewed migration before the code is deployed.
Real event delivery remains unverified until the intended ID is supplied and
the published host is tested against its property.
