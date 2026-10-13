# Parts Bench — visual user manual

[Project overview](../README.md) · [Offline interactive demo](../demo.html)

Start with the numbered picture guide. Each number identifies the exact highlighted control. Work through one step at a time; the longer reference is below it.

### Actual tool · controls at a glance

Actual application screenshot. Numbered boxes point to the controls described below. 

![Parts Bench — numbered controls](images/guide-1.jpg)

1. **Choose material.** Select a specific spool or a generic material before comparing settings.
2. **Match the hotend.** Use the nozzle and hotend that will actually print the part.
3. **Keep the comparison.** Save a named configuration, then compare alternatives in Compare.

### Try the working offline example

Screenshot of this project’s interactive demo. Side-by-side services are explicitly simulated.

![Parts Bench — numbered controls](images/guide-2.jpg)

1. **Match material and nozzle.** These affect the example settings; they are not a measured calibration.
2. **Try the guarded launch.** It waits until the dummy filament, bed and sliced-file checks are complete.
3. **Track the job outcome.** This printer is fictional. No machine or slicer receives a command.

## Detailed task reference

### Create traceable material and part records

1. Start in Library. Add a spool or import a supported filament profile; record the batch instead of treating all spools of a product as interchangeable.
2. In Parts, upload the intended STL or 3MF and review extracted metadata and preview. Keep a new revision as a version, not an unrelated overwrite.
3. Review printer/nozzle and part bounds when present. A model-only file is not a ready-to-launch sliced job.

### Compare a starting configuration

1. Open Recommend. Choose the specific spool or generic material, printer, hotend/nozzle and goal. Enter layer height, width and the representative part dimensions/path values.
2. Read the operating point and physics/cooling checks. Expand the derivation rather than treating the output as a measured calibration.
3. Save as configuration, change one assumption and save another named configuration. Use Compare to see the differences.
4. Validate the proposed settings on a suitable test before using them for an important production part.

### Record a print and investigate a failure

1. Create a print record against the exact part version and spool batch used, retaining the hotend and settings snapshot.
2. Use Diagnose with the actual observed symptom; inspect ranked causes in the context of the assumed maintained machine.
3. Record the result and any measured changes. A later edit to a spool or recommendation should not rewrite what was used for an earlier print.

### Use integrated print jobs only when configured

1. Open Print jobs and inspect the sliced-file identity, target printer and filament requirements. Library upload alone does not imply a physical launch.
2. Resolve missing or ambiguous loaded-spool matches and confirm the actual bed, plate, material and nozzle before dispatch.
3. Treat uncertain launch results as uncertain. Do not automatically retry a command that may already have started a machine.
4. The demo’s printer panel is simulated. This documentation update does not launch a real printer or establish the live integration’s current readiness.

## Keep your work

The library owns its model-folder layout, metadata and database. Back up the complete root including _bench, not only the visible STL files. Browser drafts and saved shared records are different. Print-job snapshots/attempt history need their own preserved storage.

## If something looks wrong

- Missing preview/metadata: plain STL lacks slicer settings; inspect the actual uploaded format.
- Recommendation seems high: check material, hotend, layer width/height and cooling assumptions.
- Changed folder name: part/category renaming intentionally moves the managed folder.
- Launch waiting: resolve filament/connection/compatibility guards; do not bypass them.

## What this manual does not promise

Source was split from a private checkpoint while print-job integration was still evolving. Read the retained implementation notes before deploying. This is not a clean-machine or physical-print validation of the newer integration.

Screenshots show the actual application where captured. The offline demo is a deliberately smaller simulation and identifies its dummy services. It never controls devices, sends notifications, uploads files or launches printing.
