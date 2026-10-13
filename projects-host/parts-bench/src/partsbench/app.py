#!/usr/bin/env python3
"""
Parts Bench - a local library for 3D printed parts, filament and print records.

Runs on one machine and serves a browser UI to the LAN. No third-party
packages: everything here is Python's standard library, so there is no pip
step to go wrong on a Windows box.

    python app.py                      first run writes config.json
    python app.py --root "D:/Prints"   set the library root explicitly
    python app.py --port 8770 --host 0.0.0.0

The library root is the app's own territory: uploaded models are filed into
<root>/<Category>/<Part>/v<n>/<file> and renaming a part moves its folder.
The database lives at <root>/_bench/bench.db.
"""

import argparse, hashlib, http.server, io, json, math, mimetypes, os, re, shutil
import socket, sqlite3, struct, sys, threading, time, urllib.parse, xml.etree.ElementTree as ET
import zipfile, zlib
from datetime import datetime, timezone

APP_DIR   = os.path.dirname(os.path.abspath(__file__))
WEB_DIR   = os.path.join(APP_DIR, "web")
CONFIG    = os.path.join(APP_DIR, "config.json")
MESH_EXT  = {".stl", ".3mf"}
THUMB_PX  = 320
RENDER_TRI_CAP = 40000      # decimation ceiling for the software renderer
PARSE_TRI_CAP  = 400000     # ceiling for measuring geometry

def now(): return datetime.now(timezone.utc).isoformat(timespec="seconds")
def uid(): return hashlib.sha1((str(time.time()) + os.urandom(6).hex()).encode()).hexdigest()[:12]

# ---------------------------------------------------------------- config ----
def load_config(args):
    cfg = {"root": "", "port": 8770, "host": "0.0.0.0"}
    if os.path.exists(CONFIG):
        try: cfg.update(json.load(open(CONFIG, "r", encoding="utf-8")))
        except Exception: pass
    if args.root: cfg["root"] = args.root
    if args.port: cfg["port"] = args.port
    if args.host: cfg["host"] = args.host
    if not cfg["root"]:
        cfg["root"] = os.path.join(os.path.expanduser("~"), "PartsBench")
    cfg["root"] = os.path.abspath(cfg["root"])
    json.dump(cfg, open(CONFIG, "w", encoding="utf-8"), indent=2)
    return cfg

# -------------------------------------------------------------- database ----
SCHEMA = """
CREATE TABLE IF NOT EXISTS spools  (id TEXT PRIMARY KEY, data TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS hotends (id TEXT PRIMARY KEY, data TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS configs (id TEXT PRIMARY KEY, data TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS parts   (id TEXT PRIMARY KEY, data TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY, part_id TEXT, data TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS prints  (id TEXT PRIMARY KEY, data TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY, kind TEXT, target_id TEXT,
                                    name TEXT, entries TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS meta    (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS versions_part ON versions(part_id);
"""
COLLECTIONS = {"spools", "hotends", "configs", "parts", "prints"}
_local = threading.local()

def db():
    if not hasattr(_local, "conn"):
        _local.conn = sqlite3.connect(DB_PATH, timeout=15)
        _local.conn.row_factory = sqlite3.Row
        _local.conn.execute("PRAGMA journal_mode=WAL")
    return _local.conn

def rows(table, where="", args=()):
    return [dict(json.loads(r["data"]), id=r["id"])
            for r in db().execute(f"SELECT id, data FROM {table} {where}", args)]

def put(table, rid, obj):
    body = {k: v for k, v in obj.items() if k != "id"}
    db().execute(f"INSERT INTO {table}(id,data,updated) VALUES(?,?,?) "
                 f"ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated=excluded.updated",
                 (rid, json.dumps(body), now()))
    db().commit()

def get_one(table, rid):
    r = db().execute(f"SELECT id, data FROM {table} WHERE id=?", (rid,)).fetchone()
    return dict(json.loads(r["data"]), id=r["id"]) if r else None

def drop(table, rid):
    db().execute(f"DELETE FROM {table} WHERE id=?", (rid,)); db().commit()

# --------------------------------------------------------------- history ----
HIST_CAP  = 80
HIST_SKIP = {"id", "updated", "_pending", "_started", "thumb", "settingsAll"}

def flatten(o, prefix="", out=None):
    out = {} if out is None else out
    if not isinstance(o, dict): return out
    for k, v in o.items():
        if not prefix and k in HIST_SKIP: continue
        if k in ("thumb", "settingsAll"): continue
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict): flatten(v, key, out)
        elif isinstance(v, list): out[key] = ", ".join(str(x) for x in v)
        else: out[key] = v
    return out

def diff(before, after):
    A, B = flatten(before or {}), flatten(after or {})
    out = []
    for k in sorted(set(A) | set(B)):
        a, b = A.get(k), B.get(k)
        a = None if a in ("", None) else str(a)
        b = None if b in ("", None) else str(b)
        if a == b: continue
        out.append({"f": k, "a": (a or "—")[:120], "b": (b or "—")[:120]})
        if len(out) >= 40: break
    return out

def log_change(kind, target_id, name, action, before, after):
    changes = diff(before, after) if action == "update" else []
    if action == "update" and not changes: return
    entry = {"ts": now(), "action": action, "changes": changes,
             "n": len(changes) if action == "update" else 0}
    key = f"{kind}_{target_id}"
    r = db().execute("SELECT entries, name FROM history WHERE id=?", (key,)).fetchone()
    ents = json.loads(r["entries"]) if r else []
    name = name or (r["name"] if r else target_id)
    ents = ([entry] + ents)[:HIST_CAP]
    db().execute("INSERT INTO history(id,kind,target_id,name,entries,updated) VALUES(?,?,?,?,?,?) "
                 "ON CONFLICT(id) DO UPDATE SET name=excluded.name, entries=excluded.entries, "
                 "updated=excluded.updated",
                 (key, kind, target_id, name, json.dumps(ents), entry["ts"]))
    db().commit()

def record_name(kind, obj):
    if not obj: return ""
    if kind == "spools":
        bits = [obj.get("brand", ""), obj.get("type", ""), obj.get("colorName", "")]
        b = obj.get("batch")
        return " ".join(x for x in bits if x).strip() + (f" [{b}]" if b else "")
    return obj.get("name") or obj.get("label") or ""

# =============================================================== geometry ====
def parse_stl(buf):
    """Binary or ASCII STL to a flat list of 9 floats per triangle."""
    tris = []
    if len(buf) >= 84:
        n = struct.unpack_from("<I", buf, 80)[0]
        if len(buf) == 84 + n * 50:
            take = min(n, PARSE_TRI_CAP)
            step = n / take if take else 1
            for i in range(take):
                off = 84 + int(i * step) * 50 + 12
                tris.extend(struct.unpack_from("<9f", buf, off))
            return tris, n, n > take, "binary STL"
    txt = buf.decode("utf-8", "replace")
    vals = re.findall(r"vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)", txt)
    n = len(vals) // 3
    take = min(n, PARSE_TRI_CAP)
    step = n / take if take else 1
    for i in range(take):
        base = int(i * step) * 3
        for k in range(3):
            tris.extend(float(x) for x in vals[base + k])
    return tris, n, n > take, "ASCII STL"

def _strip_ns(tag): return tag.split("}")[-1]

def parse_3mf_mesh(xml_bytes):
    """Vertices and triangles out of 3D/3dmodel.model, honouring build transforms."""
    try: root = ET.fromstring(xml_bytes)
    except Exception: return None
    objects, items = {}, []
    for obj in root.iter():
        if _strip_ns(obj.tag) != "object": continue
        oid = obj.get("id")
        verts, faces = [], []
        for el in obj.iter():
            t = _strip_ns(el.tag)
            if t == "vertex":
                verts.append((float(el.get("x")), float(el.get("y")), float(el.get("z"))))
            elif t == "triangle":
                faces.append((int(el.get("v1")), int(el.get("v2")), int(el.get("v3"))))
        if verts and faces: objects[oid] = (verts, faces)
    for el in root.iter():
        if _strip_ns(el.tag) == "item":
            items.append((el.get("objectid"), el.get("transform")))
    placed = [(objects[o], t) for o, t in items if o in objects] or \
             [(v, None) for v in objects.values()]
    if not placed: return None

    def xf(m, p):
        if not m: return p
        x, y, z = p
        return (m[0]*x + m[3]*y + m[6]*z + m[9],
                m[1]*x + m[4]*y + m[7]*z + m[10],
                m[2]*x + m[5]*y + m[8]*z + m[11])

    total = sum(len(f) for (v, f), _ in placed)
    take  = min(total, PARSE_TRI_CAP)
    step  = total / take if take else 1
    tris, seen, nxt = [], 0, 0.0
    for (verts, faces), tstr in placed:
        m = None
        if tstr:
            nums = [float(x) for x in tstr.split()]
            if len(nums) == 12: m = nums
        for f in faces:
            if seen < nxt: seen += 1; continue
            seen += 1; nxt += step
            for idx in f: tris.extend(xf(m, verts[idx]))
    return tris, total, total > take, "3MF mesh", len(placed)

def mesh_stats(tris):
    if not tris: return None
    xs, ys, zs = tris[0::3], tris[1::3], tris[2::3]
    vol = 0.0
    for i in range(0, len(tris), 9):
        ax, ay, az, bx, by, bz, cx, cy, cz = tris[i:i+9]
        vol += (ax*(by*cz - bz*cy) - ay*(bx*cz - bz*cx) + az*(bx*cy - by*cx)) / 6.0
    return {"bbox": [max(xs)-min(xs), max(ys)-min(ys), max(zs)-min(zs)],
            "min": [min(xs), min(ys), min(zs)], "volume": abs(vol)}

# ------------------------------------------------------- PNG + rasteriser ----
def write_png(width, height, pixels):
    """pixels: bytearray of RGB triples, row-major."""
    raw = bytearray()
    stride = width * 3
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y*stride:(y+1)*stride])
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 6))
            + chunk(b"IEND", b""))

def render_mesh_png(tris, px=THUMB_PX, base=(74, 122, 145), bg=(240, 243, 245)):
    """Orthographic three-quarter view, z-buffered, flat lambert shading."""
    st = mesh_stats(tris)
    if not st: return None
    n = len(tris) // 9
    if n > RENDER_TRI_CAP:
        step = n / RENDER_TRI_CAP
        pick = []
        for i in range(RENDER_TRI_CAP):
            o = int(i * step) * 9
            pick.extend(tris[o:o+9])
        tris = pick
        n = RENDER_TRI_CAP

    cx = st["min"][0] + st["bbox"][0] / 2
    cy = st["min"][1] + st["bbox"][1] / 2
    cz = st["min"][2] + st["bbox"][2] / 2
    yaw, pit = math.pi / 6, math.pi / 7
    cyaw, syaw = math.cos(yaw), math.sin(yaw)
    cpit, spit = math.cos(pit), math.sin(pit)

    pts = []
    for i in range(0, len(tris), 9):
        tri = []
        for k in range(3):
            x = tris[i+k*3] - cx; y = tris[i+k*3+1] - cy; z = tris[i+k*3+2] - cz
            X = x*cyaw - y*syaw
            Y = x*syaw + y*cyaw
            tri.append((X, Y*spit - z*cpit, Y*cpit + z*spit))
        pts.append(tri)
    xs = [p[0] for t in pts for p in t]; ys = [p[1] for t in pts for p in t]
    minX, maxX, minY, maxY = min(xs), max(xs), min(ys), max(ys)
    pad = px * 0.09
    sc = min((px - pad*2) / max(maxX - minX, 1e-9), (px - pad*2) / max(maxY - minY, 1e-9))
    ox = (px - (maxX - minX) * sc) / 2 - minX * sc
    oy = (px - (maxY - minY) * sc) / 2 - minY * sc

    img = bytearray(bg * (px * px))
    depth = [-1e30] * (px * px)
    L = (-0.42, -0.55, 0.72)

    for tri in pts:
        (x1, y1, z1), (x2, y2, z2), (x3, y3, z3) = tri
        ux, uy, uz = x2-x1, y2-y1, z2-z1
        vx, vy, vz = x3-x1, y3-y1, z3-z1
        nx, ny, nz = uy*vz - uz*vy, uz*vx - ux*vz, ux*vy - uy*vx
        ln = math.sqrt(nx*nx + ny*ny + nz*nz) or 1.0
        nx, ny, nz = nx/ln, ny/ln, nz/ln
        if nz <= 0: continue                       # back face
        lam = 0.36 + 0.64 * max(0.0, nx*L[0] + ny*L[1] + nz*L[2])
        col = (int(base[0]*lam), int(base[1]*lam), int(base[2]*lam))

        sx1, sy1 = x1*sc + ox, y1*sc + oy
        sx2, sy2 = x2*sc + ox, y2*sc + oy
        sx3, sy3 = x3*sc + ox, y3*sc + oy
        lo_x = max(0, int(min(sx1, sx2, sx3)));  hi_x = min(px-1, int(max(sx1, sx2, sx3)) + 1)
        lo_y = max(0, int(min(sy1, sy2, sy3)));  hi_y = min(px-1, int(max(sy1, sy2, sy3)) + 1)
        if hi_x < lo_x or hi_y < lo_y: continue
        den = (sy2-sy3)*(sx1-sx3) + (sx3-sx2)*(sy1-sy3)
        if abs(den) < 1e-12: continue
        for yy in range(lo_y, hi_y + 1):
            for xx in range(lo_x, hi_x + 1):
                pxc, pyc = xx + 0.5, yy + 0.5
                w1 = ((sy2-sy3)*(pxc-sx3) + (sx3-sx2)*(pyc-sy3)) / den
                if w1 < 0 or w1 > 1: continue
                w2 = ((sy3-sy1)*(pxc-sx3) + (sx1-sx3)*(pyc-sy3)) / den
                if w2 < 0 or w2 > 1: continue
                w3 = 1.0 - w1 - w2
                if w3 < 0: continue
                d = w1*z1 + w2*z2 + w3*z3
                o = yy*px + xx
                if d <= depth[o]: continue
                depth[o] = d
                b = o*3
                img[b], img[b+1], img[b+2] = col
    return write_png(px, px, img)

# ------------------------------------------------- Bambu project metadata ----
SETTINGS_KEEP = ["layer_height","initial_layer_print_height","line_width","wall_loops",
  "sparse_infill_density","sparse_infill_pattern","top_shell_layers","bottom_shell_layers",
  "nozzle_temperature","nozzle_temperature_initial_layer","hot_plate_temp","chamber_temperatures",
  "filament_type","filament_settings_id","print_settings_id","printer_settings_id",
  "nozzle_diameter","filament_max_volumetric_speed","enable_support","brim_type",
  "sparse_infill_speed","outer_wall_speed"]

def first_of(v): return v[0] if isinstance(v, list) and v else v

def parse_slice_info(xml_bytes):
    try: root = ET.fromstring(xml_bytes)
    except Exception: return None
    out = {"plates": [], "filaments": [], "client": ""}
    for h in root.iter("header_item"):
        if "Version" in (h.get("key") or ""): out["client"] = h.get("value") or ""
    for pl in root.iter("plate"):
        md = {m.get("key"): m.get("value") for m in pl.iter("metadata")}
        out["plates"].append({
            "index": md.get("index"), "printerModel": md.get("printer_model_id"),
            "nozzle": md.get("nozzle_diameters"),
            "seconds": int(md["prediction"]) if md.get("prediction", "").isdigit() else None,
            "weightG": float(md["weight"]) if md.get("weight") else None,
            "supports": md.get("support_used") == "true",
            "objects": [o.get("name") for o in pl.iter("object") if o.get("name")]})
        for f in pl.iter("filament"):
            out["filaments"].append({
                "id": f.get("id"), "type": f.get("type"), "color": f.get("color"),
                "trayInfo": f.get("tray_info_idx"),
                "usedM": float(f.get("used_m") or 0), "usedG": float(f.get("used_g") or 0)})
    return out

def analyse(path, thumb_path):
    """Read a model file: fingerprint, geometry, slicer metadata, thumbnail."""
    with open(path, "rb") as fh: buf = fh.read()
    rec = {"fileName": os.path.basename(path), "fileType": os.path.splitext(path)[1].lstrip(".").lower(),
           "sizeBytes": len(buf), "sha256": hashlib.sha256(buf).hexdigest(),
           "uploadedAt": now(), "mesh": None, "slice": None, "settings": None,
           "settingsAll": None, "warnings": [], "thumbSource": None}
    ext = rec["fileType"]
    png = None

    if ext == "stl":
        tris, count, sampled, fmt = parse_stl(buf)
        if tris:
            st = mesh_stats(tris)
            rec["mesh"] = dict(st, triangles=count, sampled=sampled, format=fmt)
            png = render_mesh_png(tris); rec["thumbSource"] = "rendered from mesh"
        else:
            rec["warnings"].append("The mesh could not be read — the file may be truncated.")

    elif ext == "3mf":
        try: z = zipfile.ZipFile(io.BytesIO(buf))
        except Exception:
            rec["warnings"].append("Not a readable 3MF archive.")
            return rec, None
        names = z.namelist()
        def find(pat):
            for n in names:
                if re.search(pat, n, re.I): return n
            return None

        plate = find(r"Metadata/plate_1\.png$") or find(r"Metadata/plate_1_small\.png$") \
                or find(r"Metadata/thumbnail.*\.png$")
        if plate:
            try: png = z.read(plate); rec["thumbSource"] = "slicer plate render"
            except Exception: png = None

        si = find(r"slice_info\.config$")
        if si:
            try: rec["slice"] = parse_slice_info(z.read(si))
            except Exception: pass
        ps = find(r"project_settings\.config$") or find(r"Slic3r_PE\.config$")
        if ps:
            try:
                obj = json.loads(z.read(ps).decode("utf-8", "replace"))
                rec["settingsAll"] = obj
                rec["settings"] = {k: first_of(obj[k]) for k in SETTINGS_KEEP if k in obj}
            except Exception: pass

        mdl = find(r"3D/3dmodel\.model$") or find(r"\.model$")
        if mdl:
            try:
                parsed = parse_3mf_mesh(z.read(mdl))
                if parsed:
                    tris, count, sampled, fmt, nobj = parsed
                    st = mesh_stats(tris)
                    if st:
                        rec["mesh"] = dict(st, triangles=count, sampled=sampled,
                                           format=fmt, objects=nobj)
                        if png is None:
                            png = render_mesh_png(tris); rec["thumbSource"] = "rendered from mesh"
            except Exception:
                rec["warnings"].append("The mesh inside the 3MF could not be read; metadata was still captured.")
        if not rec["slice"] and not rec["settings"]:
            rec["warnings"].append("No slicer metadata inside — this looks like a plain 3MF export "
                                   "rather than a Bambu Studio project.")
    else:
        rec["warnings"].append(f".{ext} is not a mesh format this reads. "
                               "The fingerprint and size were still recorded.")

    if png:
        with open(thumb_path, "wb") as fh: fh.write(png)
        rec["thumb"] = True
    return rec, png

# ============================================================ filing =========
SLUG_BAD = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
def slug(s, fallback="untitled"):
    s = SLUG_BAD.sub("", (s or "").strip()).strip(". ")
    s = re.sub(r"\s+", " ", s)
    return (s or fallback)[:80]

def part_dir(part):
    cat = slug(part.get("category") or "Uncategorised", "Uncategorised")
    return os.path.join(ROOT, cat, slug(part.get("name"), "part-" + part["id"][:6]))

def ensure_dir(p): os.makedirs(p, exist_ok=True); return p

def unique_path(path):
    if not os.path.exists(path): return path
    stem, ext = os.path.splitext(path)
    i = 2
    while os.path.exists(f"{stem} ({i}){ext}"): i += 1
    return f"{stem} ({i}){ext}"

def write_sidecar(part):
    """A human-readable index inside the part folder, so the tree stands alone."""
    d = part_dir(part)
    if not os.path.isdir(d): return
    vs = rows("versions", "WHERE part_id=?", (part["id"],))
    vs.sort(key=lambda v: v.get("uploadedAt", ""))
    pr = [p for p in rows("prints") if p.get("partId") == part["id"]]
    doc = {"name": part.get("name"), "category": part.get("category"),
           "description": part.get("description"), "tags": part.get("tags", []),
           "id": part["id"], "updated": now(),
           "versions": [{"label": v.get("label"), "file": v.get("relPath"),
                         "sha256": v.get("sha256"), "uploaded": v.get("uploadedAt"),
                         "mesh": v.get("mesh"), "slicer": v.get("settings")} for v in vs],
           "prints": [{"date": p.get("date"), "outcome": p.get("outcome"),
                       "weightG": p.get("weightG"), "durationMin": p.get("durationMin"),
                       "notes": p.get("notes"), "parameters": p.get("snapshot")} for p in pr]}
    try:
        with open(os.path.join(d, "part.json"), "w", encoding="utf-8") as fh:
            json.dump(doc, fh, indent=2)
    except Exception: pass

def relocate_part(part, old_dir):
    """Rename or recategorise moves the folder; the app owns the layout."""
    new_dir = part_dir(part)
    if os.path.abspath(old_dir) == os.path.abspath(new_dir): return None
    if not os.path.isdir(old_dir): ensure_dir(new_dir); return None
    ensure_dir(os.path.dirname(new_dir))
    target = unique_path(new_dir)
    shutil.move(old_dir, target)
    for v in rows("versions", "WHERE part_id=?", (part["id"],)):
        if v.get("relPath"):
            tail = v["relPath"].split("/", 2)[-1] if v["relPath"].count("/") >= 2 else os.path.basename(v["relPath"])
            v["relPath"] = os.path.relpath(os.path.join(target, tail), ROOT).replace("\\", "/")
            body = {k: val for k, val in v.items() if k != "id"}
            db().execute("UPDATE versions SET data=?, updated=? WHERE id=?",
                         (json.dumps(body), now(), v["id"]))
    db().commit()
    prune_empty(os.path.dirname(old_dir))
    return os.path.relpath(target, ROOT).replace("\\", "/")

def prune_empty(d):
    try:
        while os.path.abspath(d).startswith(os.path.abspath(ROOT)) and os.path.abspath(d) != os.path.abspath(ROOT):
            if os.path.isdir(d) and not os.listdir(d):
                os.rmdir(d); d = os.path.dirname(d)
            else: break
    except Exception: pass

def file_version(part, src_bytes, filename):
    """Write an uploaded model into <root>/<Category>/<Part>/v<n>/<file>."""
    d = ensure_dir(part_dir(part))
    n = len(rows("versions", "WHERE part_id=?", (part["id"],))) + 1
    vdir = ensure_dir(os.path.join(d, f"v{n}"))
    dest = unique_path(os.path.join(vdir, slug(filename, "model.stl")))
    with open(dest, "wb") as fh: fh.write(src_bytes)
    return dest, n

def dir_size(path):
    total, files = 0, 0
    for dp, dn, fn in os.walk(path):
        if "_bench" in dp.split(os.sep): continue
        for f in fn:
            try: total += os.path.getsize(os.path.join(dp, f)); files += 1
            except OSError: pass
    return total, files

# ============================================================ HTTP layer =====
DEFAULT_HOTENDS = [
  ("h_x1c_04",  "X1C · 0.4 hardened",     "x1c_stock", "x1c", 0.4, "standard", "hardened"),
  ("h_x1c_06",  "X1C · 0.6 hardened",     "x1c_stock", "x1c", 0.6, "standard", "hardened"),
  ("h_h2s_04",  "H2S · 0.4 standard",     "h2_stock",  "h2s", 0.4, "standard", "hardened"),
  ("h_h2s_06hf","H2S · 0.6 high-flow",    "h2_hf",     "h2s", 0.6, "highflow", "hardened"),
  ("h_h2s_08hf","H2S · 0.8 high-flow",    "h2_hf",     "h2s", 0.8, "highflow", "hardened"),
  ("h_h2c_04",  "H2C · 0.4 standard",     "h2_stock",  "h2c", 0.4, "standard", "hardened"),
  ("h_h2c_02",  "H2C · 0.2 standard",     "h2_stock",  "h2c", 0.2, "standard", "hardened"),
  ("h_revo_04", "Revo · 0.4 brass",       "revo",      "x1c", 0.4, "standard", "brass"),
  ("h_revo_04h","Revo · 0.4 hardened",    "revo",      "x1c", 0.4, "standard", "hardened"),
  ("h_revo_06hf","Revo HF · 0.6 hardened","revo",      "x1c", 0.6, "highflow", "hardened"),
]

def seed():
    if db().execute("SELECT COUNT(*) c FROM hotends").fetchone()["c"]: return
    for hid, name, body, printer, noz, cls, mat in DEFAULT_HOTENDS:
        put("hotends", hid, {"name": name, "body": body, "printer": printer,
                             "nozzle": noz, "cls": cls, "nozMat": mat, "kg": 0, "notes": ""})

def full_state():
    parts = rows("parts")
    # part_id lives in its own column, so stitch it back on for the client
    versions = {}
    for r in db().execute("SELECT id, part_id, data FROM versions"):
        v = dict(json.loads(r["data"]), id=r["id"])
        versions.setdefault(r["part_id"], []).append(v)
    for k in versions:
        versions[k].sort(key=lambda v: v.get("uploadedAt", ""), reverse=True)
    hist = [{"id": r["id"], "kind": r["kind"], "targetId": r["target_id"],
             "name": r["name"], "entries": json.loads(r["entries"])}
            for r in db().execute("SELECT * FROM history ORDER BY updated DESC")]
    meta = {r["key"]: json.loads(r["value"]) for r in db().execute("SELECT * FROM meta")}
    return {"spools": rows("spools"), "hotends": rows("hotends"), "configs": rows("configs"),
            "parts": parts, "versions": versions, "prints": rows("prints"),
            "history": hist, "meta": meta,
            "settings": {"root": ROOT, "layout": "<Category>/<Part>/v<n>/<file>"}}

class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "PartsBench"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *a):
        sys.stdout.write("  %s %s\n" % (self.command, self.path.split("?")[0]))

    # ---------- helpers ----------
    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(body)

    def send_bytes(self, body, ctype, code=200, download=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if download:
            self.send_header("Content-Disposition",
                             'attachment; filename="%s"' % download.replace('"', ""))
        self.end_headers(); self.wfile.write(body)

    def read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        buf, left = bytearray(), n
        while left > 0:
            chunk = self.rfile.read(min(left, 1 << 20))
            if not chunk: break
            buf.extend(chunk); left -= len(chunk)
        return bytes(buf)

    def json_body(self):
        raw = self.read_body()
        try: return json.loads(raw.decode("utf-8")) if raw else {}
        except Exception: return {}

    def query(self):
        q = urllib.parse.urlparse(self.path).query
        return {k: v[0] for k, v in urllib.parse.parse_qs(q).items()}

    # ---------- routes ----------
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            if path.startswith("/api/"): return self.api_get(path)
            return self.static(path)
        except BrokenPipeError: pass
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def do_PUT(self):    self.mutate("PUT")
    def do_POST(self):   self.mutate("POST")
    def do_DELETE(self): self.mutate("DELETE")

    def static(self, path):
        if path in ("/", "/index.html"): rel = "index.html"
        else: rel = path.lstrip("/")
        full = os.path.abspath(os.path.join(WEB_DIR, rel))
        if not full.startswith(WEB_DIR) or not os.path.isfile(full):
            return self.send_bytes(b"Not found", "text/plain", 404)
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full, "rb") as fh: body = fh.read()
        self.send_bytes(body, ctype)

    def api_get(self, path):
        if path == "/api/state":   return self.send_json(full_state())
        if path == "/api/storage": return self.send_json(self.storage_report())

        m = re.match(r"^/api/thumb/([A-Za-z0-9_-]+)\.png$", path)
        if m:
            f = os.path.join(THUMB_DIR, m.group(1) + ".png")
            if not os.path.isfile(f): return self.send_bytes(b"", "image/png", 404)
            with open(f, "rb") as fh: return self.send_bytes(fh.read(), "image/png")

        m = re.match(r"^/api/file/([A-Za-z0-9_-]+)$", path)
        if m:
            v = get_one("versions", m.group(1))
            if not v or not v.get("relPath"): return self.send_json({"error": "unknown version"}, 404)
            full = os.path.join(ROOT, v["relPath"].replace("/", os.sep))
            if not os.path.isfile(full): return self.send_json({"error": "file missing on disk"}, 404)
            with open(full, "rb") as fh:
                return self.send_bytes(fh.read(), "application/octet-stream",
                                       download=v.get("fileName") or "model")
        self.send_json({"error": "unknown endpoint"}, 404)

    def mutate(self, method):
        path = urllib.parse.urlparse(self.path).path
        try:
            # --- model upload -------------------------------------------------
            m = re.match(r"^/api/parts/([A-Za-z0-9_-]+)/versions$", path)
            if m and method == "POST": return self.upload_version(m.group(1))
            m = re.match(r"^/api/parts/([A-Za-z0-9_-]+)/versions/([A-Za-z0-9_-]+)$", path)
            if m and method == "DELETE": return self.delete_version(m.group(1), m.group(2))

            if path == "/api/verify" and method == "POST": return self.verify()
            if path == "/api/scan"   and method == "POST": return self.scan()
            if path == "/api/reveal" and method == "POST": return self.reveal()

            m = re.match(r"^/api/meta/([A-Za-z0-9_-]+)$", path)
            if m and method == "PUT":
                db().execute("INSERT INTO meta(key,value) VALUES(?,?) "
                             "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                             (m.group(1), json.dumps(self.json_body())))
                db().commit()
                log_change("scale", m.group(1), "Quality scale", "update", None, None)
                return self.send_json({"ok": True})

            m = re.match(r"^/api/(\w+)/([A-Za-z0-9_-]+)$", path)
            if m and m.group(1) in COLLECTIONS:
                coll, rid = m.group(1), m.group(2)
                if method == "PUT":    return self.upsert(coll, rid)
                if method == "DELETE": return self.remove(coll, rid)
            self.send_json({"error": "unknown endpoint"}, 404)
        except BrokenPipeError: pass
        except Exception as e:
            import traceback; traceback.print_exc()
            self.send_json({"error": str(e)}, 500)

    # ---------- collection writes ----------
    def upsert(self, coll, rid):
        obj = self.json_body()
        before = get_one(coll, rid)
        obj["id"] = rid
        moved = None
        if coll == "parts":
            old_dir = part_dir(before) if before else None
            put(coll, rid, obj)
            if before and old_dir:
                moved = relocate_part(obj, old_dir)
            else:
                ensure_dir(part_dir(obj))
            write_sidecar(obj)
        else:
            put(coll, rid, obj)
            if coll == "prints" and obj.get("partId"):
                p = get_one("parts", obj["partId"])
                if p: write_sidecar(p)
        kind = coll.rstrip("s") if coll != "configs" else "config"
        log_change(kind, rid, record_name(coll, obj), "update" if before else "create", before, obj)
        return self.send_json({"ok": True, "moved": moved, "record": obj})

    def remove(self, coll, rid):
        before = get_one(coll, rid)
        if coll == "parts" and before:
            for v in rows("versions", "WHERE part_id=?", (rid,)):
                self._erase_version_files(v)
                drop("versions", v["id"])
            for p in [x for x in rows("prints") if x.get("partId") == rid]:
                drop("prints", p["id"])
            d = part_dir(before)
            if os.path.isdir(d):
                shutil.rmtree(d, ignore_errors=True); prune_empty(os.path.dirname(d))
        drop(coll, rid)
        kind = coll.rstrip("s") if coll != "configs" else "config"
        log_change(kind, rid, record_name(coll, before), "delete", before, None)
        return self.send_json({"ok": True})

    # ---------- versions ----------
    def upload_version(self, part_id):
        part = get_one("parts", part_id)
        if not part: return self.send_json({"error": "unknown part"}, 404)
        q = self.query()
        filename = urllib.parse.unquote(q.get("name") or "model.stl")
        data = self.read_body()
        if not data: return self.send_json({"error": "empty upload"}, 400)

        dest, n = file_version(part, data, filename)
        vid = uid()
        thumb_path = os.path.join(THUMB_DIR, vid + ".png")
        rec, _ = analyse(dest, thumb_path)
        rec["label"] = q.get("label") or f"v{n}"
        rec["relPath"] = os.path.relpath(dest, ROOT).replace("\\", "/")
        rec["fileName"] = os.path.basename(dest)
        db().execute("INSERT INTO versions(id, part_id, data, updated) VALUES(?,?,?,?)",
                     (vid, part_id, json.dumps(rec), now()))
        db().commit()
        write_sidecar(part)
        log_change("part", part_id, part.get("name"), "update",
                   {"version count": n - 1},
                   {"version count": n, "latest file": rec["fileName"]})
        return self.send_json({"ok": True, "version": dict(rec, id=vid)})

    def _erase_version_files(self, v):
        if v.get("relPath"):
            full = os.path.join(ROOT, v["relPath"].replace("/", os.sep))
            try:
                if os.path.isfile(full): os.remove(full)
                prune_empty(os.path.dirname(full))
            except OSError: pass
        t = os.path.join(THUMB_DIR, v["id"] + ".png")
        if os.path.isfile(t):
            try: os.remove(t)
            except OSError: pass

    def delete_version(self, part_id, vid):
        v = get_one("versions", vid)
        if not v: return self.send_json({"error": "unknown version"}, 404)
        v["id"] = vid
        self._erase_version_files(v)
        drop("versions", vid)
        part = get_one("parts", part_id)
        if part:
            write_sidecar(part)
            n = len(rows("versions", "WHERE part_id=?", (part_id,)))
            log_change("part", part_id, part.get("name"), "update",
                       {"version count": n + 1}, {"version count": n})
        return self.send_json({"ok": True})

    # ---------- tools ----------
    def verify(self):
        data = self.read_body()
        name = urllib.parse.unquote(self.query().get("name") or "file")
        h = hashlib.sha256(data).hexdigest()
        for r in db().execute("SELECT id, part_id, data FROM versions"):
            v = json.loads(r["data"])
            if v.get("sha256") == h:
                p = get_one("parts", r["part_id"]) or {}
                return self.send_json({"hash": h, "name": name, "match": {
                    "partId": r["part_id"], "partName": p.get("name"),
                    "versionId": r["id"], "label": v.get("label"),
                    "fileName": v.get("fileName"), "uploadedAt": v.get("uploadedAt"),
                    "relPath": v.get("relPath")}})
        return self.send_json({"hash": h, "name": name, "match": None})

    def scan(self):
        """Walk a folder and file every model found into the library."""
        body = self.json_body()
        src = os.path.abspath(body.get("path") or "")
        if not os.path.isdir(src): return self.send_json({"error": "not a folder: " + src}, 400)
        category = body.get("category") or "Imported"
        found, added, skipped = 0, [], 0
        known = {json.loads(r["data"]).get("sha256")
                 for r in db().execute("SELECT data FROM versions")}
        for dp, dn, fn in os.walk(src):
            if "_bench" in dp.split(os.sep): continue
            for f in sorted(fn):
                if os.path.splitext(f)[1].lower() not in MESH_EXT: continue
                found += 1
                full = os.path.join(dp, f)
                try:
                    with open(full, "rb") as fh: raw = fh.read()
                except OSError: continue
                h = hashlib.sha256(raw).hexdigest()
                if h in known: skipped += 1; continue
                known.add(h)
                name = os.path.splitext(f)[0].replace("_", " ").replace("-", " ").strip()
                pid = uid()
                part = {"id": pid, "name": name or f, "category": category,
                        "description": "", "tags": ["imported"], "created": now()}
                put("parts", pid, part)
                ensure_dir(part_dir(part))
                dest, n = file_version(part, raw, f)
                vid = uid()
                rec, _ = analyse(dest, os.path.join(THUMB_DIR, vid + ".png"))
                rec["label"] = f"v{n}"
                rec["relPath"] = os.path.relpath(dest, ROOT).replace("\\", "/")
                rec["fileName"] = os.path.basename(dest)
                db().execute("INSERT INTO versions(id, part_id, data, updated) VALUES(?,?,?,?)",
                             (vid, pid, json.dumps(rec), now()))
                db().commit()
                write_sidecar(part)
                log_change("part", pid, part["name"], "create", None, part)
                added.append(part["name"])
        return self.send_json({"ok": True, "found": found, "added": len(added),
                               "skipped": skipped, "names": added[:40]})

    def reveal(self):
        target = self.json_body().get("path") or ROOT
        full = os.path.join(ROOT, target.replace("/", os.sep)) if not os.path.isabs(target) else target
        try:
            if sys.platform.startswith("win"): os.startfile(os.path.dirname(full) if os.path.isfile(full) else full)
            elif sys.platform == "darwin": os.system(f'open "{full}"')
            else: os.system(f'xdg-open "{full}"')
            return self.send_json({"ok": True})
        except Exception as e:
            return self.send_json({"ok": False, "error": str(e)})

    def storage_report(self):
        total, files = dir_size(ROOT)
        cats = []
        try:
            for entry in sorted(os.listdir(ROOT)):
                d = os.path.join(ROOT, entry)
                if not os.path.isdir(d) or entry == "_bench": continue
                sz, fc = dir_size(d)
                cats.append({"name": entry, "bytes": sz, "files": fc,
                             "parts": len([x for x in os.listdir(d) if os.path.isdir(os.path.join(d, x))])})
        except OSError: pass
        missing = []
        for r in db().execute("SELECT id, part_id, data FROM versions"):
            v = json.loads(r["data"])
            if v.get("relPath") and not os.path.isfile(os.path.join(ROOT, v["relPath"].replace("/", os.sep))):
                p = get_one("parts", r["part_id"]) or {}
                missing.append({"part": p.get("name"), "file": v.get("relPath")})
        try: free = shutil.disk_usage(ROOT).free
        except Exception: free = None
        return {"root": ROOT, "bytes": total, "files": files, "free": free,
                "categories": cats, "missing": missing,
                "layout": "<Category>/<Part>/v<n>/<file>"}

def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1)); ip = s.getsockname()[0]; s.close(); return ip
    except Exception: return "127.0.0.1"

def main():
    ap = argparse.ArgumentParser(description="Parts Bench - local 3D printing library")
    ap.add_argument("--root", help="library folder; the app files models into it")
    ap.add_argument("--port", type=int)
    ap.add_argument("--host")
    args = ap.parse_args()
    cfg = load_config(args)

    global ROOT, DB_PATH, THUMB_DIR
    ROOT = cfg["root"]
    bench = ensure_dir(os.path.join(ROOT, "_bench"))
    THUMB_DIR = ensure_dir(os.path.join(bench, "thumbs"))
    DB_PATH = os.path.join(bench, "bench.db")
    ensure_dir(ROOT)
    db().executescript(SCHEMA); db().commit(); seed()

    srv = http.server.ThreadingHTTPServer((cfg["host"], cfg["port"]), Handler)
    ip = lan_ip()
    print("\n  Parts Bench")
    print("  library   " + ROOT)
    print("  layout    <Category>/<Part>/v<n>/<file>")
    print("  database  " + DB_PATH)
    print("\n  open      http://localhost:%d" % cfg["port"])
    print("  on LAN    http://%s:%d" % (ip, cfg["port"]))
    print("\n  Ctrl-C to stop\n")
    try: srv.serve_forever()
    except KeyboardInterrupt: print("\n  stopped\n")

if __name__ == "__main__":
    main()
