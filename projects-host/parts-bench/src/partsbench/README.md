# Parts Bench

A local library for 3D printed parts, filament spools and print records. Runs
on one machine, opens in a browser, keeps every model file in a folder you
control.

Built for a Bambu fleet — X1C, H2S, H2C — plus custom Revo and aftermarket
hotends.

---

## Running it

You need Python 3.8 or newer. Nothing else: no pip install, no build step, no
internet connection required after the first page load.

**Windows.** Edit the `LIBRARY` line at the top of `start.bat` to point at
where the parts should live, then double-click it:

```bat
set LIBRARY=\\NAS\prints\PartsBench
```

A UNC path works, and so does a mapped drive (`Z:\PartsBench`). If Windows has
trouble with the UNC path, map the share to a drive letter first — that is the
more reliable option for a service that runs unattended.

**Anything else.** `./start.sh`, or `python3 app.py --root /mnt/nas/PartsBench`.

The console prints two addresses. Use `http://localhost:8770` on the machine
itself and the LAN address from any other device on the network.

There is no login. Anyone who can reach the port can use it, which is the right
trade for a workshop tool behind your own firewall — do not port-forward it.

### Making it start with Windows

Press `Win+R`, run `shell:startup`, and put a shortcut to `start.bat` in the
folder that opens. To run it without a console window, make the shortcut target
`pythonw.exe "C:\path\to\app.py" --root "..."` instead.

---

## How files are organised

The app owns the layout. Anything uploaded is filed as:

```
<library root>/
  Fixtures/
    Extruder idler bracket/
      part.json          <- plain-text index of versions and prints
      v1/bracket.3mf
      v2/bracket_rev2.3mf
  Spares/
    AMS hub cover/
      v1/cover.stl
  _bench/
    bench.db             <- SQLite database
    thumbs/              <- rendered previews
```

Rename a part or change its category and the folder moves to match. The
`part.json` in each folder lists that part's versions, fingerprints and print
history in readable text, so the tree still makes sense to anyone browsing the
share without the app.

`_bench` holds the database and thumbnails. Back that folder up along with the
models; everything else can be rebuilt from the files themselves.

---

## What it reads out of a 3MF

A 3MF is a ZIP archive, and a Bambu Studio project keeps a lot inside it. On
upload the server reads:

- `Metadata/plate_1.png` — the slicer's own plate render, used as the preview
- `slice_info.config` — filament grams and metres, print time, printer model,
  nozzle diameter, per-filament colour and type
- `project_settings.config` — every slicer key, with the two dozen that drive
  the result surfaced in the UI
- `3D/3dmodel.model` — the mesh, for bounding box and solid volume

A plain STL or a non-Bambu 3MF has none of that metadata, so the preview is
rendered from the mesh instead: an orthographic three-quarter view, z-buffered
with flat lambert shading, drawn in pure Python. You still get bounding box,
solid volume and triangle count, and the bounding box is checked against each
printer's build volume.

---

## The rest of it

**Spool library** — brand, type, colour, batch, with a 7-step quality scale
whose wording you define. Bambu Studio filament profiles import and export as
JSON, and any profile key can be set on the Advanced tab.

**Parameter recommendation** — computed, not looked up. The flow model runs on
one physical parameter per hotend, an effective melt-zone volume, scaled by
nozzle diameter and class. It reproduces E3D's published Revo figures and
Bambu's own maximum volumetric speeds within 9%. Heater power, melt residence
time and extruder force are checked independently, and the derivation panel
shows the substituted arithmetic.

**Compare** — saved configurations side by side, recomputed live, with every
cell that differs from the first column marked.

**Diagnose** — symptom-driven fault ranking weighted for a maintained machine:
consumable wear, moisture and parameter drift first, kinematics last.

**Prints** — each record captures the part version, the exact spool and batch,
the hotend, and a frozen snapshot of the parameters in force at the time.

**History** — every save is diffed against what was there before and only the
fields that actually moved are logged.

**Storage** — what is on disk, what is missing, and an importer that walks an
existing folder tree and files everything under it. Duplicates are recognised
by fingerprint, so running it twice is safe.

---

## Notes

- Data lives in `_bench/bench.db`. To move the library, move the whole root
  folder and point `--root` at the new location.
- Config is remembered in `config.json` next to `app.py`.
- Drafts of part-finished entries are kept in the browser, per browser. Saved
  records live in the database and are shared by every device.
- Thumbnail rendering is pure Python, so a 200,000-triangle STL takes a couple
  of seconds on upload. Meshes are decimated above 40,000 triangles for the
  render only; measurements use the full mesh.
