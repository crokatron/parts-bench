"""Durable print catalogue. Physical transports are supplied by the NAS adapter."""
import hashlib
import io
import json
import os
import re
import sqlite3
import threading
import time
import uuid
import xml.etree.ElementTree as ET
import zipfile
from contextlib import contextmanager
from pathlib import Path

from filament_matching import plan, validate_selection
from recommendation_audit import audit

MAX_FILE = 64 * 1024 * 1024
ACTIVE = {"uploading", "dispatching", "awaiting_printer", "printing", "paused", "uncertain"}


def read_bundle(raw, plate=None):
    if not raw or len(raw) > MAX_FILE:
        raise ValueError("Print files must be between 1 byte and 64 MB.")
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise ValueError("Send a sliced .gcode.3mf from Orca with 3MF support enabled.") from None
    infos = z.infolist()
    if (len(infos) > 10000 or sum(i.file_size for i in infos) > 256 * 1024 * 1024
            or len({i.filename for i in infos}) != len(infos)):
        raise ValueError("Archive is too large or has duplicate entries.")
    names = {i.filename for i in infos}
    plates = sorted(int(m.group(1)) for n in names
                    if (m := re.fullmatch(r"Metadata/plate_(\d+)\.gcode", n)))
    if plate is None:
        if len(plates) != 1: raise ValueError("Select one sliced plate in Orca before sending.")
        plate = plates[0]
    if type(plate) is not int or plate not in plates:
        raise ValueError("The selected plate has no sliced G-code.")
    def small(name):
        if name not in names: return None
        if z.getinfo(name).file_size > 2 * 1024 * 1024:
            raise ValueError("Slicer metadata is too large.")
        return z.read(name)
    settings_raw = small("Metadata/project_settings.config")
    settings = json.loads(settings_raw) if settings_raw else {}
    if not isinstance(settings, dict): raise ValueError("Invalid slicer settings.")
    # Connection credentials are not printing settings and must not enter UI/API
    # metadata. The original archive remains protected owner-only binary data.
    settings = {k: v for k, v in settings.items()
                if not any(s in k.lower() for s in ("password", "apikey", "access_code", "token"))}
    si = small("Metadata/slice_info.config")
    if not si: raise ValueError("Sliced file has no plate or filament metadata.")
    root = ET.fromstring(si)
    selected = None
    for element in root.iter("plate"):
        md = {m.get("key"): m.get("value") for m in element.findall("metadata")}
        if str(md.get("index")) == str(plate): selected = (element, md)
    if selected is None: raise ValueError("Selected plate metadata is missing.")
    element, md = selected
    def indexed(key, idx):
        value = settings.get(key)
        if isinstance(value, list): return value[idx] if idx < len(value) else None
        return value
    requirements = []
    for f in element.iter("filament"):
        fid = int(f.get("id", "0"))
        if not 1 <= fid <= 64: raise ValueError("Invalid filament index.")
        used = float(f.get("used_g") or 0)
        if used <= 0: continue
        temperature = indexed("nozzle_temperature", fid - 1)
        requirements.append({"index": fid - 1, "material": f.get("type") or indexed("filament_type", fid - 1),
                             "color": f.get("color") or indexed("filament_colour", fid - 1),
                             "profile": f.get("tray_info_idx") or "", "grams": used,
                             "temperature": float(temperature) if temperature else None})
    if len({r["index"] for r in requirements}) != len(requirements):
        raise ValueError("Duplicate filament metadata.")
    requirements.sort(key=lambda x: x["index"])
    nozzle = md.get("nozzle_diameters") or indexed("nozzle_diameter", 0)
    try: nozzle = float(nozzle)
    except (TypeError, ValueError): nozzle = None
    # Print-only 3MFs can contain a tiny empty .model placeholder (SkipModel).
    # Its filename alone does not mean the original mesh was retained.
    geometry = False
    for name in names:
        if not name.startswith('3D/') or not name.endswith('.model'): continue
        vertex = triangle = False
        with z.open(name) as model:
            for _, el in ET.iterparse(model, events=('end',)):
                tag = el.tag.rsplit('}', 1)[-1]
                vertex |= tag == 'vertex'
                triangle |= tag == 'triangle'
                el.clear()
                if vertex and triangle:
                    geometry = True
                    break
        if geometry: break
    return {"plate": plate, "nozzle": nozzle, "printerModel": md.get("printer_model_id"),
            "requirements": requirements, "settings": settings,
            "estimatedSeconds": int(md.get("prediction") or 0),
            "estimatedGrams": float(md.get("weight") or 0),
            "hasGeometry": geometry,
            "sha256": hashlib.sha256(raw).hexdigest()}


class PrintJobs:
    def __init__(self, root, transport, clock=time.time, recover=False):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.files = self.root / "files"
        self.files.mkdir(exist_ok=True)
        self.path = self.root / "jobs.db"
        self.transport, self.clock = transport, clock
        self.lock = threading.RLock()
        with self.connect() as db:
            db.executescript("""
              CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, sha TEXT, plate INTEGER, data TEXT);
              CREATE UNIQUE INDEX IF NOT EXISTS file_plate ON jobs(sha, plate);
              CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, job_id TEXT, created REAL,
                updated REAL, state TEXT, data TEXT, request_id TEXT UNIQUE);
            """)
            # Never replay an in-flight physical action after a process restart.
            if recover:
                db.execute("UPDATE runs SET state='uncertain' WHERE state IN ('uploading','dispatching')")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        try:
            with db:
                yield db
        finally:
            db.close()

    def catalogue(self, filename, raw, plate=None):
        metadata = read_bundle(raw, plate)
        sha, plate = metadata["sha256"], metadata["plate"]
        with self.lock, self.connect() as db:
            old = db.execute("SELECT data FROM jobs WHERE sha=? AND plate=?", (sha, plate)).fetchone()
            if old: return json.loads(old[0])
            dest = self.files / (sha + ".3mf")
            if not dest.exists():
                temp = self.files / (sha + ".tmp")
                with open(temp, "wb") as f:
                    f.write(raw); f.flush(); os.fsync(f.fileno())
                os.replace(temp, dest)
            job = {"id": uuid.uuid4().hex, "name": Path(filename.replace("\\", "/")).name[:180],
                   "created": self.clock(), **metadata}
            job['recommendation'] = audit(job, job['created'])
            db.execute("INSERT INTO jobs VALUES (?,?,?,?)", (job["id"], sha, plate, json.dumps(job)))
        return job

    def job(self, jid):
        with self.connect() as db:
            row = db.execute("SELECT data FROM jobs WHERE id=?", (jid,)).fetchone()
        if not row: raise ValueError("Saved job was not found.")
        return json.loads(row[0])

    @staticmethod
    def unpack(row):
        return {**json.loads(row["data"]), **{k: row[k] for k in ("id", "job_id", "created", "updated", "state")}}

    def run(self, rid):
        with self.connect() as db:
            row = db.execute("SELECT * FROM runs WHERE id=?", (rid,)).fetchone()
        if not row: raise ValueError("Print attempt was not found.")
        return self.unpack(row)

    def update(self, rid, state, **extra):
        with self.connect() as db:
            row = db.execute("SELECT data FROM runs WHERE id=?", (rid,)).fetchone()
            data = {**json.loads(row[0]), **extra}
            db.execute("UPDATE runs SET state=?, updated=?, data=? WHERE id=?",
                       (state, self.clock(), json.dumps(data), rid))
        return self.run(rid)

    def state(self):
        with self.connect() as db:
            jobs = [json.loads(r[0]) for r in db.execute("SELECT data FROM jobs ORDER BY rowid DESC")]
            runs = [self.unpack(r) for r in db.execute("SELECT * FROM runs ORDER BY created DESC LIMIT 300")]
        return {"jobs": jobs, "runs": runs, "printer": self.transport.snapshot()}

    def prepare(self, jid):
        job, snapshot = self.job(jid), self.transport.snapshot()
        return {"job": job, "printer": snapshot, **plan(job["requirements"], snapshot.get("slots", []))}

    def submit(self, jid, request_id, source="parts-bench", auto=False):
        if not re.fullmatch(r"[A-Za-z0-9_-]{8,100}", request_id):
            raise ValueError("A unique print request ID is required.")
        job = self.job(jid)
        with self.lock, self.connect() as db:
            old = db.execute("SELECT * FROM runs WHERE request_id=?", (request_id,)).fetchone()
            if old:
                if old["job_id"] != jid: raise ValueError("Request ID belongs to another file.")
                return self.unpack(old)
            # Orca doesn't supply idempotency IDs. Guard recent identical retries;
            # intentional quick reprints use a new explicit request in the portal.
            if source == "orca":
                old = db.execute("SELECT * FROM runs WHERE job_id=? AND created>? ORDER BY created DESC LIMIT 1",
                                 (jid, self.clock() - 600)).fetchone()
                if old: return self.unpack(old)
            rid = uuid.uuid4().hex
            data = {"source": source, "name": job["name"], "sha256": job["sha256"], "plate": job["plate"],
                    "requestedAutomaticStart": bool(auto), "notified": False,
                    "slicedSettings": job['settings'], "recommendation": audit(job, self.clock())}
            stamp = self.clock()
            db.execute("INSERT INTO runs VALUES (?,?,?,?,?,?,?)",
                       (rid, jid, stamp, stamp, "waiting", json.dumps(data), request_id))
        if auto:
            proposed = self.prepare(jid)
            if proposed["automatic"]:
                try:
                    return self.start(rid, proposed["mapping"], proposed["slotRevision"], confirmed=True)
                except ValueError as e:
                    self.update(rid, "waiting", reason=str(e))
            else:
                self.update(rid, "waiting", reason="Choose the loaded filament for this job.")
            self.notify(rid)
        return self.run(rid)

    def notify(self, rid):
        run = self.run(rid)
        if run.get("notified"): return
        try:
            self.transport.notify(run)
        except Exception:
            self.update(rid, run["state"], notificationError="Phone notification could not be sent.")
        else:
            self.update(rid, run["state"], notified=True, notificationError=None)

    def start(self, rid, mapping, revision, confirmed=False):
        if confirmed is not True: raise ValueError("Confirm the printer is ready before starting.")
        with self.lock:
            run = self.run(rid)
            if run["state"] != "waiting": return run
            job = self.job(run["job_id"])
            # Older waiting attempts also receive an audit before any physical action.
            if not run.get('recommendation'):
                run = self.update(rid, 'waiting', slicedSettings=job['settings'], recommendation=audit(job, self.clock()))
            with self.connect() as db:
                if any(r[0] in ACTIVE for r in db.execute("SELECT state FROM runs WHERE id!=?", (rid,))):
                    raise ValueError("Another attempt is active or needs its outcome checked.")
            snap = self.transport.snapshot(fresh=True)
            self.check_ready(job, snap)
            options = validate_selection(job["requirements"], snap["slots"], mapping, revision)
            if options["use_ams"]:
                full = [-1] * (max(r["index"] for r in job["requirements"]) + 1)
                for req, slot in zip(job["requirements"], mapping): full[req["index"]] = slot
                options["ams_mapping"] = ",".join(map(str, full))
            path = self.files / (job["sha256"] + ".3mf")
            if hashlib.sha256(path.read_bytes()).hexdigest() != job["sha256"]:
                raise ValueError("Saved print file failed its integrity check.")
            remote = "partsbench_" + rid + ".gcode.3mf"
            self.update(rid, "uploading", mapping=mapping, slotRevision=revision,
                        remoteFile=remote, options=options, filamentSnapshot=snap["slots"])
            try:
                self.transport.upload(path, remote)
                snap = self.transport.snapshot(fresh=True)
                self.check_ready(job, snap)
                validate_selection(job["requirements"], snap["slots"], mapping, revision)
            except Exception:
                self.update(rid, "waiting", reason="Transfer or pre-print checks failed. No start was sent.")
                raise ValueError("Transfer or pre-print checks failed. No start was sent.") from None
            self.update(rid, "dispatching")
            try:
                self.transport.start(remote, job["plate"], options)
            except Exception:
                # HA/network timeouts do not prove that the printer rejected it.
                return self.update(rid, "uncertain", reason="Start response was lost. Check the printer before retrying.")
            return self.update(rid, "awaiting_printer", reason="Start sent; waiting for the printer to report this file.")

    @staticmethod
    def check_ready(job, snap):
        if not snap.get("online") or not snap.get("developerMode"):
            raise ValueError("Printer must be online in Developer LAN mode.")
        if snap.get("status") not in ("idle", "finish", "failed") or snap.get("stage") != "idle":
            raise ValueError("Printer is busy or its idle status could not be verified.")
        if snap.get("printError") or snap.get("hmsError"):
            raise ValueError("Check and clear the printer's reported error before starting.")
        if not job.get("nozzle") or job["nozzle"] != snap.get("nozzle"):
            raise ValueError("The sliced nozzle size does not match the printer.")
        model = str(job.get("printerModel") or "").upper()
        if model not in ("BL-P001", "C11", "X1C", "BAMBU LAB X1 CARBON"):
            raise ValueError("This file is not identified as an X1 Carbon print.")
        if not job.get("requirements"):
            raise ValueError("Filament requirements are missing; re-export the sliced project.")

    def reconcile(self):
        snap = self.transport.snapshot(fresh=True)
        if not snap.get("online"): return
        with self.lock, self.connect() as db:
            runs = [self.unpack(r) for r in db.execute("SELECT * FROM runs") if r["state"] in ACTIVE]
            for run in runs:
                remote = run.get("remoteFile")
                # Unique per-attempt filenames prevent a previous finished print
                # from making a newly sent copy look complete.
                matches = remote and any(remote == Path(str(snap.get(k) or "")).name
                                         for k in ("file", "task"))
                if not matches: continue
                status = snap.get("status")
                state = {"running": "printing", "prepare": "printing", "pause": "paused",
                         "finish": "finished", "failed": "failed"}.get(status)
                if state: self.update(run["id"], state, progress=snap.get("progress"),
                                      observedAt=self.clock(), reason=None)

    def resolve(self, rid, outcome, note):
        if outcome not in ("finished", "failed", "cancelled", "not_started") or not str(note).strip():
            raise ValueError("Choose an outcome and record what you checked.")
        with self.lock:
            run = self.run(rid)
            if run["state"] not in ("uncertain", "awaiting_printer", "waiting"):
                raise ValueError("Only waiting or unconfirmed attempts can be resolved manually.")
            snap = self.transport.snapshot(fresh=True)
            if not snap.get("online") or snap.get("stage") != "idle":
                raise ValueError("Verify that the printer is online and idle first.")
            return self.update(rid, outcome, manualOutcome=True, outcomeNote=str(note)[:1000])
