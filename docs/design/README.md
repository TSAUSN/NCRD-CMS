# Design

How the revision 8 interface is judged. Screens are built from the SPEC and
reviewed by the maintainer on screenshots. Mockups are optional: the maintainer adds one
when a built screen should look different.

| Path | What it is |
| --- | --- |
| [current-v2-2026-10-25/](current-v2-2026-10-25/) | The "before" state: 20 screenshots of the running build at 1440 × 900 on October 25, 2026. 19–20 show the HNI section library. |
| [approved/](approved/) | Mockups the maintainer has supplied. When one exists for a screen, builders match it. |
| [screen-briefs.md](screen-briefs.md) | Shared design brief and screen requirements, S1–S21. |
| `../ui-reference/v1-cms-2026-10-02/` | V1 captures: the editing reference used for parity review. |

The flow:

1. A contributor builds the screen to the SPEC section.
2. The contributor walks it with screenshots at 1440 and 1024 px (plus phone preview where relevant) and shows the maintainer.
3. If the maintainer wants it to look different, they save a mockup to `approved/` as `<screen-id>-<name>.png`, and the contributor matches it.
