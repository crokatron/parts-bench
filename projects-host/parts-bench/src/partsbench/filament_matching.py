"""Conservative matching of sliced requirements to live Bambu spool reports.

Exact material/profile/color matches may start automatically. Human selections
can accept a different color or profile, but not a different material, an empty
slot, a mixed external/AMS feed, or TPU in this conventional X1C AMS.
"""
import hashlib
import json
import re


def material(value):
    return re.sub(r"[\s_-]+", "", str(value or "").upper())


def color(value):
    text = str(value or "").lstrip("#").upper()
    return text[:6] if re.fullmatch(r"[0-9A-F]{6}([0-9A-F]{2})?", text) else None


def spool_revision(slots):
    # Exclude remaining percentage: consuming filament should not invalidate a
    # pending choice. Include identity and temperature bounds to catch swaps.
    keys = ("id", "material", "color", "profile", "uuid", "empty", "available",
            "minTemp", "maxTemp")
    data = [{k: s.get(k) for k in keys} for s in sorted(slots, key=lambda x: x["id"])]
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def normalise_slots(states, registry, ams_device, external_device):
    """Device IDs come from the configured X1C, never from similarly named devices."""
    out = []
    devices = {e["entity_id"]: e.get("device_id") for e in registry}
    for state in states:
        eid = state["entity_id"]
        did = devices.get(eid)
        a = state.get("attributes", {})
        if did == ams_device and "slot" in a:
            slot = int(a["slot"])
            if slot not in (1, 2, 3, 4): continue
            sid, label = slot - 1, "AMS slot " + str(slot)
        elif did == external_device and "type" in a and "color" in a:
            sid, label = -1, "External spool"
        else:
            continue
        available = state.get("state") not in ("unavailable", "unknown", "empty", "Empty")
        out.append({"id": sid, "label": label, "name": a.get("name") or state.get("state"),
                    "material": str(a.get("type") or ""), "color": color(a.get("color")),
                    "profile": str(a.get("filament_id") or ""), "uuid": a.get("tray_uuid"),
                    "empty": bool(a.get("empty")) or not a.get("type"),
                    "available": available and not a.get("unknown", False),
                    "minTemp": a.get("nozzle_temp_min"), "maxTemp": a.get("nozzle_temp_max"),
                    "remainingPercent": a.get("remain") if a.get("remain_enabled") else None})
    return sorted(out, key=lambda x: x["id"])


def compatible(requirement, slot):
    if not slot.get("available") or slot.get("empty"):
        return False
    mat = material(requirement.get("material"))
    if not mat or mat != material(slot.get("material")):
        return False
    # Conventional X1C AMS cannot feed ordinary flexible TPU. Do not infer
    # compatibility from an overly broad "TPU" material label.
    if mat.startswith("TPU") and slot["id"] >= 0:
        return False
    temp = requirement.get("temperature")
    lo, hi = slot.get("minTemp"), slot.get("maxTemp")
    if temp is not None and lo and hi:
        try:
            if not float(lo) <= float(temp) <= float(hi): return False
        except (ValueError, TypeError): return False
    return True


def plan(requirements, slots):
    choices, mapping = [], []
    for req in requirements:
        candidates = [s for s in slots if compatible(req, s)]
        exact = [s for s in candidates if color(req.get("color")) is not None
                 and color(req.get("color")) == color(s.get("color"))
                 and req.get("profile") and req["profile"] == s.get("profile")]
        selected = exact[0]["id"] if len(exact) == 1 else None
        mapping.append(selected)
        choices.append({"requirement": req, "candidates": candidates, "suggested": selected})
    automatic = bool(requirements) and all(s is not None for s in mapping)
    if automatic and -1 in mapping and (len(mapping) != 1 or any(s != -1 for s in mapping)):
        automatic = False
    return {"automatic": automatic, "mapping": mapping, "choices": choices,
            "slotRevision": spool_revision(slots)}


def validate_selection(requirements, slots, mapping, revision):
    if revision != spool_revision(slots):
        raise ValueError("Loaded filament changed. Refresh and choose again.")
    if not requirements or len(mapping) != len(requirements):
        raise ValueError("Choose a source for every filament in this plate.")
    if any(type(v) is not int for v in mapping):
        raise ValueError("Invalid filament source.")
    if -1 in mapping and len(mapping) != 1:
        raise ValueError("The external spool can only supply a single-filament plate.")
    by_id = {s["id"]: s for s in slots}
    for req, sid in zip(requirements, mapping):
        if sid not in by_id or not compatible(req, by_id[sid]):
            raise ValueError("Selected source is unavailable or its material is incompatible.")
    return {"use_ams": -1 not in mapping, "ams_mapping": ",".join(map(str, mapping))}
