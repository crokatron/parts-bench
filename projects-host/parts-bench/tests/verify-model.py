#!/usr/bin/env python3
"""
Recompute every published reference point from spec/model.json and check it
against spec/calibration.json.

Dependency-free and self-contained: it re-implements the flow model from the
spec rather than importing the app, so it verifies the SPEC is right, not just
that the code agrees with itself.

    python3 tests/verify-model.py

Exit status 0 if every row is inside tolerance, 1 otherwise.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = os.path.join(os.path.dirname(HERE), "spec")

model = json.load(open(os.path.join(SPEC, "model.json"), encoding="utf-8"))
calib = json.load(open(os.path.join(SPEC, "calibration.json"), encoding="utf-8"))

MATS, BODIES = model["materials"], model["hotendBodies"]

def flow_ceiling(body_key, diameter_mm, nozzle_class, material_key):
    """Q_max = min(A * highFlowResponse * V_eff, hotend rating)."""
    body, mat = BODIES[body_key], MATS[material_key]
    v0 = body["vEffMm3At0p4"].get(nozzle_class, body["vEffMm3At0p4"]["standard"])
    e  = mat["expHighFlow"] if nozzle_class == "highflow" else mat["expStandard"]
    hf = mat["highFlowResponse"] if nozzle_class == "highflow" else 1.0
    v_eff = v0 * (diameter_mm / 0.4) ** e
    return min(mat["meltCoefA"] * hf * v_eff, body["ratingMm3s"])

tol   = calib["acceptance"]["allWithinPct"]
worst_allowed = calib["acceptance"]["worstCasePct"]
rows  = calib["rows"]
fails, worst = [], 0.0

print(f"\n  Flow model against {len(rows)} published reference points")
print(f"  tolerance {tol}%, expected worst case {worst_allowed}%\n")
print(f"  {'source':<28}{'material':<9}{'class':<10}{'Ø':>5}{'model':>9}{'published':>11}{'error':>9}")
print("  " + "-" * 79)

for r in rows:
    got = flow_ceiling(r["hotendBody"], r["nozzleMm"], r["nozzleClass"], r["material"])
    err = (got - r["publishedMm3s"]) / r["publishedMm3s"] * 100
    worst = max(worst, abs(err))
    flag = "" if abs(err) <= tol else "  <-- OUT OF TOLERANCE"
    if flag: fails.append((r, got, err))
    print(f"  {r['source']:<28}{r['material']:<9}{r['nozzleClass']:<10}"
          f"{r['nozzleMm']:>5}{got:>9.1f}{r['publishedMm3s']:>11}{err:>8.1f}%{flag}")

print("  " + "-" * 79)
print(f"  worst deviation {worst:.1f}%   within {tol}%: {len(rows)-len(fails)}/{len(rows)}")

# The Bambu 0.6 high-flow row must be clipped by the hotend rating, not fitted.
unclipped = (MATS["PLA"]["meltCoefA"] * MATS["PLA"]["highFlowResponse"]
             * BODIES["h2_stock"]["vEffMm3At0p4"]["highflow"]
             * (0.6 / 0.4) ** MATS["PLA"]["expHighFlow"])
rating = BODIES["h2_stock"]["ratingMm3s"]
ok_oos = unclipped > rating
print(f"\n  out-of-sample check: H2 0.6 high-flow computes {unclipped:.1f} mm3/s "
      f"unclipped, rating clips to {rating}  ->  {'ok' if ok_oos else 'FAILED - now fitted, not clipped'}")

if fails or not ok_oos or worst > worst_allowed + 0.05:
    print("\n  FAIL - the model no longer reproduces its published anchors.\n")
    sys.exit(1)
print("\n  PASS\n")
