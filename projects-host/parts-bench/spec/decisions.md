# Decisions already made

These were settled with the owner or forced by a constraint. Re-opening them
without being asked wastes effort and, in a couple of cases, breaks something
that currently works.

## Chosen by the owner

| Decision | Choice | Consequence |
|---|---|---|
| Where it runs | Self-hosted on a Windows PC attached to a NAS, browser UI on the LAN | Not unraid, not Docker, not cloud |
| File organisation | **The app owns the layout** — it moves and renames files into its own structure | Renaming a part moves its folder; this is intended, not a bug |
| Access control | **None.** Open on the LAN | Do not add a login unless asked. Do not port-forward it either |
| Existing hosted data | **Start clean** | No migration path was built; the two datasets diverge by design |
| Parameter depth | Core fields by default, an Advanced panel exposing any Bambu Studio key, JSON import and export both ways | Defaults come from generic profiles; the user only enters deltas |
| Quality rating | 7 steps, each with wording the owner defines | Not 5, not 10 — five collapses the middle, ten invites false precision |

## Forced by a constraint

- **No third-party Python packages.** The target is a Windows box; every
  dependency is a way for the install to fail silently. Everything is stdlib:
  `http.server`, `sqlite3`, `zipfile`, `hashlib`, `struct`, `zlib`, `xml`.
  This is why thumbnails are rendered by hand rather than with Pillow, and why
  the PNG encoder is written out longhand.

- **Thumbnails render server-side in pure Python.** Orthographic three-quarter
  view, z-buffered, flat lambert shading. Meshes are decimated above 40,000
  triangles for the render only; measurements always use the full mesh.

- **File hashing is server-side.** `crypto.subtle` only exists in a secure
  context. Hashing in the browser works on `localhost` and fails on every other
  device on the LAN, silently. Do not move it back to the client.

- **Uploads use a raw body, not multipart.** Writing a multipart parser with no
  dependencies was not worth it. The filename travels in the query string.

- **The hosted artifact cannot store files.** That account's artifact runtime
  has no asset store, which is the entire reason the self-hosted version exists.
  The hosted build keeps thumbnails, extracted metadata and fingerprints only.

## Model decisions

- **The diameter exponent is per material, not universal.** A single exponent
  under-predicted high-flow PETG and ASA by 20–29%. PLA gains strongly with bore
  size because its ceiling is conduction and latent-heat limited; ASA barely
  gains because its ceiling is viscosity limited. See `model.json` → notes.

- **`dryMaxC` is a safe drying ceiling, not the glass transition.** A Tg-based
  rule gets semi-crystallines badly wrong — nylon is routinely dried at
  90–100 °C, well above its ~60 °C Tg, and stays dimensionally stable through
  crystallinity. A Tg rule would block correct practice while still permitting
  70 °C on PLA, which welds the spool wraps together.

- **Diagnosis demotes mechanical causes.** The fleet is on a strict maintenance
  schedule, so consumable wear, moisture and parameter drift rank first and
  kinematics last. This is a deliberate weighting, not an oversight.

- **The parts library opens empty.** No fabricated example parts — an empty
  shelf is clearer than invented records.
