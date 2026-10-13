# NAS print workflow — in progress

Use the existing Parts Bench handover as the catalogue. Preserve its part/version,
spool, hotend, recommendation and print record functions. The NAS owns the model
files and database; Bambu Studio remains the slicer on the PC.

Required additions:

- A Print jobs view containing immutable sliced-file snapshots and their settings.
- Separate attempts for each launch/relaunch, with status correlated to the exact
  uploaded filename. An uncertain launch must never automatically retry.
- Authenticated NAS storage and a narrowly scoped Home Assistant integration.
- Explicit bed-clear and filament/plate confirmation, live online/idle checks,
  Developer LAN mode and nozzle compatibility before dispatch.
- Model-only files remain in the library and cannot be launched without slicing.
- Upload jobs to unique printer paths; never overwrite or delete existing card files.
- Preserve full metadata, file hashes and print history across later part edits.
- Tests for persistence, isolation, duplicate requests and physical launch guards,
  then a scoped publish preserving the exact active NAS release and saved designs.

User refinements during implementation:

- Clicking Print/Upload & Print in Orca must send to the NAS and automatically
  start the printer after cataloguing; manual browser export/upload is not the
  primary workflow. Use Orca's authenticated OctoPrint-compatible print-host
  protocol with 3MF enabled, retaining X1C printer/start/end profiles.
- Match required filaments against live AMS and external-spool attributes.
  Ambiguous/missing matches remain saved and waiting; notify the owner's HA phone
  (`mobile_app_s25u_leras`) with a link to select from the available loaded spools.
  Recheck the chosen spool identities immediately before dispatch.
- A change of material requires re-slicing, not just changing AMS mapping or
  temperature. Orca's official CLI supports headless slicing with printer,
  process and filament profiles. Retain the original geometry-bearing project
  separately from the immutable sliced print file. A NAS worker remains to be
  installed and verified; do not claim it is already available.

Completed locally: conservative filament matching module and nine tests covering
exact/ambiguous matches, missing/incompatible sources, spool swaps, conventional
AMS TPU restrictions and isolation from other printers. Nothing from Parts Bench
has been published yet.

Connection verified 13 October 2026: X1C 192.168.0.145, firmware 01.12.00.00,
Developer LAN mode enabled, encrypted local MQTT online, camera reporting streaming.
Home Assistant currently reports a 0.6 mm nozzle. A printer HMS diagnostic is active;
inspect it before the first print. No physical test print has been started.

This file records the implementation direction, not a completed or published feature.
