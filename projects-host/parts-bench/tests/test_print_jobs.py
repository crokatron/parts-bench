import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/partsbench"))
from print_jobs import PrintJobs, read_bundle


def bundle(material="PLA", nozzle="0.6", plate=1):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr(f"Metadata/plate_{plate}.gcode", "; fixture: never send to a printer\n")
        z.writestr("Metadata/project_settings.config", json.dumps({"nozzle_temperature": ["220"], "printhost_apikey": "fixture-secret"}))
        z.writestr("Metadata/slice_info.config", f'''<config><plate>
          <metadata key="index" value="{plate}"/><metadata key="nozzle_diameters" value="{nozzle}"/>
          <metadata key="printer_model_id" value="C11"/><metadata key="prediction" value="300"/>
          <filament id="1" type="{material}" color="#FF0000" tray_info_idx="GFA00" used_g="5"/>
          </plate></config>''')
    return b.getvalue()


class Transport:
    def __init__(self):
        self.snap = {"online": True, "developerMode": True, "status": "finish", "stage": "idle", "nozzle": 0.6,
                     "slots": [{"id": 0, "material": "PLA", "color": "FF0000", "profile": "GFA00",
                                "available": True, "empty": False, "uuid": "a"}]}
        self.calls, self.notifications = [], []
        self.fail_upload = self.fail_start = self.swap_on_upload = False
    def snapshot(self, fresh=False): return self.snap
    def upload(self, path, remote):
        self.calls.append(("upload", remote))
        if self.fail_upload: raise OSError()
        if self.swap_on_upload: self.snap["slots"][0]["uuid"] = "b"
    def start(self, remote, plate, options):
        self.calls.append(("start", remote, plate, options))
        if self.fail_start: raise TimeoutError()
    def notify(self, run): self.notifications.append(run["id"])


class JobTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.transport = Transport()
        self.jobs = PrintJobs(self.temp.name, self.transport)
        self.job = self.jobs.catalogue("test.gcode.3mf", bundle())

    def test_hash_dedup_and_metadata(self):
        self.assertEqual(self.jobs.catalogue("renamed.3mf", bundle())["id"], self.job["id"])
        self.assertNotIn("printhost_apikey", self.job["settings"])
        self.assertEqual(self.job["requirements"][0]["grams"], 5)

    def test_print_only_model_placeholder_is_not_geometry(self):
        for model, expected in [('<model><resources/></model>',False),
                ('<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object><mesh><vertices><vertex x="0" y="0" z="0"/></vertices><triangles><triangle v1="0" v2="0" v3="0"/></triangles></mesh></object></resources></model>',True)]:
            out=io.BytesIO()
            with zipfile.ZipFile(io.BytesIO(bundle())) as src,zipfile.ZipFile(out,'w') as dst:
                for name in src.namelist():dst.writestr(name,src.read(name))
                dst.writestr('3D/3dmodel.model',model)
            self.assertEqual(read_bundle(out.getvalue())['hasGeometry'],expected)

    def test_automatic_and_idempotent(self):
        run = self.jobs.submit(self.job["id"], "request_001", "orca", True)
        self.assertEqual(run["state"], "awaiting_printer")
        again = self.jobs.submit(self.job["id"], "request_001", "orca", True)
        self.assertEqual(run["id"], again["id"])
        retry = self.jobs.submit(self.job["id"], "request_002", "orca", True)
        self.assertEqual(run["id"], retry["id"])
        self.assertEqual(len(self.transport.calls), 2)

    def test_ambiguous_notification_and_selection(self):
        self.transport.snap["slots"].append(dict(self.transport.snap["slots"][0], id=1))
        run = self.jobs.submit(self.job["id"], "request_001", "orca", True)
        self.assertEqual(run["state"], "waiting")
        self.assertEqual(self.transport.notifications, [run["id"]])
        self.assertEqual(self.transport.calls, [])
        proposal = self.jobs.prepare(self.job["id"])
        run = self.jobs.start(run["id"], [1], proposal["slotRevision"], True)
        self.assertEqual(run["options"]["ams_mapping"], "1")

    def test_not_ready_never_dispatches(self):
        self.jobs.check_ready(dict(self.job,printerModel='BL-P001'), self.transport.snap)
        for key, value in (("online", False), ("developerMode", False), ("nozzle", 0.4),
                           ("status", "running"), ("hmsError", True), ("printError", True)):
            old = self.transport.snap.get(key)
            self.transport.snap[key] = value
            with self.assertRaises(ValueError): self.jobs.check_ready(self.job, self.transport.snap)
            if old is None: self.transport.snap.pop(key)
            else: self.transport.snap[key] = old
        self.assertEqual(self.transport.calls, [])

    def test_upload_failure_does_not_start(self):
        self.transport.fail_upload = True
        run = self.jobs.submit(self.job["id"], "request_001", auto=True)
        self.assertEqual(run["state"], "waiting")
        self.assertEqual([c[0] for c in self.transport.calls], ["upload"])

    def test_spool_swap_during_upload_does_not_start(self):
        self.transport.swap_on_upload = True
        run = self.jobs.submit(self.job["id"], "request_001", auto=True)
        self.assertEqual(run["state"], "waiting")
        self.assertEqual([c[0] for c in self.transport.calls], ["upload"])

    def test_unknown_start_never_retries(self):
        self.transport.fail_start = True
        run = self.jobs.submit(self.job["id"], "request_001", auto=True)
        self.assertEqual(run["state"], "uncertain")
        proposal = self.jobs.prepare(self.job["id"])
        again = self.jobs.start(run["id"], [0], proposal["slotRevision"], True)
        self.assertEqual(again["state"], "uncertain")
        self.assertEqual(len(self.transport.calls), 2)
        reloaded = PrintJobs(self.temp.name, self.transport)
        self.assertEqual(reloaded.run(run["id"])["state"], "uncertain")

    def test_previous_finished_file_cannot_complete_new_run(self):
        run = self.jobs.submit(self.job["id"], "request_001", auto=True)
        self.transport.snap["file"] = "previous.gcode.3mf"
        self.jobs.reconcile()
        self.assertEqual(self.jobs.run(run["id"])["state"], "awaiting_printer")
        self.transport.snap["file"] = run["remoteFile"]
        self.jobs.reconcile()
        self.assertEqual(self.jobs.run(run["id"])["state"], "finished")

    def test_busy_attempt_blocks_second_print(self):
        self.jobs.submit(self.job["id"], "request_001", auto=True)
        other = self.jobs.submit(self.job["id"], "request_002", auto=True)
        self.assertEqual(other["state"], "waiting")
        self.assertEqual(len(self.transport.calls), 2)

    def test_corruption_rejected(self):
        (self.jobs.files / (self.job["sha256"] + ".3mf")).write_bytes(b"corrupt")
        run = self.jobs.submit(self.job["id"], "request_001", auto=True)
        self.assertEqual(run["state"], "waiting")
        self.assertEqual(self.transport.calls, [])

    def test_plain_model_rejected_as_print(self):
        raw = io.BytesIO()
        with zipfile.ZipFile(raw, "w") as z: z.writestr("3D/3dmodel.model", "<model/>")
        with self.assertRaises(ValueError): read_bundle(raw.getvalue())


if __name__ == "__main__": unittest.main()
