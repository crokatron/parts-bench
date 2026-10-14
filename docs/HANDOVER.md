# Parts Bench: maintainer handover

[One-screen summary](START-HERE.md) · [User manual](USER-MANUAL.md) · [Feature overview](../README.md) · [Recorded validation](../VALIDATION.md)

## Purpose and behaviour to preserve

Keep a traceable library of printed parts, versions, spools, batches, hotends and print records. Compare computed starting settings, investigate print symptoms and retain the exact configuration used for an attempt. The newer NAS print-job integration is distinct from the established library and remains deployment/version dependent.

- **Spool library:** Track brand, type, colour, batch, condition, quality and measured flow. (Library and workflow.)
- **Part versions:** Store model files and extracted 3MF/STL metadata without losing version identity. (Library and workflow.)
- **Recommendations:** Show calculated settings and substituted arithmetic based on material, hotend and goals. (Library and workflow.)
- **Compare:** Save configurations side by side and highlight differing values. (Library and workflow.)
- **Diagnose:** Rank possible causes for selected symptoms under the stated maintenance assumptions. (Library and workflow.)
- **Print history:** Link part version, exact spool/batch and hotend to a frozen settings snapshot. (Library and workflow.)
- **Storage and audit:** Review file inventory, imports, fingerprints and field-level change history. (Library and workflow.)
- **NAS print jobs:** Where configured, separate immutable sliced jobs from physical launch attempts and filament selection. (Library and workflow.)

The [demo](../demo.html) is a smaller, labelled simulation with fictional data. It explains cause and effect without the real service; it is not evidence of a working production installation. Numbered screenshots in the user manual distinguish actual-app captures from demo captures.

## Files and sources of truth

| Actual package path | Maintainer role |
| --- | --- |
| [projects-host/parts-bench/src/partsbench](../projects-host/parts-bench/src/partsbench) | Python library server, NAS bridge, print jobs and web UI |
| [projects-host/parts-bench/spec](../projects-host/parts-bench/spec) | Model, invariants and calibration data |
| [projects-host/parts-bench/tests](../projects-host/parts-bench/tests) | Model, browser and job fixtures |
| [projects-host/parts-bench/IMPLEMENTATION.md](../projects-host/parts-bench/IMPLEMENTATION.md) | Checkpoint implementation history |
| [demo-source](../demo-source) | Editable demo HTML/CSS/runtime and embedded screenshot tour |
| [SOURCE-MANIFEST.json](../SOURCE-MANIFEST.json) | Original copied-source paths and SHA-256 checkpoint values |

The original working source is under C:/Users/lamon/Desktop/AI TOOLS/NAS for NAS modules; adjacent CAD/watch source locations are recorded by the full backup’s reviewed source manifest. This package contains only the explicitly copied source, not an automatic mirror. The main private nas-projects backup retains the broader shared host context.

## Setup, run and tests

Run commands from this repository root unless a `cd` is shown. Use a disposable checkout and fictional data for first setup. Dependencies, SDKs, signing material and personal data are not bundled. The following are continuation instructions grounded in the retained source, **not commands executed or newly certified by this handover**.

```powershell
cd projects-host/parts-bench/src/partsbench
python app.py --root C:/Temp/parts-bench-test-library --port 8770
```

The command starts the base library against a disposable test root. It does not recreate the authenticated NAS/printer integration.

Selected project check:

```powershell
cd projects-host/parts-bench
python -B tests/verify-model.py
```

For the documentation demo alone, serve this repository on loopback with `python -m http.server 8765 --bind 127.0.0.1` and open `/demo.html`. Choose a free port if another preview is running. JavaScript syntax can be checked with `node --check demo-source/runtime.js`. `python demo-source/rebuild.py` rewrites demo.html, so run it only in a disposable checkout or an authorised demo-editing session. A local server cannot provide missing HA/CAD/NAS functions. Inspect browser tests for installed dependencies, fixture requirements and network targets before running them with the approved browser tooling.

## Data, configuration and backup boundaries

Back up the whole library, including _bench/bench.db, model files, thumbnails, immutable job evidence and attempt history. NAS printer configuration is protected data/private/parts-bench.json; never print access codes. Browser drafts are not shared saved records.

The library owns its model-folder layout, metadata and database. Back up the complete root including _bench, not only the visible STL files. Browser drafts and saved shared records are different. Print-job snapshots/attempt history need their own preserved storage.

Git preserves reviewed source and documentation. It does not copy browser storage, application databases, uploaded models/photos, accepted device settings, SDKs or credentials. Maintain independent recovery copies of the data identified above, including matching configuration and asset versions. Never add real secrets to examples, issues or logs. Private source copies on GitHub are not proof of a complete NAS/offsite data backup.

## Current verification and Git state

Before these documentation edits on 14 October 2026, this package was clean on branch `main` at `4b62902171b0cf6cf715c921a1a2cfafbf53fbde` and its private upload was verified. All 36 manifest-listed source entries matched their stored checksums before editing. The upload follow-up has completed all 17 repositories and is paused; it does not run this tool or back up its live data.

These handover pages and README links accompany the private source package. Preserve them when continuing; stage only reviewed changes. Recheck current `git status --short --branch` and `git diff` before starting. No project-specific background schedule was inspected or changed in this documentation pass. Any service schedules in older notes are historical claims to verify in the actual deployment.

Earlier package checks and limits are recorded in [VALIDATION.md](../VALIDATION.md). This handover adds documentation/link/whitespace/secret and source-preservation checks only. No current NAS release, real hardware state, fresh installation, complete data restoration or offsite-backup freshness was verified here.

## Recovery approach

1. Preserve the current installation/data before changing it. Identify the exact code commit and data snapshot required; do not assume this package matches the running service.
2. Recover source into a new folder. Verify the source manifest and restore the project-specific configuration/assets described above separately. Recreate dependencies from the retained project files and guides.
3. Restore user data into an isolated instance or clean test browser. Check a representative editable record, associated files and save/reload behaviour, then compare to the original. Do not test recovery by overwriting production.
4. Record what actually restored and what remains missing. A demo opening or a passing syntax check is not a production recovery drill. Real deployment/device actions need the existing authorised workflow.

## Known limits and next work

Source was split from a private checkpoint while print-job integration was still evolving. Read the retained implementation notes before deploying. This is not a clean-machine or physical-print validation of the newer integration.

**Priority:** Reconcile the newer working NAS changes before the next source refresh. Test safe import/rename, revisions, exact loaded spool and job guards on fixtures. Never start a real print as a routine test. Historical September no-login/no-dependencies claims describe the old local build, not the current authenticated NAS system.

Common symptoms to check for this tool:

- Missing preview/metadata: plain STL lacks slicer settings; inspect the actual uploaded format.
- Recommendation seems high: check material, hotend, layer width/height and cooling assumptions.
- Changed folder name: part/category renaming intentionally moves the managed folder.
- Launch waiting: resolve filament/connection/compatibility guards; do not bypass them.

Keep [the release checklist](../RELEASE-CHECKLIST.md) and [third-party notes](../THIRD-PARTY.md) with the package. Original contributions use MIT; bundled/upstream code and assets keep their own licences. Public publication is a separate decision; preparing documentation is not permission to publish.

## Parts Bench chronology: September is historical

The nested [START-HERE](../projects-host/parts-bench/START-HERE.md) and [HANDOVER](../projects-host/parts-bench/HANDOVER.md) retain the September base-library record. Their old no-login, local-Windows and zero-dependency statements are not current claims about the authenticated NAS/printer deployment. Their original text is preserved below an explicit historical notice.

The current working `NAS/projects-host/parts-bench/IMPLEMENTATION.md`, read on 14 October, reports later print-verification/PDF evidence, physical spool/loaded-slot accounting and CAD/sliced-file inbox work. It records releases at 20:35:44 and 20:49:51 UTC on 13 October. Those are working-source historical reports, not fresh live verification by this handover. The inbox stores originals, waits for stable files and does not itself launch a print. Automatic material deductions depend on the documented spool/AMS assumptions.

Five manifest-listed Parts Bench working files differ from this package: IMPLEMENTATION.md, nas_bridge.py, print_jobs.py, web/app.js and web/index.html. Additional new files may also exist outside the checkpoint manifest. Reconcile them with the working project before any new source package or deployment. Do not copy this older package back over that work.

The two nested Markdown files now carry historical banners; their checkpoint hashes in SOURCE-MANIFEST.json intentionally describe the original copies. All non-document source bytes remain unchanged. The source manifest was not silently rewritten to make these documentation annotations appear original.
