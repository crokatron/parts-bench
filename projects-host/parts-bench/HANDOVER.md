# Parts Bench — handover

Built 2–3 September 2026. Both deliverables work and were tested. This is the
narrative record; `START-HERE.md` is the orientation, `spec/` is the data.

---

## What exists

**Parts Bench** — the self-hosted one, and the intended home. Python 3 server
plus browser UI, runs on a Windows PC attached to a NAS, open on the LAN with no
login. Zero third-party packages.

- `app.py` — 884 lines: HTTP, SQLite, 3MF/STL parsing, thumbnail rendering, filing
- `web/app.js` — 2,925 lines: the whole UI and physics engine
- `web/app.css` 404 · `web/index.html` 285

**Filament Bench** — the original, published as a Claude Artifact with a hosted
database. Single file, 3,910 lines. Same features except file storage: that
runtime has no asset store, which is the whole reason the self-hosted version
exists. Still live; treat as read-only.

Nothing syncs between them.

---

## Nine tabs

| Tab | Holds | Worth knowing |
|---|---|---|
| Library | Filament spools by brand, type, colour, batch | Batch is the unit of truth. 7-step quality scale, wording editable |
| Parts | Parts, model files, versions, print records | 3MF metadata extraction; STL previews rendered from the mesh |
| Recommend | Computed parameters with full derivation | Every figure calculated, not looked up |
| Compare | Saved configurations side by side | Recomputed live; first column is the reference |
| Diagnose | 27 symptoms, 91 ranked causes | Weighted for a maintained machine |
| Hotends | Hotend/nozzle combinations incl. Revo and aftermarket | Logs kg through each nozzle against bore life |
| History | Field-level change log | Diffed on save; an unchanged save records nothing |
| Storage | Library root, sizes, missing files, folder importer | Self-hosted only |
| Reference | Model docs, material constants, machine specs | Also where the quality-scale wording is edited |

---

## What was actually verified

| Area | Result |
|---|---|
| Flow model against published data | 22/22 within 10%, worst 8.8% |
| STL geometry | 20 mm cube → 20 × 20 × 20 mm, 8000.0 mm³ exactly |
| Bambu 3MF extraction | C13, 0.4 mm, 5460 s, 23.45 g, PLA 23.24 g, 22 of 82 settings keys |
| Plain 3MF fallback | Renders from mesh, warns that slicer metadata is absent |
| Print records and history | 15-key parameter snapshot; only changed fields logged |
| Typing and focus | Every field holds focus and keeps the full string |
| Range validation | 19/20 cases; the miss is a browser-discarded numeric entry, benign |
| Draft persistence | Survives close, tab switch and full page reload |
| Layout overflow | Zero at 1440 / 1180 / 1024 / 760 px on every view |
| Self-hosted end to end | Upload, filing, folder move, verify, import, restart all intact |

---

## Bugs found and fixed

Recorded with causes, because each is a pattern that could recur.

**Typing lost focus after one character.** The brand and colour fields rebuilt
the whole panel on every keystroke to keep the heading in sync, replacing the
input being typed into. Fixed by updating the heading in place; a focus
capture/restore helper now wraps every rebuild as a safety net.

**Saving created two records.** An old `addEventListener` on the Save button
survived alongside the newer `onclick` that replaced it, so both fired — one
with an uncleaned draft object. Mixing the two does not overwrite.

**The derivation panel covered neighbouring tiles.** The block is
`white-space: pre`, and a grid item's default `min-width: auto` let it push its
track wider than the column instead of scrolling inside it.

**Model under-predicted high-flow PETG and ASA by 20–29%.** Caught by testing
against published data rather than trusting the first fit. A single diameter
exponent cannot describe both conduction-limited and viscosity-limited
materials. Fixed with per-material exponents and a high-flow response factor.

**Spurious "unsaved edits" flags and empty draft rows.** Opening a record and
closing it wrote an identical draft; each Add click spawned a fresh empty one.
Drafts are now compared against the saved record and dropped when identical.

---

## Open items

Nothing here is broken. These are known limits and deliberate omissions.

| Item | Status | Note |
|---|---|---|
| No authentication | by choice | Fine behind the firewall. Do not port-forward it |
| No backup of `bench.db` | **gap** | Sits in `_bench/`. Include it in whatever backs up the share |
| `compatible_printers` strings for H2S/H2C | **unverified** | Follow the documented pattern but were never checked against a real install. If an exported profile imports but never appears in the filament list, this is why |
| Material constants beyond PLA/PETG/ASA | typicals | Measure and record per spool; the model re-anchors from one figure |
| Large STL upload latency | expected | Pure-Python rendering, a couple of seconds for 200k triangles, once per upload |
| Parts library opens empty | by choice | No fabricated example parts |
| Drafts are per browser | by design | Unsaved entries in local storage; saved records shared by every device |
| Hosted and self-hosted data | diverging | Started clean by choice; no migration path built |

---

## Picking it up

1. **Run it and point it at the share.** Edit the `LIBRARY` line in
   `start.bat`, double-click. Map the share to a drive letter if the UNC path
   gives trouble.
2. **Import what already exists.** Storage → Import an existing folder. Skips
   duplicates by fingerprint, safe to run twice.
3. **Measure one flow figure per spool.** The highest-value habit — one
   measurement re-anchors every other nozzle and hotend prediction for that
   spool, moving the numbers from family typicals to the actual material.
4. **Log kg through each nozzle.** Bore wear is the failure a maintenance
   schedule will not catch: the machine reports nothing, dimensions drift, and
   the slicer gets blamed.
5. **Add `_bench/` to the backup.** Models can be re-imported from disk; the
   database cannot be rebuilt from anything else.
6. **Decide the hosted version's fate.** Keep it as a phone-side reference, or
   stop using it so the two cannot diverge further.

---

## Sources

Machine and material figures come from Bambu Lab's published specifications for
the H2S, H2C and X1 Carbon, the Bambu wiki volumetric-speed page, E3D's Revo
flow tables, and the filament presets shipped in the BambuStudio repository.
Profile key names are the real keys from those presets, not invented.
