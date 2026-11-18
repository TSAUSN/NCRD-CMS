# Take a CMS site online at a custom address

A CMS site can serve published pages at its native Firebase test address while its custom hostname is being connected. Publishing content and connecting hosting are separate operations. **Settings → Domains** on a site is where a Super admin connects an address and sees its instructions. The global **Domains** screen summarizes addresses across sites.

## How the connection works

| Part | What it does |
| --- | --- |
| CMS | Reserves the exact hostname for the selected site. Its private worker creates or checks the mapping on that site’s existing Firebase Hosting instance. It also verifies the CMS ownership TXT record and records provider status. |
| DNS provider | Publishes the routing and verification records shown by the CMS. The DNS owner, not the CMS, controls this zone. The name is relative to the zone if the provider automatically appends the domain. |
| Firebase Hosting | Validates its own ownership and certificate requirements and serves HTTPS for the requested hostname. It forwards requests to the public Site service. |
| Public Site service | Resolves a live hostname to its CMS site and renders the published version. Secondary custom names redirect to the primary address. The native test address remains available. |
| Adobe Fonts, when used | Adobe has its own hostname allowance for the kit. It affects font loading after the site opens. Website routing and the TLS certificate are handled separately. |

The normal CMS flow registers the hosting mapping through the worker. The selected site’s Firebase mapping and the CMS’s live host record are the two routing links in this flow. An existing mapping on the correct site is reused. An extra application allowlist entry is unnecessary. Firebase Console **Hosting → the intended site → the custom domain** is the operator’s view of the same mapping and its provider-specific status. An admin sign-in hostname or an Auth email-sending domain is a different configuration.

## What the controls and stages mean

| CMS stage or control | What it tells you |
| --- | --- |
| **Preparing DNS instructions** | The CMS accepted the hostname. Firebase has not returned actionable records yet. A long delay can mean the background attach job failed. |
| **Verifying ownership** | The CMS or provider still needs to see the correct verification record. `_cms-verify` proves the CMS connection belongs to the chosen site. Provider TXT records have their own purpose. |
| **Waiting for DNS** | Firebase still reports the host inactive. Authoritative DNS can already show the records while Firebase’s view catches up. An HTTP redirect to HTTPS or a Firebase placeholder is not proof that the domain serves the site. |
| **Issuing certificate** | The provider has accepted DNS and ownership and is working on HTTPS. The certificate must include the exact hostname. |
| **Live** | The worker observed usable DNS, verified ownership and a usable provider certificate. An ordinary HTTPS request and a page check confirm the visitor experience. |
| **Verify now** and **Refresh domain status** | Verify queues an asynchronous check. Refresh reads the last saved result. The CMS also schedules pending-domain checks about every ten minutes. **Last checked** distinguishes a fresh result from an old one. |

## Connecting a new address

1. In the intended site’s **Settings → Domains**, the native test address is the baseline for published pages. **Connect an address** accepts the hostname alone, without a protocol, path or port. The matching `www` option is for a second hostname that is actually needed.
2. Once the worker returns the records, **Copy DNS records** provides each name, type, value and action. Squarespace may expect `sawso` for `sawso.usnsandbox.org`. Its equivalent for `_cms-verify.sawso.usnsandbox.org` is `_cms-verify.sawso`. The CMS table is a list of requested changes. Other working mail and verification records remain part of the DNS zone.
3. The DNS owner applies the displayed changes. A typical subdomain can have a CNAME plus separate TXT records for CMS ownership and the Firebase certificate challenge. Other hostnames can receive different record types. The exact values on the domain’s own card take precedence over examples.
4. After the records are visible, **Verify now** checks the connection. A newly changed record can take time to be visible to the provider. Firebase documents that certificate provisioning can take up to 24 hours after routing DNS is correct. [Firebase custom-domain setup](https://firebase.google.com/docs/hosting/custom-domain).
5. Go-live evidence includes valid HTTPS for the exact name, the correct homepage and a nested route, working navigation and media, and the expected canonical or redirect address. Sites with Adobe Fonts also need the intended font to actually load on that hostname. The native test address should still respond, with test indexing behavior intact.

## Diagnosing a partial connection

- **DNS absent or wrong:** compare the full record name, type and value against the CMS and the DNS zone’s authoritative servers. A duplicated suffix, cached negative answer, or conflict on the hostname can produce different results between resolvers.
- **DNS exists but HTTPS has a hostname mismatch, or Firebase shows Site Not Found:** check the exact spelling, native target, Firebase Hosting site association and current ownership/certificate status. If Firebase still lists an ACME challenge, its current value matters. DNS reaching the Firebase edge is one step in the connection.
- **Firebase is active but an ordinary URL still shows Site Not Found:** compare the plain URL with a fresh query string on the same path. A cached Firebase 404 on the plain URL and the expected CMS page on the fresh request point to a stale Hosting cache entry. A new live release cloned from the current Hosting version can refresh that cache. The clone should match the current rewrite and file hashes. The operator checks both plain URLs again after the release. [Firebase Hosting cache behavior](https://firebase.google.com/docs/hosting/manage-cache).
- **No instructions or stale CMS status:** the hosting operator can inspect `domain.sync` or `site.hosting_requested` and its latest receipt. A Firebase 403 during worker delivery points to the runtime service account, project or quota-project permission. A 403 from a maintainer’s own Firebase console access is a separate operator permission issue. [Hosting delivery recovery](../upgrades/hosting-delivery-recovery.md).
- **Valid HTTPS with the wrong content:** compare the native site and the exact requested hostname, then check the selected Firebase site, CMS primary/alias state and published routes. If only fonts differ, [Site look → Fonts](../site-setup/fonts.md) explains the separate Adobe hostname check.

## NCRD example, checked November 18, 2026

The DNS owner added the SAWSO CNAME and two TXT records in Squarespace. The records matched the CMS instructions on all four authoritative nameservers. After Firebase activated DNS, ownership, and the certificate, the CMS showed **Live** at 11:44 a.m. Eastern. The public hostname still returned Firebase’s **Site Not Found** for the plain homepage and Newsroom. Both returned the correct SAWSO pages when requested with a fresh query string. The native test address continued to work.

At 2:56 p.m. Eastern, the operator cloned Hosting version `d1b6984879f27ff9` to `a263e02b1196ba61` on site `ncrd-cms-e9bd03c015856424`. The clone kept the catch-all rewrite to `ncrd-cms-site` in `us-central1` and matched both hosted file hashes. Publishing that clone to the live Hosting channel cleared the observed 404s. The DNS records and domain mapping stayed in place. The [homepage](https://sawso.usnsandbox.org/) and [Newsroom](https://sawso.usnsandbox.org/newsroom) returned HTTP 200 on their plain URLs and loaded in Chrome. A follow-up check on November 18 confirmed both plain URLs still returned the expected pages, matching the native Hosting address.

Firebase rejected releasing the version that was already active. Cloning the version’s Cloud Run rewrite required `run.services.get` on the target service in addition to the existing Hosting access. A service-scoped Cloud Run Viewer grant supplied that permission. [Cloud Run IAM roles](https://docs.cloud.google.com/run/docs/reference/iam/roles#run.viewer).

Current status and the native test address are available in [SAWSO’s Domains screen](https://ncrd-cms-admin-57223803907.us-central1.run.app/sites/95976d54-9dfc-41d3-83e1-93f1d070a76f/domains).

## Moving an address that already serves visitors

A live-site migration needs the previous DNS values and TTLs, HTTPS host and rollback owner recorded before the switch. Firebase’s **Advanced Setup** can prepare ownership and HTTPS before routing is moved. The CMS’s normal workflow does not expose the full advanced migration sequence. The first custom address is designated primary when connected. Public routing uses it once it is Live. Additional addresses redirect unless another address is made primary.

Routing recovery restores the prior records and the intended primary/alias settings. Keeping the previous host serving during propagation protects visitors with cached DNS. Routing changes do not change saved CMS content. Publication History covers an editorial recovery, and a compatible Cloud Run revision covers a code rollback.
