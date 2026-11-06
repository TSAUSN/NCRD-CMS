# Custom domains: steps and rollback

For the maintainer and authorized DNS administrator, after the native-address review.
No DNS/custom-domain change is authorized for this release.

Friday starts on `*.web.app`. Inspect Domains and its instructions during the
demo; keep real-domain cutover separate. Personal-review evidence proves CMS TXT
ownership only. Certificate activation and actual custom-host routing remain
unrehearsed, so this is a runbook, not a completed live-domain claim.

## Prepare a test connection first

1. Google project administrator/IT select one controlled, non-production test hostname, its intended CMS
   site and a change window. Record the old A/AAAA/CNAME/TXT/CAA values and TTLs,
   old HTTPS origin/certificate, public content and rollback maintainer. Keep the old
   host running. Never change nameservers or unrelated mail/MX records.
2. Back up database/media and record the deployed digest, native site address and
   primary/alias state. Confirm both native public sites work, tenant isolation
   holds and the organization public-invocation policy permits the runtime.
3. As Super admin, open **Site → Domains → Connect an address**. Enter only the
   full hostname (no scheme/path/port). Leave the www checkbox off for a test
   subdomain unless the matching alias is separately approved. Choose **Connect
   domain** once and wait for its reservation/worker receipt.
4. Copy the displayed records exactly, including the CMS `_cms-verify` TXT and
   Firebase ownership/certificate records. Follow each explicit **Add/Remove**
   action; do not invent an IP or copy the personal project's targets. Have IT
   approve the complete record diff before applying it. Preserve unrelated records.
5. The authorized DNS administrator applies that exact diff and checks authoritative
   DNS plus an independent resolver. Use **Verify now** and **Refresh domain
   status**; the CMS also checks in the background. Pending DNS, ownership verified,
   certificate issuance and Live are different states. Record the last check/error.
6. For an existing live address that cannot tolerate certificate-provisioning
   downtime, rehearse Firebase Hosting **Advanced Setup** with IT first. The CMS
   currently requests a standard custom-domain connection; it does not expose the
   complete advanced migration workflow. Do not promise zero downtime from the CMS
   button. Firebase documents that certificate provisioning can take up to 24 hours
   after the relevant DNS change.
   [Firebase Hosting custom-domain setup](https://firebase.google.com/docs/hosting/custom-domain).
7. Require ownership active, host active and certificate active, then check HTTPS
   with normal certificate verification: homepage, nested page, images/fonts,
   story/map links, menu, canonical address, redirects and staging noindex. Check
   at 1440/1024/390 and confirm another site's page/image cannot be read through
   this host. An ownership receipt alone is not this gate.
8. The first custom address becomes primary; later addresses redirect unless
   **Make primary** is chosen. Review that canonical/redirect consequence before
   changing it. Verify the native review address still behaves as intended. Only
   after the test connection passes should IT authorize any real site address.

## Roll back routing without losing content

1. Pause further domain/primary changes and record the failed connection's status,
   DNS/certificate evidence and deployed digest. A new private database dump keeps
   the failure/audit evidence. Do not delete a cloud resource to recover traffic.
2. The DNS administrator restores the exact previous routing records and TTLs
   recorded in preparation, without altering unrelated email/verification records.
   Keep the old origin/certificate available; cached DNS can route visitors to
   either origin until the previous TTL expires. Verify both destinations.
3. If a CMS primary-address change caused a redirect problem, the maintainer restores
   the previously verified primary/alias arrangement through the normal CMS flow,
   checking the resulting HTTP Location and canonical values. Do not change a
   database hostname by hand to conceal a routing issue.
4. Confirm old-host HTTPS/content and the unaffected native `*.web.app` sites.
   Preserve CMS content, immutable versions and audit history. A DNS rollback is
   not a database rollback; use History/release recovery for an unintended content
   publication and image rollback for compatible code failures.
5. Leave failed provider/domain resources in place for the maintainer’s later cleanup
   decision. No cloud deletion, registrar transfer or nameserver change is part
   of the review environment’s preparation or automatic rollback.
