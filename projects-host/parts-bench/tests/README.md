# Tests

## The one that matters

```
python3 verify-model.py
```

Dependency-free. Recomputes all 22 published reference points from
`../spec/model.json` and fails if any drifts past 10%. Run it after any change
to the flow model — it re-implements the model from the spec rather than
importing the app, so it checks the spec is right, not just that the code
agrees with itself.

## Browser regressions

Playwright, against a locally served copy of the UI. Optional, but they cover
bugs that were expensive to find.

```
npm i playwright
node typetest.mjs      # every field holds focus and keeps the full string
node valtest.mjs       # range validation: 19/20 (the miss is benign, see below)
node drafttest.mjs     # drafts survive close, tab switch and page reload
node edittest.mjs      # editing, discard, add-while-browsing
node check.mjs         # zero horizontal overflow at 1440/1180/1024/760 px
node partstest.mjs     # STL and 3MF ingestion accuracy
node flowtest.mjs      # print records, history diffs, file verification
node uitest.mjs        # self-hosted end to end, needs app.py running on :8771
node rectest.mjs       # geometry validation on the Recommend inputs
node verify3.mjs       # standalone JS copy of the flow-model check
```

Most scripts expect a preview at `prev/index.html` built from the source; the
self-hosted ones talk to a running `app.py`. Adjust the paths at the top of each
file for wherever you unpack this.

### The known non-failure

`valtest.mjs` reports 19/20. The miss is typing letters into a `number` input:
the browser discards them before the page ever sees them, leaving the field
empty, which the tool correctly reads as "use the material default". There is a
`validity.badInput` guard for browsers that do report it. Not a defect.

## Fixtures

| File | What it exercises |
|---|---|
| `fixtures/cube20.stl` | Binary STL. Must measure exactly 20 × 20 × 20 mm and 8000.0 mm³ |
| `fixtures/bracket.3mf` | Bambu-style project: plate render, `slice_info.config`, `project_settings.config` with 82 keys |
| `fixtures/plain.3mf` | Plain 3MF with no slicer metadata — exercises the mesh-render fallback and the warning path |
