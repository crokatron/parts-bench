import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/partsbench"))
from filament_matching import plan, spool_revision, validate_selection, normalise_slots


class MatchingTests(unittest.TestCase):
    def setUp(self):
        self.req = [{"material": "PLA", "color": "#FF0000", "profile": "GFA00", "temperature": 220}]
        self.slots = [{"id": 0, "material": "PLA", "color": "FF0000FF", "profile": "GFA00",
                       "available": True, "empty": False, "uuid": "one", "minTemp": 190, "maxTemp": 240}]

    def test_exact_match(self):
        p = plan(self.req, self.slots)
        self.assertTrue(p["automatic"])
        self.assertEqual(validate_selection(self.req, self.slots, p["mapping"], p["slotRevision"]),
                         {"use_ams": True, "ams_mapping": "0"})

    def test_duplicate_match_requires_choice(self):
        slots = self.slots + [dict(self.slots[0], id=1, uuid="two")]
        self.assertFalse(plan(self.req, slots)["automatic"])
        self.assertEqual(len(plan(self.req, slots)["choices"][0]["candidates"]), 2)

    def test_color_or_profile_difference_requires_choice(self):
        for change in ({"color": "000000"}, {"profile": "another"}, {"profile": ""}):
            slots = [dict(self.slots[0], **change)]
            self.assertFalse(plan(self.req, slots)["automatic"])
            validate_selection(self.req, slots, [0], spool_revision(slots))

    def test_incompatible_or_empty_slots_rejected(self):
        for change in ({"material": "PETG"}, {"empty": True}, {"available": False}, {"maxTemp": 200}):
            slots = [dict(self.slots[0], **change)]
            self.assertFalse(plan(self.req, slots)["automatic"])
            with self.assertRaises(ValueError): validate_selection(self.req, slots, [0], spool_revision(slots))

    def test_swap_since_notification_rejected(self):
        revision = spool_revision(self.slots)
        slots = [dict(self.slots[0], uuid="replacement")]
        with self.assertRaises(ValueError): validate_selection(self.req, slots, [0], revision)

    def test_remaining_percentage_does_not_invalidate_choice(self):
        slots = [dict(self.slots[0], remainingPercent=50)]
        self.assertEqual(spool_revision(slots), spool_revision(self.slots))

    def test_external_tpu_and_mixed_feed(self):
        req = [dict(self.req[0], material="TPU")]
        slots = [dict(self.slots[0], material="TPU", id=-1), dict(self.slots[0], material="TPU")]
        self.assertEqual(plan(req, slots)["mapping"], [-1])
        self.assertTrue(plan(req, slots)["automatic"])
        with self.assertRaises(ValueError): validate_selection(req, slots, [0], spool_revision(slots))
        with self.assertRaises(ValueError): validate_selection(req * 2, slots, [-1, 0], spool_revision(slots))

    def test_missing_requirements_never_automatic(self):
        self.assertFalse(plan([], self.slots)["automatic"])

    def test_only_configured_printer_spools(self):
        attrs = {"slot": 2, "type": "PLA", "color": "#FF0000FF", "filament_id": "GFA00"}
        states = [{"entity_id": "sensor.ours", "state": "Generic PLA", "attributes": attrs},
                  {"entity_id": "sensor.other", "state": "Generic PLA", "attributes": attrs}]
        registry = [{"entity_id": "sensor.ours", "device_id": "ours"},
                    {"entity_id": "sensor.other", "device_id": "other"}]
        self.assertEqual([s["id"] for s in normalise_slots(states, registry, "ours", "ext")], [1])


if __name__ == "__main__": unittest.main()
