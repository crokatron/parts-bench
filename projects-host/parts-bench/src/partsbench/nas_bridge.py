"""Owner gateway adapter and narrowly scoped Orca print-host API."""
import email.policy
from email.parser import BytesParser
import ftplib
import hashlib
import hmac
import http.client
import http.server
import io
import json
import os
from pathlib import Path
import secrets
import ssl
import threading
import time
import urllib.parse
import urllib.request
import uuid
import zipfile

from filament_matching import normalise_slots
from print_jobs import PrintJobs, MAX_FILE


class PrinterFTP(ftplib.FTP_TLS):
    serial = ""
    @property
    def sock(self): return getattr(self, "_sock", None)
    @sock.setter
    def sock(self, value):
        if value is not None and not isinstance(value, ssl.SSLSocket):
            value = self.context.wrap_socket(value, server_hostname=self.serial)
        self._sock = value
    def ntransfercmd(self, cmd, rest=None):
        sock, size = ftplib.FTP.ntransfercmd(self, cmd, rest)
        if self._prot_p:
            sock = self.context.wrap_socket(sock, server_hostname=self.serial, session=self.sock.session)
        return sock, size
    def storbinary(self, cmd, fp, blocksize=65536, callback=None, rest=None):
        self.voidcmd('TYPE I')
        with self.transfercmd(cmd, rest) as conn:
            while chunk := fp.read(blocksize):
                conn.sendall(chunk)
                if callback: callback(chunk)
        return self.voidresp()
    def retrbinary(self, cmd, callback, blocksize=65536, rest=None):
        self.voidcmd('TYPE I')
        with self.transfercmd(cmd, rest) as conn:
            while chunk := conn.recv(blocksize): callback(chunk)
        return self.voidresp()


class Transport:
    def __init__(self, bridge): self.bridge = bridge
    def snapshot(self, fresh=False):
        b = self.bridge
        if not fresh and time.time() - b.cached_at < 5: return b.cached
        try:
            with b.ha.websocket(b.ha.token()) as ws:
                states = ws.call("get_states")
                registry = ws.call("config/entity_registry/list")
            entities = {s["entity_id"]: s for s in states}
            def state(name, domain="sensor"):
                return entities.get(domain + ".bambu_lab_x1c_" + name, {}).get("state")
            value = {"online": state("online", "binary_sensor") == "on",
                     "developerMode": state("developer_lan_mode", "binary_sensor") == "on",
                     "status": state("print_status"), "stage": state("current_stage"),
                     "printError": state("print_error", "binary_sensor") != "off",
                     "hmsError": state("hms_errors", "binary_sensor") != "off",
                     "file": state("gcode_filename"), "task": state("task_name"),
                     "nozzle": float(state("nozzle_size") or 0), "progress": state("print_progress"),
                     "bed": state("bed_temperature"), "temperature": state("nozzle_temperature"),
                     "slots": normalise_slots(states, registry,
                         "381f433a8fd31e7fdbe848710d24ba37", "d389cbb19d5f74fb995280d6309858bb"),
                     "checkedAt": time.time()}
        except Exception:
            value = {"online": False, "slots": [], "error": "Home Assistant printer readings are unavailable.", "checkedAt": time.time()}
        b.cached, b.cached_at = value, time.time()
        return value

    def service(self, domain, name, data):
        request = urllib.request.Request("http://192.168.0.223/api/services/" + domain + "/" + name,
            data=json.dumps(data).encode(), headers={"Authorization": "Bearer " + self.bridge.ha.token(),
                                                  "Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request, timeout=30) as response: return json.load(response)

    def upload(self, path, remote):
        cfg = self.bridge.config()
        if not cfg.get("printerCode"): raise ValueError("Printer access code is not configured on the NAS.")
        ctx = ssl.create_default_context(cadata=self.bridge.certificate)
        ftp = PrinterFTP(context=ctx)
        ftp.serial = "00M09D480503623"
        try:
            ftp.connect("192.168.0.145", 990, timeout=30)
            ftp.login("bblp", cfg["printerCode"]); ftp.prot_p()
            with path.open("rb") as f: ftp.storbinary("STOR " + remote, f, blocksize=65536)
            # Verify uploaded bytes, not merely the FTP completion reply.
            digest = hashlib.sha256()
            ftp.retrbinary("RETR " + remote, digest.update, blocksize=65536)
            if digest.hexdigest() != hashlib.sha256(path.read_bytes()).hexdigest():
                raise ValueError("Printer upload integrity mismatch.")
        finally: ftp.close()

    def start(self, remote, plate, options):
        return self.service("bambu_lab", "print_project_file", {
            "device_id": "2a09016b5ef229ebfac584454342ffc8", "filepath": remote, "plate": plate,
            "timelapse": False, "bed_leveling": True, "flow_cali": True,
            "vibration_cali": True, "layer_inspect": True, **options})

    def notify(self, run):
        url = "https://projects.mungoon.net/parts-bench/jobs.html?run=" + run["id"]
        return self.service("notify", "mobile_app_s25u_leras", {
            "title": "Print waiting · Parts Bench", "message": run["name"] + ": " + (run.get("reason") or "Choose filament to continue."),
            "data": {"tag": "parts-bench-" + run["id"], "url": url, "clickAction": url,
                     "actions": [{"action": "URI", "title": "Choose filament", "uri": url}]}})


class PartsBridge:
    def __init__(self, root, data, ha, core, certificate, start=False):
        self.root, self.data, self.ha, self.core = Path(root), Path(data), ha, core
        self.certificate = certificate
        self.private = self.data / "private" / "parts-bench.json"
        self.lock = threading.RLock()
        self.cached, self.cached_at = {}, 0
        self.transport = Transport(self)
        self.jobs = PrintJobs(self.data / "parts-bench-jobs", self.transport, recover=start)
        self.backend = None
        if start: threading.Thread(target=self.monitor, daemon=True, name="parts-bench-monitor").start()

    def config(self):
        return json.loads(self.private.read_text()) if self.private.exists() else {}

    def configure(self, body):
        with self.lock:
            cfg = self.config()
            if "printerCode" in body:
                code = str(body["printerCode"])
                if not code.isalnum() or not 6 <= len(code) <= 32: raise ValueError("Invalid printer access code.")
                cfg["printerCode"] = code
            for role in ("orca", "ha"):
                if not cfg.get(role + "Key"): cfg[role + "Key"] = secrets.token_urlsafe(32)
            self.private.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(self.private.with_suffix(".tmp"), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f: json.dump(cfg, f)
            os.replace(self.private.with_suffix(".tmp"), self.private)
            os.chmod(self.private, 0o600)
        return {"configured": bool(cfg.get("printerCode"))}

    def monitor(self):
        while True:
            try: self.jobs.reconcile()
            except Exception: pass
            time.sleep(10)

    def read_body(self, h, limit=MAX_FILE + 1024 * 1024):
        if h.headers.get("Transfer-Encoding"): raise ValueError("Chunked requests are unsupported.")
        n = int(h.headers.get("Content-Length", "0"))
        if not 0 <= n <= limit: raise ValueError("Request is too large.")
        h.connection.settimeout(90)
        body = h.rfile.read(n)
        if len(body) != n: raise ValueError("Incomplete upload.")
        return body

    def machine_request(self, h):
        """Called only for exact scoped routes. Never grants general Projects access."""
        p = urllib.parse.urlparse(h.path).path
        role = "orca" if p.startswith("/parts-bench/octo/") else "ha"
        valid = ((role == "orca" and (h.command, p) in {
                    ("GET", "/parts-bench/octo/api/version"), ("POST", "/parts-bench/octo/api/files/local")})
                 or (role == "ha" and (h.command, p) in {
                    ("GET", "/parts-bench/ha-api/state"), ("POST", "/parts-bench/ha-api/submit")}))
        # Keys work on the NAS LAN endpoint only; browser sign-in remains unchanged.
        cfg = self.config()
        key = h.headers.get("X-Api-Key", "") if role == "orca" else h.headers.get("Authorization", "").removeprefix("Bearer ")
        if (not valid or h.headers.get("Host") != "192.168.0.54:9070" or h.headers.get("Origin")
                or not cfg.get(role + "Key") or not hmac.compare_digest(key, cfg[role + "Key"])):
            return h.send_json({"error": "Valid scoped print-host authentication required."}, 401)
        try:
            if p.endswith("/api/version"):
                return h.send_json({"api": "0.1", "server": "1.0", "text": "OctoPrint-compatible Mungoon Parts Bench"})
            if p.endswith("/state"): return h.send_json(self.jobs.state())
            if p.endswith("/submit"):
                b = json.loads(self.read_body(h, 10000))
                if b.get("ready") is not True: raise ValueError("Confirm the printer is ready before starting.")
                run = self.jobs.submit(b["jobId"], b["requestId"], "ha", auto=True)
                return h.send_json(run)
            raw = self.read_body(h)
            mime = ("Content-Type: " + h.headers.get("Content-Type", "") + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + raw
            msg = BytesParser(policy=email.policy.default).parsebytes(mime)
            if not msg.is_multipart(): raise ValueError("Expected a multipart print upload.")
            fields, content, filename = {}, None, None
            for part in msg.iter_parts():
                name = part.get_param("name", header="content-disposition")
                if name == "file":
                    if content is not None: raise ValueError("Send one print file at a time.")
                    content, filename = part.get_payload(decode=True), part.get_filename()
                else: fields[name] = (part.get_payload(decode=True) or b"").decode()[:1000]
            if not content or not filename: raise ValueError("No print file was uploaded.")
            plate = int(fields["plateindex"]) if fields.get("plateindex") else None
            job = self.jobs.catalogue(filename, content, plate)
            run = self.jobs.submit(job["id"], uuid.uuid4().hex, "orca", auto=True) if fields.get("print") == "true" else None
            return h.send_json({"done": True, "files": {"local": {"name": filename, "path": filename,
                "origin": "local", "refs": {"resource": "https://projects.mungoon.net/parts-bench/jobs.html"}}},
                "partsBench": {"jobId": job["id"], "run": run}}, 201)
        except (ValueError, KeyError, TypeError) as e:
            return h.send_json({"error": str(e)}, 400)
        except Exception:
            return h.send_json({"error": "The print request could not be completed. Check Parts Bench before resending."}, 502)

    def request(self, h):
        if not h.identity.get("owner"): return h.send_json({"error": "Parts Bench is owner-only."}, 403)
        path = urllib.parse.urlparse(h.path).path
        if h.command != "GET" and not h.origin_ok(): return h.reject_origin()
        try:
            if path.startswith("/parts-bench/api/jobs"):
                if h.command == "GET":
                    query = urllib.parse.parse_qs(urllib.parse.urlparse(h.path).query)
                    if query.get("job"): return h.send_json(self.jobs.prepare(query["job"][0]))
                    return h.send_json(self.jobs.state())
                body = json.loads(self.read_body(h, 10000))
                if path.endswith("/submit"):
                    result = self.jobs.submit(body["jobId"], body["requestId"], auto=False)
                elif path.endswith("/start"):
                    result = self.jobs.start(body["runId"], body["mapping"], body["slotRevision"], body.get("confirmed"))
                elif path.endswith("/resolve"):
                    result = self.jobs.resolve(body["runId"], body["outcome"], body.get("note"))
                else: raise ValueError("Unknown print action.")
                return h.send_json(result)
            if path == "/parts-bench/api/configure" and h.command == "POST":
                return h.send_json(self.configure(json.loads(self.read_body(h, 10000))))
            if path == "/parts-bench/api/connection" and h.command == "GET":
                cfg = self.config()
                return h.send_json({"configured": bool(cfg.get("printerCode")),
                    "host": "http://192.168.0.54:9070/parts-bench/octo/",
                    "orcaKey": cfg.get("orcaKey"), "haKey": cfg.get("haKey")})
            if path == "/parts-bench/api/upload" and h.command == "POST":
                query = urllib.parse.parse_qs(urllib.parse.urlparse(h.path).query)
                return h.send_json(self.jobs.catalogue(query.get("name", ["print.3mf"])[0], self.read_body(h)))
            if path in ("/parts-bench/api/scan", "/parts-bench/api/reveal"):
                return h.send_json({"error": "Use browser upload/download for NAS files."}, 400)
            return self.core_request(h)
        except (ValueError, KeyError, TypeError) as e: return h.send_json({"error": str(e)}, 400)
        except Exception: return h.send_json({"error": "Parts Bench could not complete this request."}, 502)

    def core_request(self, h):
        with self.lock:
            if self.backend is None:
                core = self.core
                core.ROOT = str(self.data / "parts-bench")
                core.THUMB_DIR = core.ensure_dir(str(Path(core.ROOT) / "_bench/thumbs"))
                core.DB_PATH = str(Path(core.ROOT) / "_bench/bench.db")
                core.db().executescript(core.SCHEMA); core.db().commit(); core.seed()
                core.WEB_DIR = str(self.root / "public/parts-bench")
                bridge_lock = self.lock
                class SerialHandler(core.Handler):
                    def mutate(self, method):
                        with bridge_lock: return super().mutate(method)
                    def log_message(self, *args): pass
                self.backend = http.server.ThreadingHTTPServer(("127.0.0.1", 0), SerialHandler)
                threading.Thread(target=self.backend.serve_forever, daemon=True).start()
        body = self.read_body(h) if h.command != "GET" else None
        if body and body.startswith(b"PK"):
            with zipfile.ZipFile(io.BytesIO(body)) as archive:
                if len(archive.infolist()) > 10000 or sum(i.file_size for i in archive.infolist()) > 256*1024*1024:
                    raise ValueError("Model archive is too large to inspect.")
        upstream = http.client.HTTPConnection("127.0.0.1", self.backend.server_port, timeout=90)
        try:
            upstream.request(h.command, h.path.removeprefix("/parts-bench"), body,
                             {"Content-Type": h.headers.get("Content-Type", "application/json")})
            response = upstream.getresponse()
            data = response.read(MAX_FILE + 1)
            if len(data) > MAX_FILE: raise ValueError("Response too large.")
            h.send_response(response.status)
            for k in ("Content-Type", "Content-Disposition"):
                if response.getheader(k): h.send_header(k, response.getheader(k))
            h.send_header("Content-Length", str(len(data))); h.send_header("Cache-Control", "no-store")
            h.end_headers(); h.wfile.write(data)
        finally: upstream.close()
