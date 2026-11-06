# Echelon chapters — five-minute local demo

Start the retained demo from the repository:

```sh
CMS_DATA_HOME=/private/tmp/cms-v2-live-adaptation-demo CMS_PG_PORT=54329 pnpm demo --build
```

Never reset that data. Stop the demo before building separately. This demo uses
local Postgres, recorded messages and example addresses; it sends no real email.
Better Together 2027 remains the first site in the CMS.

1. **0:00 — The public site.** Open
   [Echelon chapters](http://echelon-chapters.staging.localhost:3001/).
   Show the navy home, search near the top, pillars, leadership, news and contact
   form. In **Find a chapter**, open Peoria, then North Texas. North Texas shows
   eight board members; **Show all 16 board members** reveals the rest without
   JavaScript. Boston leads with social links and has no board or events.
   Detroit says **Visit their website ↗**; its example address is a placeholder.
   Maryland is a draft; the rebuilding example is not listed.
2. **1:00 — A division's work.** Sign in at [the CMS](http://localhost:3000/)
   with `division@example.test` (Division editor, sample). Open **Set up chapters**.
   Show Maryland's draft setup: destination, section switches, update mode and
   private point of contact. The division assignment is sample data, not a claim
   about the real organisation. New chapters default to division-team editing;
   choose chapter editors when inviting a volunteer.
3. **2:00 — A volunteer's view.** On Peoria choose **Invite a volunteer**, using
   `peoria-volunteer@example.test` and **Chapter editor (sample)**. Open the
   **Local outbox**, then open that sign-in link in a separate private window.
   The volunteer sees only Peoria. Change a paragraph, use the board's arrows or
   **Add a board member**, and show the locked **What is Echelon** and **Join us**
   sections. Use **Phone** to preview the real public layout. Save a draft, then
   **Submit for review**. The live page stays unchanged.
4. **3:30 — Approval.** Return to the division window's **Inbox**, open the
   submission, and **Approve and publish**. Confirm sample content if prompted.
   Reload Peoria to see the approved version. Find a chapter follows the live
   chapter setup, not private draft changes.
5. **4:15 — Keeping it current.** Sign in separately as `admin@example.test`.
   In Echelon **Settings → Chapter checks**, preview the two January/July
   wordings and record a local check. The outbox shows editor and division-team
   messages; repeating a cycle does not duplicate them. Show **Manage redirects**
   and visit `/chapter/peoria`: it redirects to `/chapters/peoria`.
   End with the public site at390px and the editor's Phone preview.

Admin editing is for laptops/desktops (1440/1024). Below768px the CMS shows
status and asks for a larger screen. Public pages still work on phones.

## Before hosted use

Supply the official chapters logo and approved photos; confirm the Creato Display
font licence. The text wordmark and labelled sample media are deliberate local
stand-ins. Confirm real division assignments, points of contact, external chapter
URLs and the duplicate Florence rows before importing real access or publishing
real chapter information. Invitations and checks currently use the local outbox.
Public hosting and real email require separate administrator approval and provider setup.
