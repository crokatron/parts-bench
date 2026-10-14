> **Historical September base-library document.** The original text below is preserved as history. Its runtime, no-login, dependency and deployment claims are superseded for the NAS edition. Continue with the [current summary](../../docs/START-HERE.md) and [current handover](../../docs/HANDOVER.md), checked 14 October 2026.

---

# START HERE — Parts Bench handover

You are picking up a working project. Read this file first; it is written to
orient you completely without needing the rest of the pack.

---

## What this is

A local library for a small 3D-printing operation running **Bambu Lab X1C, H2S
and H2C** printers, plus custom **BIQU/E3D Revo** and aftermarket hotends. It
does five things:

1. **Filament spools** — brand, type, colour and **batch**, with a 7-step
   quality rating. Batch is the unit of truth: two lots of the same SKU do not
   print identically.
2. **Printed parts** — 3MF and STL files, versioned, with thumbnails and every
   scrap of metadata that can be extracted from them.
3. **Print records** — each one links a part *version* to the exact spool and
   batch, the hotend, and a frozen snapshot of the parameters in force at the
   time.
4. **Parameter recommendation** — computed from a physical model, not looked
   up, with the substituted arithmetic shown to the user.
5. **Fault diagnosis** — 27 symptoms, 91 ranked causes, weighted for a
   competent technician on a well-maintained machine.

Plus a field-level change history over everything.

## Two builds exist

| | **Parts Bench** (current) | **Filament Bench** (hosted) |
|---|---|---|
| Where | `src/partsbench/` — self-hosted | `src/filament-bench.html` — one file |
| Runs on | A Windows PC attached to a NAS, browser UI on the LAN | Published as a Claude Artifact with a hosted database |
| Files | Stores the real 3MF/STL on disk | **Cannot** — that runtime has no asset store |
| Status | The intended home | Still live; treat as read-only |

They share the physics engine and the diagnostic corpus. Nothing syncs between
them; the self-hosted database started clean by choice.

## Run it

```
cd src/partsbench
python3 app.py --root /path/to/library --port 8770
```

Python 3.8+ and **nothing else** — no pip install, no build step, no npm. That
is deliberate; see `spec/decisions.md`.

On Windows: edit the `LIBRARY` line in `start.bat` and double-click it.

## The owner's context

- Printers are on a strict maintenance schedule. Faults are rarely mechanical
  beyond a worn or clogged nozzle — the diagnostic ranking reflects this.
- Assume a competent advanced technician as the user. Do not write beginner
  hand-holding; do explain *why* a parameter moves.
- The owner asked for the app to **own the on-disk folder layout**, so renaming
  a part moves its folder. That is intended behaviour.

---

## Read next, in this order

| File | What it gives you |
|---|---|
| `spec/decisions.md` | Decisions already settled. **Read before changing anything** — several are constraints, not preferences. |
| `spec/invariants.md` | What must stay true, and how to check each one. |
| `spec/model.json` | The physics model as data: constants, formulas, 3 printers, 4 hotend bodies, 21 materials. |
| `spec/calibration.json` | 22 published reference points the model must reproduce. |
| `spec/api.json` | The server's HTTP contract and the on-disk layout. |
| `spec/diagnostics.json` | The full symptom/cause corpus with its weighting rules. |
| `HANDOVER.md` | Narrative history: what was built, what was verified, what is open. |
| `MANIFEST.json` | Every file in the pack with its purpose. |

## Verify you have not broken the model

```
python3 tests/verify-model.py
```

Reads `spec/model.json` and `spec/calibration.json`, recomputes all 22
reference points, and fails loudly if any drifts past 10%. Dependency-free —
it runs anywhere Python does. **Run this after any change to the flow model.**

Browser regressions live in `tests/*.mjs` (Playwright). They are optional; the
model check is not.

---

## The one thing to understand about the model

Flow ceiling is a **melt-rate** problem, not an orifice problem. E3D's own
published figures go 13 → 14 → 17 mm³/s from 0.4 to 0.8 mm in PLA on a standard
nozzle — barely any gain — while a high-flow nozzle nearly doubles over the same
range. That difference is melt-zone volume, not hole size.

So each hotend carries **one physical parameter**, an effective melt volume at
0.4 mm, and everything derives from it:

```
V_eff  = V0 * (D/0.4)^e
Q_melt = A_material * highFlowResponse * V_eff * spoolFlowFactor
Q_max  = min(Q_melt, hotend rating)
```

The exponent `e` is **per material**. PLA gains strongly with bore size because
its ceiling is conduction and latent-heat limited (e = 0.39 standard, 0.82 high
flow). ASA barely gains because its ceiling is viscosity limited (0.18 / 0.38) —
a bigger hole does not fix viscosity. Getting this wrong is how the first fit
under-predicted high-flow PETG and ASA by 20–29%.

Three further checks run independently of the ceiling and can each veto an
operating point: heater power against budget, melt residence time (want > 2 s),
and extruder force from a power-law melt through the nozzle land.

### Where the model stops being calibrated

Published anchors exist only for **PLA, PETG and ASA on Revo hardware**, plus
four Bambu PLA figures. Every filled grade, every engineering polymer and
anything past 0.8 mm is the model reasoning outward. Material constants outside
those three are polymer-family typicals, not measurements.

This is why the tool is built to absorb **one measured flow figure per spool**
and re-anchor every other hotend and nozzle combination from it. If you are
extending this, that path matters more than the defaults do.

Be honest about this distinction with the owner. Do not present extrapolated
numbers as measured ones.

---

## Traps that already caught someone

- **Never rebuild an editor panel on a keystroke** — it replaces the input being
  typed into and focus is lost after one character.
- **Never mix `addEventListener` and `onclick`** on the same element. They do
  not overwrite; both fire. This made every save create two records.
- **Grid children need `min-width: 0`** or a `white-space: pre` block pushes its
  track wider than the column instead of scrolling inside it.
- **`crypto.subtle` does not exist over plain http to a LAN address.** Anything
  cryptographic must stay server-side or it will work only on the host machine.
- **Do not use glass transition as a drying limit.** Nylon dries at 90–100 °C,
  well above its ~60 °C Tg. Use `dryMaxC` from `model.json`.
