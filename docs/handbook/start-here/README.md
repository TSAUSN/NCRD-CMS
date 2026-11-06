# How this CMS works

For someone opening the CMS for the first time. Author on a laptop or desktop
at 1024 pixels or wider. On a phone, the page editor intentionally says
**Use a larger screen to edit**. Use the editor's **Phone** preview and check the
public page on a phone before publishing.

A **site** is one website, with its own pages, pictures, menu and appearance.
A **page** has a title and a web address. Its **sections** are the blocks you see
on it: a heading and photo, text, cards, a list or another supported layout.
You edit the section's labelled fields; you do not need to write HTML.

A **draft** is saved work that visitors cannot see yet. Saving and publishing
are separate actions. A **review** sends a draft to someone allowed to approve
it. **Publish** makes the selected saved work public. Shared changes such as the
Header, Footer, menu, Lists and Data values can affect several pages together.
Check the publishing review carefully so unrelated drafts stay private.

## Who can do what

| Role | Access |
|---|---|
| Super admin | The platform lead: every site, including access management and shared code. |
| Site admin | Manages an assigned site, its pages and site settings. |
| Site editor | Edits and publishes content within assigned sites. |
| Content creator (contributor) | Prepares drafts and submits them for review; cannot publish. |
| Division team member | Works with the assigned division's chapters; other divisions remain outside that assignment. |
| Chapter contributor | Edits the assigned chapter page and submits changes for approval. |

A sign-in does not grant access by itself. The personal review uses Supabase
email sign-in. Enter your assigned email, choose **Send me a link**, open the
received link and choose **Continue to CMS**. If delivery is unavailable, ask the
operator; the review has no invitation mail service or additional sign-in provider.

## 1. Find a page

1. Choose your site in the left sidebar, then **Pages**.
2. Enter its name in **Search pages and stories**, then select its title.
3. Alternatively, open **Search or jump to…** (⌘K), type a name, use the arrow
   keys to choose a result and press Enter. Escape closes search.

## 2. Change text

1. Open the page and click the text in its preview, or select its section in
   **Page structure**.
2. Change the labelled field in the right panel. Use the text formatting controls
   for headings, lists or links when offered.
3. Choose **Save draft**. Reload to confirm it was saved. Visitors still see the
   published version until you publish.

## 3. Add a section

1. Choose **Add a section**, or **Add a section here** between existing sections.
2. Choose an offered section and fill its fields.
3. Confirm that exactly one new section appears, then **Save draft**.

## 4. Move, hide or remove a section

1. In **Page structure**, use the section's drag handle to move it.
2. Open that section's actions to hide it or remove it. Read the confirmation
   before removing anything.
3. Use **Undo** and **Redo** to check your change. Preview the page and save.
4. Reload and confirm the order and visibility remain as intended.

## 5. Change a picture

1. Select the picture field and open its image picker.
2. Choose an existing image, or **Upload** → **Choose an image**.
3. Give an informative image a concise **Image description**. Choose decorative
   only when it adds no information. Finish with **Upload image** when uploading.
4. Set the focal point when offered, then **Use this image**. Check the crop in
   Desktop and Phone preview before saving.

## 6. Create a page from a template

1. Open **Pages** → **New page**.
2. Choose a template, enter the page name and address, and complete its fields.
3. Replace sample content and review the page checks. Add it to the menu only
   when it should appear there.
4. Save, preview and publish the page. The menu has its own publishing step.
   Hiding a menu item does not archive its page.

## 7. Write a story

1. Open **Stories** → **Add story** (or **Add a story** on your Home screen).
2. Fill **Title**, **Summary** and **Story text**. Choose a lead photo and describe it.
3. Select its project sector and region tags. Set **Story date** so the story can
   appear in the appropriate feeds. A date alone does not schedule publication.
4. **Save draft**, reload and check the text, photo, date and tags. **Where it will
   show** explains its destinations. Use **Coming up** to inspect scheduled work.

## 8. Publish, schedule or request approval

1. Choose **Preview** and check the saved draft, including the **Phone** preview.
2. An editor chooses **Publish**, reads the listed changes and confirms once.
   A contributor chooses **Submit for review** instead; an approver finds it in **Reviews**.
3. To publish later, choose **Schedule**, check the day, time and time zone, and
   confirm once. Inspect **Scheduled publishing** for the saved request.
4. Open the public page and check the exact change. If the screen says it is
   preparing or publishing, wait for its result before pressing anything again.

## 9. Restore earlier page content

1. Open the page's **History** and select an earlier version.
2. Read the saved field comparison and its preview.
3. Choose **Restore as new draft**, then **Create draft**. This keeps the other
   versions in history and leaves the live page alone.
4. Preview the new draft and publish it when ready. Open the public page to check.

## 10. Change something shared across the site

1. Open **Header & menu** for the logo, menu and Header buttons; open **Footer**
   for its text and links. Use **Site look** for colours, fonts and button styling.
2. Open **Lists** for repeated records, **Stories** for story-specific work, or
   **Data values** for a number used in several places.
3. Save and inspect every affected page listed by the CMS. Publish only the
   intended shared change, then check more than one public page.
4. **People & access** shows assignments, **Activity** records changes, and
   **Domains** lists addresses read-only. Ask the platform lead about access or
   address changes.

## If something does not finish loading

Your saved draft is separate from its preview. Check the save status before
leaving. Use the offered **Reload preview** once; if it still fails, record the
screen and ask the operator. Do not repeatedly press Schedule or Publish.
Unresolved preview observations are listed in [known issues](known-issues.md). This guide describes the controls, not a claim that
every role walkthrough has passed.
