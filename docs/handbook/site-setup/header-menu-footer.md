# Header, menu and footer

Site identity and navigation are shared across a site's pages and wait for publication.

For: Site admins and Super admins. Last checked: 2026-11-04.

Open **Header & menu** from the site menu. It has three tabs: **Menu**, **Logo**
and **Header buttons**. Editors cannot open this screen. Changes stay private
until you choose **Save draft** and then publish them from **Publish**. Sites
brought in with their own design keep their existing Menu & footer screen.

## Add a link to the menu

1. Open **Header & menu**, then the **Menu** tab.
2. Choose **Add to menu**, then what to add: a page on this site, a website, or
   a dropdown group.
3. Choose the page or enter the website. A new dropdown group needs its first
   real page before you can choose **Done**.
4. To change the order, drag a link up or down. Drag it right onto another link
   to put it inside that dropdown. The row's menu offers the same moves without
   dragging. Menus have at most two levels.
5. Choose **Save draft**, then publish the change from **Publish**.

Cancel or Escape removes an unfinished addition. Hiding a link never deletes
its page. Hover a shortened label or destination to read it in full.

## Change the logo

1. Open the **Logo** tab and choose **Replace**. Pick an image, or upload one in
   the picker.
2. Fill in **Description (for screen readers)**. It is required when a logo is
   chosen.
3. Choose **Save draft**, then publish from **Publish**.

**Use the Salvation Army shield** restores the approved mark. The logo always
links to the home page.

## Change the header buttons

1. Open the **Header buttons** tab and set the button's **Label**.
2. Under **Goes to**, choose **A page**, **A website**, **Email** or **Phone**.
   The page chooser lists this site's published pages. Email and phone add their
   link prefix for you.
3. To show a second button, turn on the switch beside **Second button**. Turning
   it off removes those fields from the draft.
4. Choose **Save draft**, then publish from **Publish**.

The preview on this screen comes from the site's own private address; **Preview**
opens a larger view.

## How it works

Header & menu Save draft preserves the footer and leaves published versions untouched. If
someone else saves the menu, header or footer first, your local work remains;
reload to compare before saving again.
Older national headers may need a Super admin to prepare the updated controls.
That step changes shared source definitions only. Preview updated header carries
compatible words and adds the approved starting logo; Save draft accepts it for
this site. Review in Publish before making that version visible to visitors.

The national header and footer now declare a logo field. SAWSO starts with the
approved Salvation Army shield. An existing pinned design keeps its logo until
you explicitly accept the newer design; the upgrade supplies that same approved
shield where no logo field existed, and preserves an existing logo choice.
Choose each site's own logo and describe it for people who cannot see it.
The heading and body font choices remain site settings.

Preset headers, including Echelon, also have Description (for screen readers).
A full or compact logo needs this description before Header & menu saves a new
draft. Older immutable headers without it still load and use the site name.
The image alt is empty when the visible site name already identifies the logo;
otherwise it uses the description. Choosing a logo does not rewrite its library
description or an older header version.

The header design also supports an optional second button. Each button's
tracking code is a query string, for example `utm_source=site&utm_campaign=fall`.
It is added to page/website destinations while retaining existing parameters and
an in-page anchor. Email and phone destinations remain unchanged; the code stays
in the draft for a later switch back to a page or website. It never substitutes a new destination. Empty or malformed
tracking is omitted by the renderer; the editing screen must validate it.

A dropdown group has a name and child links, with no destination of its own.
It opens by click or keyboard using the browser's native disclosure, including
without JavaScript. Desktop hover also reveals its links while the pointer is
over the group or its submenu. The phone menu keeps the same tap disclosure. Only two levels are supported. Empty groups are
not saved; removing the last link removes the group from that draft. Ordinary
parent links keep their existing destination and behavior.

Saving navigation and site identity uses the existing versioned commands,
conflict checks and publication permissions. Nothing in this change publishes
another site's saved work or changes an imported site's existing menu.
