# Invariants

Things that are currently true and were expensive to make true. Each one has a
way to check it. Break any of these and something the owner relies on stops
working.

## The model

1. **All 22 calibration rows stay within 10%, worst case ≤ 8.8%.**
   Recompute every row of `spec/calibration.json` using the formulas and
   constants in `spec/model.json`. This is the single most important check —
   the whole tool's credibility rests on it.

2. **The Bambu 0.6 high-flow row stays out-of-sample.** The model computes
   48.4 mm³/s unclipped; the standard hotend's 40 mm³/s rating clips it to
   exactly the published 40. If a change makes this row fit by fitting rather
   than by clipping, the model has been overfitted.

3. **A 20 mm cube measures 20 × 20 × 20 mm and 8000.0 mm³.**
   `tests/fixtures/cube20.stl`. Volume comes from summed signed tetrahedra;
   any regression here means the geometry maths broke.

## The UI

4. **Typing never loses focus.** No handler may rebuild the editor panel on a
   keystroke. If a rebuild is unavoidable, it must be wrapped in the existing
   capture/restore focus helper. Check with `tests/typetest.mjs`.

5. **One save produces one record.** Never mix `addEventListener` and `onclick`
   on the same button — they do not overwrite each other, and this previously
   caused every save to create two records.

6. **No horizontal page overflow at any width.** Grid children and panels carry
   `min-width: 0`; without it a `white-space: pre` block pushes its track wider
   than the column. Check at 1440 / 1180 / 1024 / 760 px with `tests/check.mjs`.

7. **Unsaved entries survive closing the panel and reloading the browser.**
   Drafts are keyed per record in local storage. A draft identical to the saved
   record is dropped rather than flagged as an edit. Check with
   `tests/drafttest.mjs`.

## The data

8. **Renaming a part moves its folder and rewrites every version path.** After
   a rename, no `relPath` may point at the old location.

9. **Deleting is the only thing that removes a file.** Uploads, renames and
   imports never destroy an original.

10. **`part.json` in each part folder stays readable without the app.** The
    tree has to make sense to someone browsing the share directly.

11. **Import is idempotent.** Running a folder scan twice must add nothing the
    second time — duplicates are caught by SHA-256, not by filename.
