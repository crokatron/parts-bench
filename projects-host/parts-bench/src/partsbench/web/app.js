"use strict";

/* ============================================================================
   FILAMENT BENCH
   Physical model summary (full derivation in the Reference tab):
     Q_melt = A_mat · V_eff        melt-rate ceiling, conduction limited
     V_eff  = V_eff(0.4) · (D/0.4)^e     e = 0.30 standard, 0.80 high-flow
     Q_max  = min(Q_melt, hotend rating)
     A      = w·h − h²(1 − π/4)     extrusion cross-section
     P      = Q·ρ·(c_p·ΔT + Δh_f)   heater power required
     τ      = V_eff / Q             melt residence time
     γ̇_w   = Q(3n+1)/(π n R³)      wall shear rate at the nozzle land
     ΔP     = 2·K·γ̇_w^n·L/R        pressure drop, power-law melt
   Calibrated against E3D's published Revo flow table and Bambu's own
   max-volumetric-speed figures; reproduces both within ~6%.
   ========================================================================= */

/* ------------------------------- constants ------------------------------ */
const FIL_R = 0.875;                 // filament radius, mm
const FIL_AREA = Math.PI * FIL_R * FIL_R;   // 2.405 mm²
const A_PLA = 0.325;                 // melt coefficient anchor, s⁻¹
const LAND = 0.6;                    // nozzle land length, mm
const AMBIENT = 25;

const PRINTERS = {
  x1c:{ name:"X1 Carbon", short:"X1C", maxNozzleT:300, maxBedT:120, chamber:"passive",
        maxChamber:60, heaterW:48, build:[256,256,256], profile:"Bambu Lab X1 Carbon",
        note:"No active chamber heater — chamber rises passively to roughly 45–55 °C with the door shut." },
  h2s:{ name:"H2S", short:"H2S", maxNozzleT:350, maxBedT:120, chamber:"active",
        maxChamber:65, heaterW:65, build:[340,320,340], profile:"Bambu Lab H2S",
        note:"Active chamber heating to 65 °C and a 350 °C hotend — the engineering materials are in reach here." },
  h2c:{ name:"H2C", short:"H2C", maxNozzleT:350, maxBedT:120, chamber:"active",
        maxChamber:65, heaterW:65, build:[325,320,320], profile:"Bambu Lab H2C",
        note:"Dual-nozzle multi-material. Per-nozzle build volume is smaller than the combined figure." }
};

// vEff = effective melt-zone volume at a 0.4 mm nozzle, mm³. cap = vendor flow rating, mm³/s.
const BODIES = {
  x1c_stock:{ name:"X1C stock hotend", printers:["x1c"], vEff:{standard:64.6}, cap:32, heaterW:48,
              maxT:300, paFactor:1.00, retract:0.8,
              anchor:"Bambu PLA Basic on X1C 0.4 = 21 mm³/s" },
  h2_stock:{ name:"H2 standard hotend", printers:["h2s","h2c"], vEff:{standard:76.9, highflow:107.7}, cap:40, heaterW:65,
              maxT:350, paFactor:1.00, retract:0.8,
              anchor:"Bambu wiki: H2S 0.4 + PLA Basic = 25 mm³/s; 0.4 high-flow ≈ 35" },
  h2_hf:{ name:"H2 high-flow hotend", printers:["h2s","h2c"], vEff:{standard:76.9, highflow:107.7}, cap:65, heaterW:65,
              maxT:350, paFactor:1.15, retract:0.9,
              anchor:"H2S high-flow hotend rated 65 mm³/s" },
  revo:{ name:"E3D / BIQU Revo (60 W)", printers:["x1c","h2s","h2c"], vEff:{standard:40, highflow:49.2}, cap:40, heaterW:60,
              maxT:300, paFactor:0.75, retract:0.6,
              anchor:"E3D published: Revo 0.4 PLA = 13 mm³/s, HF 0.4 = 16" }
};

const NOZZLE_CLASS = { standard:{ label:"Standard", e:0.30 }, highflow:{ label:"High flow", e:0.80 } };
const NOZZLE_MATS = {
  hardened:{ label:"Hardened steel", hrc:60, abrasiveOK:true, wearKg:6 },
  steel:   { label:"Plated / stainless", hrc:35, abrasiveOK:false, wearKg:1.2 },
  brass:   { label:"Brass", hrc:12, abrasiveOK:false, wearKg:0.4 },
  ruby:    { label:"Ruby / carbide tip", hrc:90, abrasiveOK:true, wearKg:40 },
  tungsten:{ label:"Tungsten carbide", hrc:80, abrasiveOK:true, wearKg:25 }
};

/* Material model. A = melt coefficient (s⁻¹ per mm³ of melt zone).
   n,K = power-law melt rheology at print temperature. cp J/g·K, hf latent J/g. */
const MATERIALS = {
  PLA:      {A:.325,dryMax:55,hfResp:1.0,eS:0.39,eH:0.82,rho:1.24,cp:1.9,hf:45,n:.35,K:8000, t:220,t1:220,tlo:190,thi:240,bed:55,bed1:55,cool:35,cham:0,tg:60,
             fanMin:100,fanMax:100,ohFan:100,ohThr:"50%",slow:4,slowV:20,flow:1.0,retract:1.0,dryT:45,dryH:12,hrc:3,abr:0,
             label:"PLA"},
  "PLA-CF": {A:.26,dryMax:60,hfResp:1.05,eS:0.39,eH:0.82,rho:1.22,cp:1.9,hf:38,n:.33,K:11000,t:230,t1:230,tlo:210,thi:250,bed:55,bed1:55,cool:35,cham:0,tg:60,
             fanMin:60,fanMax:80,ohFan:90,ohThr:"50%",slow:4,slowV:20,flow:.98,retract:1.0,dryT:55,dryH:8,hrc:60,abr:1,
             label:"PLA-CF / PLA-GF"},
  "PLA-Silk":{A:.30,dryMax:50,hfResp:1.0,eS:0.39,eH:0.82,rho:1.24,cp:1.9,hf:40,n:.35,K:8500,t:230,t1:230,tlo:210,thi:250,bed:55,bed1:55,cool:35,cham:0,tg:60,
             fanMin:60,fanMax:80,ohFan:90,ohThr:"50%",slow:5,slowV:20,flow:1.0,retract:1.1,dryT:45,dryH:12,hrc:3,abr:0,
             label:"PLA Silk / Matte"},
  "PLA-Aero":{A:.20,dryMax:55,hfResp:1.05,eS:0.39,eH:0.82,rho:1.22,cp:1.9,hf:42,n:.35,K:9000,t:235,t1:235,tlo:220,thi:260,bed:55,bed1:55,cool:35,cham:0,tg:60,
             fanMin:50,fanMax:80,ohFan:90,ohThr:"50%",slow:5,slowV:20,flow:.60,retract:1.2,dryT:45,dryH:12,hrc:3,abr:0,
             label:"PLA Aero (foaming)"},
  PETG:     {A:.425,dryMax:70,hfResp:1.29,eS:0.23,eH:0.48,rho:1.27,cp:1.8,hf:0,n:.40,K:13000,t:255,t1:255,tlo:230,thi:270,bed:70,bed1:70,cool:0,cham:0,tg:78,
             fanMin:30,fanMax:60,ohFan:80,ohThr:"25%",slow:6,slowV:20,flow:.95,retract:1.2,dryT:65,dryH:8,hrc:3,abr:0,
             label:"PETG"},
  "PETG-CF":{A:.34,dryMax:75,hfResp:1.3,eS:0.23,eH:0.48,rho:1.30,cp:1.8,hf:0,n:.38,K:17000,t:260,t1:260,tlo:240,thi:280,bed:70,bed1:70,cool:0,cham:0,tg:80,
             fanMin:20,fanMax:50,ohFan:70,ohThr:"25%",slow:6,slowV:20,flow:.96,retract:1.1,dryT:70,dryH:8,hrc:60,abr:1,
             label:"PETG-CF"},
  ABS:      {A:.375,dryMax:90,hfResp:1.41,eS:0.18,eH:0.38,rho:1.05,cp:1.9,hf:0,n:.32,K:16000,t:260,t1:265,tlo:240,thi:280,bed:95,bed1:95,cool:0,cham:45,tg:105,
             fanMin:0,fanMax:20,ohFan:40,ohThr:"25%",slow:8,slowV:20,flow:.97,retract:1.0,dryT:80,dryH:8,hrc:3,abr:0,
             label:"ABS"},
  ASA:      {A:.375,dryMax:90,hfResp:1.41,eS:0.18,eH:0.38,rho:1.06,cp:1.9,hf:0,n:.32,K:17000,t:260,t1:265,tlo:240,thi:280,bed:95,bed1:95,cool:0,cham:45,tg:108,
             fanMin:0,fanMax:20,ohFan:40,ohThr:"25%",slow:8,slowV:20,flow:.97,retract:1.0,dryT:80,dryH:8,hrc:3,abr:0,
             label:"ASA"},
  "ASA-CF": {A:.30,dryMax:95,hfResp:1.35,eS:0.18,eH:0.38,rho:1.11,cp:1.9,hf:0,n:.30,K:22000,t:270,t1:270,tlo:250,thi:290,bed:95,bed1:95,cool:0,cham:50,tg:110,
             fanMin:0,fanMax:15,ohFan:30,ohThr:"25%",slow:8,slowV:20,flow:.96,retract:1.0,dryT:80,dryH:8,hrc:60,abr:1,
             label:"ASA-CF / ABS-GF"},
  PC:       {A:.28,dryMax:110,hfResp:1.35,eS:0.2,eH:0.42,rho:1.19,cp:1.8,hf:0,n:.36,K:24000,t:270,t1:275,tlo:255,thi:295,bed:100,bed1:100,cool:0,cham:50,tg:147,
             fanMin:0,fanMax:10,ohFan:30,ohThr:"25%",slow:10,slowV:20,flow:.97,retract:1.0,dryT:100,dryH:8,hrc:3,abr:0,
             label:"PC"},
  "PC-CF":  {A:.24,dryMax:110,hfResp:1.35,eS:0.2,eH:0.42,rho:1.22,cp:1.8,hf:0,n:.34,K:30000,t:280,t1:285,tlo:265,thi:300,bed:100,bed1:100,cool:0,cham:55,tg:148,
             fanMin:0,fanMax:10,ohFan:25,ohThr:"25%",slow:10,slowV:20,flow:.96,retract:1.0,dryT:100,dryH:8,hrc:60,abr:1,
             label:"PC-CF"},
  PA:       {A:.26,dryMax:100,hfResp:1.1,eS:0.3,eH:0.63,rho:1.06,cp:2.0,hf:60,n:.45,K:9000,t:290,t1:290,tlo:270,thi:310,bed:100,bed1:100,cool:0,cham:50,tg:60,
             fanMin:0,fanMax:20,ohFan:40,ohThr:"25%",slow:8,slowV:20,flow:.97,retract:1.1,dryT:90,dryH:12,hrc:3,abr:0,
             label:"PA (nylon)"},
  "PA-CF":  {A:.24,dryMax:110,hfResp:1.15,eS:0.3,eH:0.63,rho:1.19,cp:1.9,hf:45,n:.42,K:14000,t:300,t1:300,tlo:280,thi:320,bed:100,bed1:100,cool:0,cham:55,tg:70,
             fanMin:0,fanMax:20,ohFan:40,ohThr:"25%",slow:8,slowV:20,flow:.96,retract:1.0,dryT:100,dryH:12,hrc:60,abr:1,
             label:"PA-CF / PAHT-CF"},
  "PPA-CF": {A:.20,dryMax:130,hfResp:1.15,eS:0.3,eH:0.63,rho:1.16,cp:1.9,hf:50,n:.40,K:19000,t:310,t1:310,tlo:290,thi:330,bed:110,bed1:110,cool:0,cham:60,tg:125,
             fanMin:0,fanMax:10,ohFan:25,ohThr:"25%",slow:10,slowV:20,flow:.96,retract:1.0,dryT:120,dryH:12,hrc:60,abr:1,
             label:"PPA-CF"},
  "PET-CF": {A:.26,dryMax:110,hfResp:1.2,eS:0.3,eH:0.63,rho:1.35,cp:1.8,hf:35,n:.38,K:16000,t:290,t1:290,tlo:270,thi:310,bed:100,bed1:100,cool:0,cham:55,tg:80,
             fanMin:0,fanMax:20,ohFan:40,ohThr:"25%",slow:8,slowV:20,flow:.96,retract:1.0,dryT:100,dryH:12,hrc:60,abr:1,
             label:"PET-CF"},
  "TPU-95A":{A:.09,dryMax:75,hfResp:1.45,eS:0.2,eH:0.42,rho:1.22,cp:1.9,hf:0,n:.45,K:34000,t:235,t1:235,tlo:215,thi:250,bed:35,bed1:35,cool:35,cham:0,tg:-30,
             fanMin:50,fanMax:80,ohFan:90,ohThr:"50%",slow:6,slowV:15,flow:1.02,retract:.5,dryT:70,dryH:8,hrc:3,abr:0,
             label:"TPU 95A"},
  "TPU-85A":{A:.065,dryMax:70,hfResp:1.45,eS:0.2,eH:0.42,rho:1.20,cp:1.9,hf:0,n:.48,K:48000,t:225,t1:225,tlo:210,thi:240,bed:35,bed1:35,cool:35,cham:0,tg:-35,
             fanMin:50,fanMax:80,ohFan:90,ohThr:"50%",slow:8,slowV:10,flow:1.03,retract:.35,dryT:65,dryH:8,hrc:3,abr:0,
             label:"TPU 85A"},
  PVA:      {A:.16,dryMax:70,hfResp:1.25,eS:0.26,eH:0.55,rho:1.23,cp:1.9,hf:0,n:.42,K:15000,t:220,t1:220,tlo:200,thi:240,bed:60,bed1:60,cool:35,cham:0,tg:45,
             fanMin:50,fanMax:100,ohFan:100,ohThr:"50%",slow:5,slowV:20,flow:1.0,retract:1.1,dryT:65,dryH:12,hrc:3,abr:0,
             label:"PVA (support)"},
  HIPS:     {A:.32,dryMax:80,hfResp:1.4,eS:0.18,eH:0.38,rho:1.04,cp:1.9,hf:0,n:.33,K:15000,t:245,t1:245,tlo:230,thi:260,bed:100,bed1:100,cool:0,cham:40,tg:100,
             fanMin:0,fanMax:30,ohFan:50,ohThr:"25%",slow:8,slowV:20,flow:.97,retract:1.0,dryT:70,dryH:6,hrc:3,abr:0,
             label:"HIPS"},
  PP:       {A:.28,dryMax:80,hfResp:1.15,eS:0.26,eH:0.55,rho:0.92,cp:2.1,hf:75,n:.38,K:12000,t:240,t1:240,tlo:220,thi:260,bed:100,bed1:100,cool:0,cham:40,tg:-10,
             fanMin:30,fanMax:60,ohFan:70,ohThr:"25%",slow:8,slowV:20,flow:.95,retract:1.1,dryT:70,dryH:6,hrc:3,abr:0,
             label:"PP"},
  "PPS-CF": {A:.20,dryMax:130,hfResp:1.2,eS:0.26,eH:0.55,rho:1.42,cp:1.7,hf:55,n:.40,K:20000,t:320,t1:320,tlo:300,thi:340,bed:110,bed1:110,cool:0,cham:65,tg:90,
             fanMin:0,fanMax:10,ohFan:20,ohThr:"25%",slow:10,slowV:20,flow:.96,retract:1.0,dryT:120,dryH:12,hrc:60,abr:1,
             label:"PPS-CF"}
};

const PA_BASE = { PLA:.020,"PLA-CF":.016,"PLA-Silk":.022,"PLA-Aero":.045,PETG:.028,"PETG-CF":.022,
  ABS:.024,ASA:.024,"ASA-CF":.019,PC:.026,"PC-CF":.021,PA:.030,"PA-CF":.024,"PPA-CF":.022,
  "PET-CF":.026,"TPU-95A":.10,"TPU-85A":.15,PVA:.035,HIPS:.022,PP:.030,"PPS-CF":.020 };

const GOALS = {
  balanced:{ label:"Balanced", flowUse:.85, dT:0, fanD:0, flowRatioD:0 },
  speed:   { label:"Throughput", flowUse:.95, dT:6, fanD:5, flowRatioD:0 },
  strength:{ label:"Mechanical strength", flowUse:.75, dT:8, fanD:-20, flowRatioD:.01 },
  cosmetic:{ label:"Surface finish", flowUse:.60, dT:-4, fanD:10, flowRatioD:0 },
  accuracy:{ label:"Dimensional accuracy", flowUse:.65, dT:-3, fanD:5, flowRatioD:-.01 }
};

/* Bambu Studio filament keys the advanced editor offers. Names are the real
   profile keys as shipped in BambuStudio/resources/profiles/BBL/filament. */
const BAMBU_KEYS = [
  ["Temperature",["nozzle_temperature","nozzle_temperature_initial_layer","nozzle_temperature_range_low",
    "nozzle_temperature_range_high","temperature_vitrification","chamber_temperatures","hot_plate_temp",
    "hot_plate_temp_initial_layer","cool_plate_temp","cool_plate_temp_initial_layer","eng_plate_temp",
    "eng_plate_temp_initial_layer","textured_plate_temp","textured_plate_temp_initial_layer",
    "supertack_plate_temp","supertack_plate_temp_initial_layer"]],
  ["Flow & material",["filament_max_volumetric_speed","filament_flow_ratio","filament_density","filament_diameter",
    "filament_shrink","filament_cost","filament_type","filament_vendor","filament_soluble","filament_is_support",
    "required_nozzle_HRC","impact_strength_z","filament_adaptive_volumetric_speed","volumetric_speed_coefficients"]],
  ["Cooling",["fan_min_speed","fan_max_speed","fan_cooling_layer_time","close_fan_the_first_x_layers",
    "full_fan_speed_layer","overhang_fan_speed","overhang_fan_threshold","additional_cooling_fan_speed",
    "close_additional_fan_first_x_layers","slow_down_layer_time","slow_down_min_speed","slow_down_for_layer_cooling",
    "reduce_fan_stop_start_freq","during_print_exhaust_fan_speed","complete_print_exhaust_fan_speed",
    "activate_air_filtration"]],
  ["Retraction",["filament_retraction_length","filament_retraction_speed","filament_deretraction_speed",
    "filament_retraction_minimum_travel","filament_z_hop","filament_z_hop_types","filament_wipe",
    "filament_wipe_distance","filament_retract_before_wipe","filament_retract_restart_extra",
    "filament_retract_when_changing_layer","filament_retract_length_nc"]],
  ["Overhang & bridging",["filament_bridge_speed","filament_enable_overhang_speed","filament_overhang_1_4_speed",
    "filament_overhang_2_4_speed","filament_overhang_3_4_speed","filament_overhang_4_4_speed",
    "filament_overhang_totally_speed"]],
  ["Multi-material",["filament_prime_volume","filament_minimal_purge_on_wipe_tower","filament_flush_temp",
    "filament_flush_volumetric_speed","filament_change_length","filament_ramming_volumetric_speed",
    "filament_tower_interface_purge_volume","filament_scarf_seam_type","filament_scarf_gap","filament_scarf_height"]],
  ["Drying",["filament_dev_ams_drying_temperature","filament_dev_ams_drying_time",
    "filament_dev_chamber_drying_bed_temperature","filament_dev_chamber_drying_time",
    "filament_dev_drying_softening_temperature","filament_dev_drying_cooling_temperature"]],
  ["Dimensional compensation",["hole_coef_1","hole_coef_2","hole_coef_3","hole_limit_min","hole_limit_max",
    "counter_coef_1","counter_coef_2","counter_coef_3","counter_limit_min","counter_limit_max","diameter_limit"]],
  ["G-code",["filament_start_gcode","filament_end_gcode"]]
];

/* --------------------------- diagnostic corpus -------------------------- */
/* w = base weight. Modifiers adjust by context. */
const SYMPTOMS = [
  { id:"stringing", label:"Stringing and oozing", hint:"Fine strands between islands", causes:[
    { t:"Moisture in the filament", w:.9, hygro:true, why:"Absorbed water flashes to steam in the melt zone and drives filament out of the nozzle during travel. It is the single most common cause of stringing on a machine whose retraction is already tuned.",
      fixes:[["act","Dry",'Dry at the material\'s drying temperature for the full cycle, then re-run the same print without touching retraction'],["set","Check","Extrude 100 mm in air and listen — steam ticking or a wandering strand confirms it"]],
      next:"Print a two-tower retraction test straight after drying. If stringing is gone, the parameters were never wrong." },
    { t:"Nozzle temperature above the material's flow window", w:.75, why:"Lower viscosity means the melt drains under its own head pressure faster than retraction can hold it.",
      fixes:[["down","−10 °C","nozzle_temperature, keeping the first layer where it is"],["down","−5 °C","repeat if strings persist and layer adhesion still passes a snap test"]],
      next:"Temperature tower in 5 °C steps across the material range, judged on strings and on layer bonding together." },
    { t:"Retraction too short for this melt-zone volume", w:.6, why:"Retraction has to unload the compressed melt column. A larger melt zone stores more, so a value tuned on one hotend does not transfer to another.",
      fixes:[["up","+0.2 mm","filament_retraction_length, to a ceiling of about 1.5 mm on direct drive"],["up","+5 mm/s","filament_retraction_speed if the extruder is not skipping"]],
      next:"Retraction tower, 0.4 → 1.4 mm. Stop at the first value that is clean; longer is not better and invites clogs." },
    { t:"Travel avoiding the wipe", w:.4, why:"Without a wipe move the pressure that remains after retraction lands on the next seam as a strand.",
      fixes:[["set","On","filament_wipe"],["up","+2 mm","filament_wipe_distance"]],
      next:"Slice one layer and inspect the travel preview for retract-then-move ordering." },
    { t:"Partially blocked nozzle", w:.35, drift:true, why:"A partial obstruction raises the pressure the retraction has to relieve and leaves residual ooze even at correct settings.",
      fixes:[["act","Cold pull","Two cold pulls at the material's softening point, then inspect the tip"],["act","Replace","Swap the nozzle if the pulls come out with carbon flecks"]],
      next:"Weigh a 100 mm extrusion at a known flow. Under-delivery of more than 4% points at the nozzle, not the settings." }
  ]},
  { id:"blobs", label:"Blobs, zits and seam bulges", hint:"Raised dots on the outer wall", causes:[
    { t:"Pressure advance too low", w:.85, why:"Without enough advance the extruder does not unload before a stop, so the residual pressure deposits at the seam.",
      fixes:[["up","+0.004","pressure advance / k factor"],["set","Run","Bambu flow-dynamics calibration for this specific spool, not the SKU"]],
      next:"PA pattern test. Read the line where the corner deposit disappears without the corner going hollow." },
    { t:"Seam placement on a visible face", w:.6, why:"The seam is a real artefact of a stop-start; moving it is cheaper than eliminating it.",
      fixes:[["set","Scarf","filament_scarf_seam_type to a scarf joint"],["act","Move","Set seam painting to a rear or internal edge"]],
      next:"Print the same wall with scarf seam on and off, side by side." },
    { t:"Retraction restart extra overfeeding", w:.45, why:"Restart extra compensates for ooze; when ooze is already controlled it becomes an over-extrusion at every restart.",
      fixes:[["down","→ 0","filament_retract_restart_extra"]],
      next:"Single-wall vase print — restart artefacts show up unmistakably." },
    { t:"Wet filament boiling at the seam pause", w:.4, hygro:true, why:"Dwell time at the seam gives steam a moment to form a bubble that bursts as the head moves off.",
      fixes:[["act","Dry","Full drying cycle before touching PA"]],
      next:"Compare a seam close-up before and after drying." }
  ]},
  { id:"corner_bulge", label:"Corner bulging", hint:"Walls fatten at direction changes", causes:[
    { t:"Pressure advance too low", w:.95, why:"The melt column stays compressed through the deceleration, so the slow-moving nozzle lays down more material than the geometry asks for.",
      fixes:[["up","+0.006","k factor, then bisect"],["set","Run","Flow-dynamics calibration per spool"]],
      next:"PA line test at your actual print acceleration — PA measured at a different acceleration will not transfer." },
    { t:"Acceleration set higher than the PA value was tuned at", w:.5, why:"Advance compensation scales with the rate of velocity change; retuning acceleration invalidates the k factor.",
      fixes:[["act","Retune","Re-run PA calibration at the acceleration the profile actually uses"]],
      next:"Note the acceleration on the calibration print so the pair stays together." },
    { t:"Over-extrusion masking as a corner defect", w:.35, why:"If flow ratio is high everywhere, corners are simply where it becomes visible first.",
      fixes:[["down","−0.02","filament_flow_ratio"]],
      next:"Single-wall cube, measure the wall with a micrometer at mid-height and compare to line width." }
  ]},
  { id:"underextrusion", label:"Under-extrusion, gaps between lines", hint:"Visible voids in walls and top", causes:[
    { t:"Commanded flow above the hotend's melt ceiling", w:.9, why:"Past the melt rate the hotend can supply, the extruder skips or the melt leaves the nozzle short. This is the ceiling the Recommend tab computes.",
      fixes:[["down","Set","filament_max_volumetric_speed to the computed ceiling for this hotend and nozzle"],["up","+10 °C","nozzle_temperature if there is headroom in the material range"]],
      next:"Run the flow-rate test in the Recommend tab's derivation, then record the measured value against the spool." },
    { t:"Worn nozzle bore", w:.7, abrasive:true, drift:true, why:"An abraded orifice goes oval and oversize; the slicer's line width no longer matches what the nozzle lays down, and the deficit shows as gaps.",
      fixes:[["act","Replace","Fit a fresh nozzle of the same size and class"],["act","Log","Record kilograms through the nozzle in the Hotends tab"]],
      next:"Print a single-wall cube before and after the swap and measure both. A width change of more than 0.03 mm confirms wear." },
    { t:"Partial clog", w:.6, why:"Carbonised material narrows the bore and throttles flow before the extruder complains.",
      fixes:[["act","Cold pull","Cold pull twice, then a purge at 20 °C above normal"],["act","Replace","Replace if pulls come out discoloured"]],
      next:"Weigh 100 mm of extrusion at a known volumetric rate; compare to filament cross-section × length × density." },
    { t:"Flow ratio calibrated on a different batch", w:.5, why:"Diameter tolerance and pigment loading vary lot to lot; a flow ratio is a per-batch number, not a per-brand one.",
      fixes:[["set","Recalibrate","filament_flow_ratio for this batch"],["act","Measure","Ten diameter readings along a metre of filament"]],
      next:"Flow calibration cube for this batch, then store the value against the batch in the library." },
    { t:"Extruder gear slipping on soft or dusty filament", w:.3, why:"Grip loss delivers less than the commanded length without any error being raised.",
      fixes:[["act","Clean","Clean the drive gear teeth"],["down","−15%","commanded flow while testing whether skipping stops"]],
      next:"Mark the filament 100 mm above the entry, command 100 mm, measure what actually fed." }
  ]},
  { id:"overextrusion", label:"Over-extrusion, rough top, elephant foot", hint:"Surfaces proud, first layer squashed wide", causes:[
    { t:"Flow ratio high for this batch", w:.85, why:"Flow ratio is the direct multiplier on extruded volume; a batch with slightly oversize filament pushes more than the model assumes.",
      fixes:[["down","−0.02","filament_flow_ratio"],["act","Measure","Filament diameter at ten points and set filament_diameter to the mean"]],
      next:"Flow calibration cube; measure the top surface flatness rather than the wall." },
    { t:"First-layer squish set for a different plate", w:.55, why:"Textured, engineering and Supertack plates sit at different effective heights; a Z offset tuned on one over-squashes on another.",
      fixes:[["set","Adjust","Z offset for the plate actually installed"],["set","Match","the plate-specific bed temperature key"]],
      next:"First-layer patch test on the plate in use." },
    { t:"Nozzle temperature high enough to slump the bead", w:.4, why:"An over-hot bead spreads after deposition and reads as over-extrusion even at correct flow.",
      fixes:[["down","−10 °C","nozzle_temperature"]],
      next:"Temperature tower judged on top-surface finish." }
  ]},
  { id:"adhesion", label:"Poor layer adhesion, parts split under load", hint:"Clean break along a layer line", causes:[
    { t:"Cooling too aggressive for the material", w:.85, why:"Interlayer strength is diffusion across the weld, and diffusion needs time above the glass transition. Fan robs exactly that time.",
      fixes:[["down","−20%","fan_max_speed and fan_min_speed"],["down","Lower","overhang_fan_speed, accepting softer overhangs"]],
      next:"Print two identical tensile bars at the current and reduced fan, and break both." },
    { t:"Nozzle temperature at the bottom of the window", w:.8, why:"Weld strength rises steeply with melt temperature until degradation sets in. Most adhesion complaints are a 15 °C problem.",
      fixes:[["up","+15 °C","nozzle_temperature, staying inside nozzle_temperature_range_high"],["up","+5 °C","again if the break is still along the layer"]],
      next:"Temperature tower broken by hand at each step rather than inspected visually." },
    { t:"Chamber too cold for an amorphous engineering polymer", w:.7, needsChamber:true, why:"Below the material's glass transition the previous layer has already vitrified when the next arrives, so the weld never forms properly.",
      fixes:[["up","Raise","chamber_temperatures toward the material's guidance"],["act","Close","Door and top closed for the whole print, not just the start"]],
      next:"Same part, chamber cold versus hot, broken and compared." },
    { t:"Moisture degrading the weld", w:.55, hygro:true, why:"Hydrolysis shortens polymer chains in polyesters and polyamides; the material extrudes but never regains strength.",
      fixes:[["act","Dry","Full drying cycle, then print from a heated or desiccated feed"]],
      next:"Break a bar printed from dried stock against one from the open spool." },
    { t:"Line width too narrow to bond", w:.35, why:"A thin bead has less contact area with the layer below.",
      fixes:[["up","→ 0.42–0.48","line width for a 0.4 nozzle"],["down","−0.04 mm","layer height for the same effect"]],
      next:"Compare bars at 0.42 and 0.48 mm width." }
  ]},
  { id:"warping", label:"Warping and corner lift", hint:"Part peels from the plate at corners", causes:[
    { t:"Chamber below the material's glass transition", w:.9, needsChamber:true, why:"Every layer contracts as it cools through Tg. If the part sits far below Tg, that contraction accumulates as internal stress with nowhere to go but the corners.",
      fixes:[["up","Raise","chamber_temperatures to within 40–60 °C of the material's Tg where the printer allows"],["act","Enclose","Close the machine and let it soak before starting"]],
      next:"Print the same footprint with the chamber cold and hot; measure corner lift with feeler gauges." },
    { t:"Bed temperature below the material's Tg at the first layer", w:.75, why:"The plate has to hold the base layers above their softening point or the anchor releases before the print finishes.",
      fixes:[["up","+5 °C","the plate-specific bed temperature key in use"],["set","Match","hot_plate_temp_initial_layer to the running bed temperature"]],
      next:"Adhesion patch test at three bed temperatures." },
    { t:"Cooling fan running on a warp-prone material", w:.6, why:"Fan accelerates the contraction that causes the stress.",
      fixes:[["down","→ 0–15%","fan_max_speed"],["set","→ 3","close_fan_the_first_x_layers or more"]],
      next:"Same part with fan disabled entirely as the control." },
    { t:"Footprint geometry concentrating stress", w:.4, why:"Sharp corners and thin footprints have the smallest anchor area per unit of accumulated stress.",
      fixes:[["act","Brim","Add a brim of at least 5 mm"],["act","Fillet","Fillet base corners in CAD if the design allows"]],
      next:"Add a brim as a diagnostic — if lift stops, the problem is anchoring, not thermal." },
    { t:"Plate contamination", w:.35, why:"Skin oils are the usual culprit and defeat an otherwise correct thermal setup.",
      fixes:[["act","Wash","Hot water and dish soap, not isopropyl alone, then dry fully"]],
      next:"Wash and repeat the identical print before changing any parameter." }
  ]},
  { id:"cracking", label:"Cracking or delamination on tall parts", hint:"Splits appear well above the plate", causes:[
    { t:"Thermal gradient up the build height", w:.9, needsChamber:true, why:"The base sits in warm air near the bed while the top cools in a colder zone. The accumulated differential shear finally exceeds the weld strength at some height.",
      fixes:[["up","Raise","chamber_temperatures and let the machine soak for 15 minutes before the print"],["down","Lower","bed temperature slightly once the chamber is hot, to flatten the gradient"]],
      next:"Log chamber temperature against build height on a failed print; the crack usually sits at the gradient knee." },
    { t:"Fan cycling on small upper layers", w:.6, why:"As cross-section shrinks the cooling logic raises fan and lowers speed, quenching exactly the layers that are already weakest.",
      fixes:[["down","−20%","fan_max_speed"],["set","On","reduce_fan_stop_start_freq"],["up","Raise","slow_down_layer_time so the slowdown starts earlier and more gently"]],
      next:"Inspect the slicer's per-layer fan preview at the crack height." },
    { t:"Interlayer weld marginal from the start", w:.5, why:"A weld that only just holds at the bottom fails first where stress is highest.",
      fixes:[["up","+15 °C","nozzle_temperature"],["up","+0.04 mm","line width"]],
      next:"Snap test on a short specimen before committing to a tall print." }
  ]},
  { id:"firstlayer", label:"First layer not sticking", hint:"Lines lift or drag behind the nozzle", causes:[
    { t:"Wrong plate temperature key active", w:.7, why:"Bambu profiles carry separate temperatures for cool, engineering, textured and Supertack plates. Editing one leaves the others untouched, and the slicer uses whichever plate is selected.",
      fixes:[["set","Align","All four plate keys, or at minimum the one for the plate installed"]],
      next:"Check the plate selected in the slicer against the plate on the machine." },
    { t:"Plate contamination", w:.65, why:"Release agents and skin oils survive an isopropyl wipe.",
      fixes:[["act","Wash","Hot water and detergent, air dry, handle by the edges afterwards"]],
      next:"Wash and repeat the identical file with no other change." },
    { t:"First layer moving too fast for the melt to wet the plate", w:.5, why:"Adhesion is a wetting process and wetting takes contact time.",
      fixes:[["down","−30%","first layer speed"],["up","+5 °C","nozzle_temperature_initial_layer"]],
      next:"First-layer patch test at two speeds." },
    { t:"Z offset drift", w:.45, sudden:true, why:"A knocked plate or a changed nozzle shifts the datum even on a machine that self-levels.",
      fixes:[["act","Recalibrate","Run bed levelling and the Z offset routine after any nozzle change"]],
      next:"Run levelling, then a patch test before assuming a material problem." }
  ]},
  { id:"ringing", label:"Ringing and ghosting", hint:"Echo of a corner repeated along the wall", causes:[
    { t:"Acceleration or jerk above what input shaping was calibrated for", w:.7, why:"Input shaping cancels one resonance at one set of dynamics; raising acceleration moves the excitation outside what the filter was fitted to.",
      fixes:[["act","Recalibrate","Re-run vibration compensation, then keep acceleration where it was measured"],["down","−20%","outer wall acceleration only, leaving infill alone"]],
      next:"Ringing tower at three accelerations." },
    { t:"Pressure advance overshoot at corners", w:.45, why:"An over-set k factor injects a velocity transient of its own that looks like mechanical ringing.",
      fixes:[["down","−0.004","k factor"]],
      next:"PA test — mechanical ringing repeats at a fixed spatial period, PA artefacts do not." },
    { t:"Spool binding on the holder", w:.4, why:"A jerky feed excites the toolhead through the extruder. Rare, but it is the mechanical cause that survives good maintenance.",
      fixes:[["act","Check","Spool spins freely; no tangle under the top wrap"]],
      next:"Print with the filament hand-fed from a loose coil as a control." }
  ]},
  { id:"overhang", label:"Poor overhangs, drooping", hint:"Underside of overhangs curls or sags", causes:[
    { t:"Overhang cooling not aggressive enough", w:.8, why:"An unsupported bead has to freeze before the next one lands on it. Bambu exposes a separate overhang fan speed and threshold for exactly this.",
      fixes:[["up","Raise","overhang_fan_speed toward 100%"],["set","Widen","overhang_fan_threshold so more of the wall counts as overhang"]],
      next:"Overhang test wedge at two fan settings." },
    { t:"Overhang speed too high", w:.7, why:"The bead needs dwell time in front of the fan. Bambu's per-quarter overhang speed keys exist to slow only the unsupported portion.",
      fixes:[["down","Lower","filament_overhang_3_4_speed and filament_overhang_4_4_speed"],["set","On","filament_enable_overhang_speed"]],
      next:"Compare the same wedge with overhang speed control on and off." },
    { t:"Nozzle temperature high for the cooling available", w:.5, why:"A hotter bead takes longer to freeze; on an enclosed machine with limited fan this becomes the binding constraint.",
      fixes:[["down","−10 °C","nozzle_temperature for the overhang region"]],
      next:"Temperature tower judged on the overhang face only." }
  ]},
  { id:"bridging", label:"Bridging sags or fails", hint:"Spans between supports drop", causes:[
    { t:"Bridge speed and flow mismatched", w:.75, why:"A bridge is a stretched, unsupported filament — it wants slightly less material and constant velocity.",
      fixes:[["set","Tune","filament_bridge_speed toward 25–40 mm/s"],["down","−5%","bridge flow"]],
      next:"Bridge test at three speeds over the longest span in the real part." },
    { t:"Insufficient cooling on the bridge layer", w:.7, why:"The span has to freeze in flight; without full fan it never does.",
      fixes:[["up","→ 100%","fan on bridge layers"]],
      next:"Same bridge test with fan forced to full." },
    { t:"Material simply too soft for the span", w:.4, why:"High-Tg engineering materials printed in a hot chamber stay compliant longer and bridge worse than PLA ever will.",
      fixes:[["act","Support","Accept supports for spans past 20 mm on chamber-heated materials"]],
      next:"Bridge the same span in PLA as a control to separate material from settings." }
  ]},
  { id:"pinholes", label:"Top surface pinholes", hint:"Top layer does not close", causes:[
    { t:"Flow ratio slightly low", w:.7, why:"Top surfaces are the least forgiving place for a flow deficit because there is no wall to hide it.",
      fixes:[["up","+0.015","filament_flow_ratio"]],
      next:"Flow calibration cube judged on the top face." },
    { t:"Not enough top solid layers for the layer height", w:.5, why:"Solid thickness, not layer count, is what closes a surface.",
      fixes:[["up","+1","top solid layers, or raise until top thickness reaches about 0.8 mm"]],
      next:"Slice preview of the top layers over sparse infill." },
    { t:"Ironing masking a flow problem", w:.3, why:"Ironing can hide pinholes at low speed while leaving the underlying deficit in place.",
      fixes:[["act","Disable","Turn ironing off while diagnosing, then re-enable"]],
      next:"Judge the surface with ironing disabled." }
  ]},
  { id:"wet", label:"Popping, steam, bubbly surface", hint:"Audible ticking, rough matte finish", causes:[
    { t:"Absorbed moisture", w:.98, hygro:true, why:"Water boils in the melt zone and leaves voids and a matte, fuzzy surface. In polyamides and polyesters it also cuts chains and drops strength permanently.",
      fixes:[["act","Dry","Run the material's full drying cycle before anything else"],["act","Feed","Print from a heated chamber or desiccated dry box for hygroscopic grades"]],
      next:"Extrude 100 mm in still air and watch for steam and bubbles. This is a two-minute confirmation." },
    { t:"Contamination or a mixed-material clog", w:.25, why:"Residue from a higher-temperature material degrading in the melt zone gives a similar crackle.",
      fixes:[["act","Purge","Purge 200 mm at the higher material's temperature, then cold pull"]],
      next:"Inspect the purge for discoloured flecks." }
  ]},
  { id:"brittle", label:"Filament snaps in the tube or on the spool", hint:"Breaks during feeding or AMS retract", causes:[
    { t:"Hydrolytic degradation from long humid storage", w:.75, hygro:true, why:"Polyesters and polyamides lose molecular weight when stored wet. Drying restores printability but does not undo the chain scission.",
      fixes:[["act","Dry","Dry, then test — if it still snaps the spool is spent"],["act","Retire","Retire the spool for structural work"]],
      next:"Bend a 100 mm length around a 50 mm radius. Clean snap means retire it." },
    { t:"Tight winding stress on a small-core spool", w:.35, why:"Filament that has been held at a small bend radius for a long time embrittles at the outer wrap.",
      fixes:[["act","Discard","Discard the outer few metres"]],
      next:"Compare the outer wrap against material from mid-spool." }
  ]},
  { id:"grinding", label:"Extruder clicking or grinding", hint:"Ticking sound, flat spot on the filament", causes:[
    { t:"Commanded flow above what the melt zone can supply", w:.85, why:"The extruder is pushing against a pressure it cannot overcome, so the gear slips. The Recommend tab computes both the flow ceiling and the force required.",
      fixes:[["down","Set","filament_max_volumetric_speed to the computed ceiling"],["up","+10 °C","nozzle_temperature to drop melt viscosity"]],
      next:"Repeat the same print at 70% flow. If clicking stops, it was flow, not hardware." },
    { t:"Partial clog raising back-pressure", w:.7, why:"A restriction multiplies the force needed for the same flow.",
      fixes:[["act","Cold pull","Cold pull, then a hot purge"],["act","Replace","Replace the nozzle if the pull shows carbon"]],
      next:"Free-air extrusion at 5 mm³/s — if that clicks too, it is the nozzle, not the print." },
    { t:"Too much retraction on a soft material", w:.45, why:"Retracting a flexible filament buckles it in the drive rather than pulling melt back.",
      fixes:[["down","−50%","filament_retraction_length for TPU grades"],["down","−50%","filament_retraction_speed"]],
      next:"Retraction tower on the flexible material specifically." },
    { t:"Heat creep softening filament above the melt zone", w:.4, why:"Softened filament swells in the cold side and jams. It shows up on long prints in a hot chamber.",
      fixes:[["down","Lower","chamber temperature if the material tolerates it"],["act","Check","Hotend fan running at full for the whole print"]],
      next:"Note whether failures cluster after a consistent elapsed time — that signature is heat creep, not settings." }
  ]},
  { id:"partial", label:"Flow fades then recovers mid-print", hint:"Bands of thin extrusion", causes:[
    { t:"Intermittent partial clog", w:.8, why:"A fragment cycles between blocking and clearing as pressure builds and releases.",
      fixes:[["act","Cold pull","Several cold pulls until the pulled tip is clean and sharp"],["act","Replace","Replace the nozzle — intermittent clogs rarely clear for good"]],
      next:"Watch extrusion width in the first 20 layers after a nozzle swap." },
    { t:"Heat creep on long prints", w:.55, why:"Warm-side temperature climbs through the print until the filament softens above the melt zone.",
      fixes:[["act","Check","Hotend cooling fan speed and airflow path"],["down","Lower","chamber temperature where the material allows"]],
      next:"Log the elapsed time at each fade. A repeatable interval points at thermal, not material." },
    { t:"Filament diameter variation within the spool", w:.4, why:"An out-of-tolerance section under-delivers volume until it passes through.",
      fixes:[["act","Measure","Diameter every 200 mm across several metres"],["set","Set","filament_diameter to the measured mean"]],
      next:"Correlate the band spacing with spool circumference — a match points at the spool, not the machine." }
  ]},
  { id:"clog", label:"Complete blockage, no extrusion", hint:"Extruder skipping, nothing comes out", causes:[
    { t:"Carbonised deposit in the melt zone", w:.8, why:"Long dwell at temperature, especially after a high-temperature material, bakes residue onto the bore.",
      fixes:[["act","Cold pull","Heat to print temperature, cool to the softening point, pull firmly"],["act","Replace","Replace the nozzle if two pulls do not clear it"]],
      next:"Inspect the pulled tip under magnification — a clean cone means the melt zone is clear." },
    { t:"Material change without an adequate purge", w:.6, why:"A high-temperature residue will not move at the new material's temperature and blocks the path.",
      fixes:[["act","Purge","Purge at the higher of the two materials' temperatures before switching down"]],
      next:"Standardise a purge volume when stepping down in temperature." },
    { t:"Foreign particle from the spool", w:.35, why:"Dust and swarf collected on the filament path end up in the nozzle.",
      fixes:[["act","Filter","Fit a filament dust wiper"],["act","Replace","Replace the nozzle"]],
      next:"Check whether the same spool blocks a second nozzle." }
  ]},
  { id:"wander", label:"Extrusion width wanders, dimensions drift", hint:"Same file prints differently week to week", causes:[
    { t:"Nozzle bore wear", w:.9, abrasive:true, drift:true, why:"Filled materials abrade the orifice steadily. The bore grows and goes out of round, so the actual line width no longer matches the commanded one.",
      fixes:[["act","Replace","Fit a fresh nozzle; use hardened steel or carbide for any filled grade"],["act","Log","Record kilograms through each nozzle so replacement is scheduled, not reactive"]],
      next:"Single-wall cube measured with a micrometer, logged per nozzle. A drift past 0.03 mm is the replacement trigger." },
    { t:"Batch-to-batch filament diameter variation", w:.55, why:"Nominal 1.75 mm covers a real spread, and pigment loading changes it further.",
      fixes:[["act","Measure","Ten readings per new spool"],["set","Set","filament_diameter and filament_flow_ratio per batch, stored against the batch"]],
      next:"Log measured diameter against batch in the library and compare across lots." },
    { t:"Ambient temperature swing", w:.3, why:"Shrinkage compensation is calibrated at one ambient; a workshop that swings 10 °C moves finished dimensions.",
      fixes:[["set","Tune","filament_shrink against parts measured at a stable ambient"]],
      next:"Measure the same calibration part at both ends of the daily temperature range." }
  ]},
  { id:"dims", label:"Holes undersize, dimensions off", hint:"Parts do not fit assemblies", causes:[
    { t:"Hole compensation coefficients not tuned for this material", w:.75, why:"Bambu carries per-filament polynomial compensation for holes and outer contours; it is a material property, not a machine one.",
      fixes:[["set","Tune","hole_coef_2 and hole_coef_3 against measured holes"],["set","Tune","counter_coef_2 and counter_coef_3 for outer contours"]],
      next:"Print a gauge plate with holes from 3 to 20 mm, measure with pin gauges, fit the correction." },
    { t:"Shrinkage not set for the material", w:.6, why:"Semi-crystalline materials shrink far more than PLA, and the amount depends on chamber temperature.",
      fixes:[["set","Set","filament_shrink from measured parts at the chamber temperature you actually run"]],
      next:"Print a 100 mm bar, measure cold, set the ratio from the result." },
    { t:"Over- or under-extrusion shifting every surface", w:.5, why:"Flow error moves outer walls out and holes in, symmetrically.",
      fixes:[["set","Calibrate","filament_flow_ratio before touching any compensation coefficient"]],
      next:"Flow first, dimensions second. Compensations fitted on top of a flow error will not transfer." },
    { t:"Elephant foot on the seating face", w:.35, why:"A squashed first layer reads as an oversize base in every measurement taken from it.",
      fixes:[["set","Apply","Elephant foot compensation"],["act","Adjust","Z offset for the plate in use"]],
      next:"Measure at mid-height and at the base separately to separate the two effects." }
  ]},
  { id:"zbanding", label:"Z banding, periodic horizontal lines", hint:"Regular bands at a fixed pitch", causes:[
    { t:"Flow pulsation from filament diameter variation", w:.6, why:"A diameter cycle from the extrusion line prints as a band whose pitch matches the spool geometry.",
      fixes:[["act","Measure","Diameter along several metres; look for a repeating cycle"]],
      next:"Compare band pitch against the layers printed per spool revolution." },
    { t:"Temperature oscillation around the setpoint", w:.5, drift:true, why:"A worn or loose thermistor or heater lets the PID hunt, and viscosity follows it.",
      fixes:[["act","Check","Log nozzle temperature during a print and look for swing beyond ±2 °C"],["act","Retune","Re-run hotend PID tuning"]],
      next:"Temperature log across ten minutes of steady printing." },
    { t:"Lead screw or Z artefact", w:.3, mech:true, why:"On a maintained machine this is unlikely, but a band pitch exactly matching the Z screw lead is diagnostic.",
      fixes:[["act","Measure","Band pitch against the Z lead"]],
      next:"If the pitch matches the screw lead exactly, it is mechanical; otherwise it is not." }
  ]},
  { id:"shift", label:"Layer shift", hint:"Print offsets partway up", causes:[
    { t:"Collision with a curled part or lifted corner", w:.8, why:"On a maintained machine the overwhelmingly common shift is the toolhead hitting something the print itself created.",
      fixes:[["up","Raise","Z hop, and set filament_z_hop_types to a spiral or slope lift"],["act","Fix","Address the warping first — see corner lift"]],
      next:"Inspect the part at the shift height for a raised edge on the side the shift moved toward." },
    { t:"Acceleration above what the part mass supports", w:.4, why:"A tall part with a small footprint can be knocked by its own inertia.",
      fixes:[["down","−25%","acceleration for tall parts"]],
      next:"Reprint at reduced acceleration as the control." },
    { t:"Belt or carriage fault", w:.2, mech:true, why:"Listed last deliberately — on a serviced machine this is rare, and the two causes above account for most shifts.",
      fixes:[["act","Check","Belt tension and carriage play at the next scheduled service"]],
      next:"Only pursue after collision and acceleration have been excluded." }
  ]},
  { id:"colour", label:"Colour or gloss differs between batches", hint:"Same SKU, visibly different parts", causes:[
    { t:"Pigment loading varies between lots", w:.8, why:"Pigment changes both the melt rheology and the surface reflectivity. It is a real property of the batch, not an error.",
      fixes:[["act","Record","Store the batch code against every spool and keep matched batches for one job"],["set","Recalibrate","filament_flow_ratio per batch — heavily pigmented lots often need a different value"]],
      next:"Print a swatch from each batch under the same settings and keep them with the spools." },
    { t:"Different effective print temperature", w:.5, why:"Gloss on many materials tracks melt temperature closely; 10 °C is visible.",
      fixes:[["set","Match","nozzle_temperature across the batches being mixed"]],
      next:"Swatches at 240, 250 and 260 to see the gloss response for the material." },
    { t:"Cooling difference changing surface texture", w:.35, why:"Faster cooling freezes a rougher surface and reads as a colour change.",
      fixes:[["set","Match","fan_min_speed and fan_max_speed between the jobs"]],
      next:"Swatches at matched fan settings." }
  ]},
  { id:"purge", label:"Colour bleed after a filament change", hint:"Streaks of the previous colour", causes:[
    { t:"Purge volume too low for the colour transition", w:.85, why:"Purge requirement scales with the melt-zone volume and with how far the transition goes — dark into light is the worst case.",
      fixes:[["up","Raise","filament_prime_volume and filament_minimal_purge_on_wipe_tower for dark-to-light steps"],["set","Order","Sequence colours light to dark where the model allows"]],
      next:"Print a transition swatch and count the layers until the new colour is clean." },
    { t:"Purge temperature too low to shift residue", w:.45, why:"A cold purge leaves film on the melt-zone wall that bleeds for many more layers.",
      fixes:[["set","Set","filament_flush_temp toward the higher of the two materials"]],
      next:"Same swatch with the flush temperature raised 15 °C." },
    { t:"Melt-zone volume larger than the profile assumes", w:.35, why:"A high-flow hotend holds materially more melt than the stock one the purge default was written for.",
      fixes:[["up","Scale","Purge volumes by the ratio of melt-zone volumes shown in the Hotends tab"]],
      next:"Compare the computed melt-zone volume against the profile's purge volume." }
  ]},
  { id:"support", label:"Supports fuse to the part", hint:"Supports will not separate cleanly", causes:[
    { t:"Support interface gap too small for this material", w:.7, why:"Materials that stay soft longer bond across a gap that works fine for PLA.",
      fixes:[["up","+0.05 mm","top Z distance for support interface"],["up","Raise","interface line spacing"]],
      next:"Support test block at two gaps in the material actually being used." },
    { t:"Insufficient cooling at the interface", w:.5, why:"A hot interface layer welds instead of resting.",
      fixes:[["up","Raise","fan on interface layers"]],
      next:"Compare the same block with interface cooling raised." },
    { t:"Same material used for support where a release material is available", w:.45, multi:true, why:"On a multi-material machine an interface in a non-bonding material removes the problem rather than tuning around it.",
      fixes:[["act","Switch","Use a dedicated support or soluble interface material"]],
      next:"One interface layer in the release material is usually enough." }
  ]},
  { id:"knock", label:"Part knocked loose, spaghetti", hint:"Print detaches mid-job", causes:[
    { t:"Adhesion lost to warping before the knock", w:.75, why:"Almost every knock-off starts as a lifted corner. Fix the lift and the knock disappears.",
      fixes:[["act","Diagnose","Work the corner-lift path first"],["act","Brim","Brim of 5 mm or more as an interim measure"]],
      next:"Inspect the base of the detached part for a curled edge." },
    { t:"Small footprint relative to height", w:.5, why:"The overturning moment grows with height while the anchor stays the same size.",
      fixes:[["act","Brim","Add a brim"],["down","−25%","acceleration"]],
      next:"Reprint with a brim and reduced acceleration as a pair." },
    { t:"Plate contamination in a local patch", w:.35, why:"A fingerprint under one corner is enough.",
      fixes:[["act","Wash","Full plate wash with detergent"]],
      next:"Note whether failures recur at the same plate position." }
  ]},
  { id:"scrape", label:"Nozzle knocks or scrapes on infill", hint:"Ticking as the head crosses printed area", causes:[
    { t:"Over-extrusion raising the deposited height", w:.8, why:"Each layer lands slightly proud, and the error accumulates until the nozzle touches it.",
      fixes:[["down","−0.02","filament_flow_ratio"],["set","Enable","Z hop over printed regions as an interim measure"]],
      next:"Flow calibration cube. If the top face is proud, this is the cause." },
    { t:"Infill peaks from an aggressive pattern", w:.45, why:"Some patterns cross themselves and stack material at the crossings.",
      fixes:[["act","Change","Switch to a non-crossing infill pattern"],["set","On","Ironing or infill combination off while diagnosing"]],
      next:"Same part with a different infill pattern." },
    { t:"Curling on the previous layer", w:.4, why:"A curled edge is above nominal height even at correct flow.",
      fixes:[["up","Raise","overhang_fan_speed"],["down","Lower","overhang speed"]],
      next:"Look at where the knocking happens — over overhangs points at curl, over solid infill points at flow." }
  ]}
];

/* --------------------------- quality scale ------------------------------ */
/* Seven steps, each with a definable outcome. Edit the wording in Reference. */
const SCALE_DEFAULT = [
  "Unusable — will not complete a print reliably",
  "Poor — completes, but constant intervention",
  "Marginal — visible defects on every part",
  "Serviceable — fine for jigs, fixtures and drafts",
  "Good — dimensionally sound, clean surface",
  "Excellent — consistent across the whole spool",
  "Reference — benchmark batch, use it to calibrate"
];
let SCALE = SCALE_DEFAULT.slice();

/* ------------------------------- hints ---------------------------------- */
const HINTS = {
  import:{ title:"Moving profiles between Bambu Studio and here", html:`
    <p><b>Getting a profile out of the slicer.</b> In Bambu Studio choose <code>File → Export → Export Preset Bundle…</code>, pick <b>Filament presets (.zip)</b>, tick the presets you want and save. Unzip the result — each preset inside is a single <code>.json</code> file. Drop that file into the picker here, or paste its contents.</p>
    <p><b>Sending one back.</b> Open a spool, go to its <b>Export</b> tab, download the JSON, then in Bambu Studio use <code>File → Import → Import Configs…</code>. That importer accepts <code>.json</code>, <code>.bbscfg</code>, <code>.bbsflmt</code> and <code>.zip</code>.</p>
    <p><b>Two things that catch people out.</b></p>
    <ul>
      <li>The <code>compatible_printers</code> string has to match your installed printer preset name exactly, nozzle size included, or the profile imports but never appears in the filament list.</li>
      <li>If the filament does not exist in Bambu Studio yet, create it first with the filament <b>settings icon → Custom Filaments → Create New</b>, then import over the top. A preset with no base to inherit from will not attach to an AMS slot.</li>
    </ul>
    <p>Nothing is discarded on the way in: keys this page knows land in the core fields, and everything else is preserved on the Advanced tab so the round trip is lossless.</p>` },
  recommend:{ title:"What the recommendation is doing", html:`
    <p>The flow ceiling comes from one physical parameter per hotend — the effective melt-zone volume — scaled by nozzle diameter and class, then clipped by the hotend's rated maximum. The rest of the profile follows from that operating point: temperature rises with commanded flow, cooling falls with it, pressure advance scales inversely with nozzle diameter.</p>
    <p>The <b>goal</b> selector only moves how much of the ceiling gets used and shifts temperature and cooling around it. Throughput takes 95% of the ceiling; surface finish takes 60% and drops 4&nbsp;°C.</p>
    <p>Pick a spool rather than a bare material wherever you can. A spool with a measured flow figure carries its own factor, and every number on this page is recomputed against it.</p>
    <p>Read the physics panel before trusting the speed. Heater power, melt residence and extruder force are independent checks — the ceiling can be reachable while one of those says the machine will not hold it.</p>` },
  diagnose:{ title:"How the ranking is weighted", html:`
    <p>Causes are not a fixed list. Each one carries a base likelihood that is then adjusted by what you selected: hygroscopic materials push moisture causes up, filled grades and a high nozzle odometer push bore wear up, a printer with no active chamber pushes chamber-related causes up, and mechanical causes are held down because this fleet is maintained.</p>
    <p><b>Onset matters more than people expect.</b> "Degraded over time" promotes wear and drift; "failed suddenly" promotes a clog or a knocked datum; "never worked" demotes both in favour of parameters.</p>
    <p>Select more than one symptom. Causes that explain several at once accumulate weight, which is what separates a moisture problem from a flow problem when both produce a rough surface.</p>` },
  hotends:{ title:"Why melt volume and not nozzle size", html:`
    <p>Standard nozzles gain almost nothing in flow as they get bigger — E3D's own figures go 13 → 14 → 17&nbsp;mm³/s from 0.4 to 0.8&nbsp;mm in PLA. High-flow nozzles nearly double over the same range. The difference is not the hole, it is how much melt the assembly holds. So each combination here carries an effective melt volume, and everything else is derived from it.</p>
    <p><b>Log kilograms through each nozzle.</b> Bore wear is the quiet failure on a filled-material fleet: the machine reports nothing, dimensions drift, and it gets blamed on the slicer. The wear estimate here is coarse — brass gives out around 0.4&nbsp;kg of carbon-filled material, hardened steel around 6&nbsp;kg, carbide far longer — but a logged number beats a guess.</p>
    <p>A high-flow tip in a standard body is still capped by the body's rating. Fitting one to an X1C buys less than fitting it to an H2 high-flow hotend, and the model shows exactly where the clip happens.</p>` },
  compare:{ title:"Using the comparison", html:`
    <p>Save a configuration from the Recommend tab — spool, printer, hotend, goal and geometry — then select two or more here. Every computed value is recalculated per column, so this is a live comparison, not a snapshot of what you saved.</p>
    <p>The first column you select is the reference and every cell that differs from it is marked. That is the fast way to answer "what actually changed between the run that worked and the one that did not".</p>
    <p>It also answers hardware questions directly: save the same spool and part against two hotends, and the flow, speed and pressure-advance rows show what the upgrade is worth before you buy the tip.</p>` },
  rating:{ title:"The quality scale", html:`
    <p>Seven steps, because five collapses the middle and ten invites false precision. Each step's wording is yours to define — rewrite them below so they describe outcomes your shop actually distinguishes, and the same words will show on every spool.</p>
    <p>Rate the <b>batch</b>, not the brand. That is the whole reason batch is a field: two lots of the same SKU can sit two steps apart, and the rating is what tells you which one to reach for when a part matters.</p>` },
  parts:{ title:"How the library files things", html:`
    <p><b>The app owns the layout.</b> An uploaded model is written to <code>&lt;Category&gt;/&lt;Part&gt;/v&lt;n&gt;/&lt;file&gt;</code> under your library root, alongside a <code>part.json</code> that lists its versions and print history in plain text. Rename a part or change its category and the folder moves to match, so the tree always reflects what you see here. The Storage tab shows the root and what is in it.</p>
    <p><b>A 3MF is a ZIP archive.</b> A Bambu Studio project carries a plate render, <code>slice_info.config</code> with filament grams, metres, print time, printer model and nozzle, and <code>project_settings.config</code> with every slicer key. The server reads all of it on upload. A plain 3MF or an STL has none of that, so the preview is rendered from the mesh and you get a bounding box, solid volume and triangle count.</p>
    <p><b>Every file is fingerprinted.</b> <b>Verify a file</b> hashes any file and tells you whether it is byte-for-byte a version on record — useful when a copy has been passed around and you need to know which revision someone actually printed.</p>
    <p><b>Importing what you already have.</b> Storage → Import an existing folder walks a tree and files every model under it. Duplicates are recognised by fingerprint and skipped, so it is safe to run twice.</p>` },
  pin:{ title:"", html:"" }
};

/* ------------------------------- physics -------------------------------- */
function extrusionArea(w,h){ return h*(w-h) + Math.PI*h*h/4; }

function expFor(matKey, cls){
  const m = MATERIALS[matKey] || MATERIALS.PLA;
  return cls==="highflow" ? m.eH : m.eS;
}
function vEffFor(bodyId, d, cls, matKey){
  const b = BODIES[bodyId]; if(!b) return 0;
  const base = b.vEff[cls] !== undefined ? b.vEff[cls] : b.vEff.standard;
  return base * Math.pow(d/0.4, expFor(matKey||"PLA", cls));
}

function flowCeiling(bodyId, d, cls, matKey, flowFactor){
  const b = BODIES[bodyId], m = MATERIALS[matKey];
  const v = vEffFor(bodyId,d,cls,matKey);
  const hf = cls==="highflow" ? (m.hfResp||1) : 1;
  const melt = m.A * hf * v * (flowFactor||1);
  const cap = b.cap;
  return { melt, cap, hf, q:Math.min(melt,cap), bound: melt<=cap ? "melt" : "rating", vEff:v };
}

function heaterPower(q, matKey, T){
  const m = MATERIALS[matKey];
  const jPerMm3 = (m.rho/1000)*(m.cp*(T-AMBIENT) + m.hf);   // g/mm³ × J/g
  return { w:q*jPerMm3, jPerMm3 };
}

function nozzlePressure(q, d, matKey){
  const m = MATERIALS[matKey];
  const R = (d/2)/1000, L = LAND/1000;             // m
  const Q = q/1e9;                                  // m³/s
  const shear = Q*(3*m.n+1)/(Math.PI*m.n*Math.pow(R,3));
  const tau = m.K*Math.pow(shear,m.n);
  const dP = 2*tau*L/R;
  const force = dP*(FIL_AREA/1e6);                  // Pa × m² = N
  return { shear, tau, dP, force };
}

function paFor(matKey, bodyId, d, paFactorSpool){
  const base = PA_BASE[matKey] || .02;
  const k = base * (0.4/d) * BODIES[bodyId].paFactor * (paFactorSpool||1);
  return Math.round(k*1000)/1000;
}

/* Solve the spool's flow factor from one measurement, so every other
   hotend/nozzle combination inherits it. */
function flowFactorFromMeasurement(mm, matKey){
  if(!mm || !mm.value || !BODIES[mm.body]) return null;
  const nominal = MATERIALS[matKey].A * (mm.cls==="highflow" ? (MATERIALS[matKey].hfResp||1) : 1)
                * vEffFor(mm.body, +mm.nozzle, mm.cls, matKey);
  if(!nominal) return null;
  return mm.value/nominal;
}
function paFactorFromMeasurement(mp, matKey){
  if(!mp || !mp.value || !BODIES[mp.body]) return null;
  const nominal = paFor(matKey, mp.body, +mp.nozzle, 1);
  if(!nominal) return null;
  return mp.value/nominal;
}

function recommend(inp){
  const m = MATERIALS[inp.mat], g = GOALS[inp.goal], body = BODIES[inp.body], pr = PRINTERS[inp.printer];
  const ceil = flowCeiling(inp.body, inp.d, inp.cls, inp.mat, inp.flowFactor);
  const area = extrusionArea(inp.lw, inp.lh);
  const qUse = ceil.q * g.flowUse;
  const vMax = qUse/area;

  // temperature: base plus a flow-driven rise, damped, then goal, clamped
  const qRef = ceil.q*0.55;
  const dTflow = qUse>0 && qRef>0 ? 12*Math.log2(qUse/qRef) : 0;
  let T = m.t + dTflow + g.dT;
  T = Math.max(m.tlo, Math.min(m.thi, Math.min(body.maxT, pr.maxNozzleT), Math.round(T)));
  const T1 = Math.max(m.tlo, Math.min(m.thi, Math.round(m.t1 + g.dT*0.5)));

  const power = heaterPower(qUse, inp.mat, T);
  const press = nozzlePressure(qUse, inp.d, inp.mat);
  const residence = qUse>0 ? ceil.vEff/qUse : Infinity;
  const layerTime = vMax>0 ? inp.path/vMax : 0;
  const k = paFor(inp.mat, inp.body, inp.d, inp.paFactor);

  let fanMin = Math.max(0, Math.min(100, Math.round(m.fanMin + g.fanD)));
  let fanMax = Math.max(fanMin, Math.min(100, Math.round(m.fanMax + g.fanD)));
  const chamber = pr.chamber==="active" ? Math.min(pr.maxChamber, m.cham) : 0;
  const bed = Math.min(pr.maxBedT, m.bed);
  const retract = Math.round(body.retract*m.retract*100)/100;
  const flowRatio = Math.round((m.flow + g.flowRatioD)*1000)/1000;

  /* --- checks --- */
  const flags = [];
  const powerBudget = body.heaterW*0.8;
  if(power.w > powerBudget) flags.push({lvl:"crit",t:"Heater cannot sustain this flow",
    d:`${qUse.toFixed(1)} mm³/s needs ${power.w.toFixed(1)} W of melting power against a usable budget of about ${powerBudget.toFixed(0)} W. Nozzle temperature will sag under load. Reduce max volumetric speed or fit a higher-power heater.`});
  else if(power.w > powerBudget*0.7) flags.push({lvl:"warn",t:"Heater running near its limit",
    d:`${power.w.toFixed(1)} W of ${powerBudget.toFixed(0)} W usable. Expect a few degrees of droop on long solid infill runs.`});

  if(residence < 1.2) flags.push({lvl:"crit",t:"Melt residence time too short",
    d:`Filament spends only ${residence.toFixed(2)} s in the melt zone. Below roughly 1.2 s the core does not fully melt and you get an under-extrusion that looks like a clog. Slow down or raise temperature.`});
  else if(residence < 2) flags.push({lvl:"warn",t:"Short melt residence",
    d:`${residence.toFixed(2)} s in the melt zone. Workable, but raise nozzle temperature toward the top of the range to compensate.`});

  if(press.force > 45) flags.push({lvl:"crit",t:"Extruder force above the grinding threshold",
    d:`The nozzle land alone needs ${press.force.toFixed(1)} N, and the melt zone upstream adds two to four times that. The drive gear will flatten the filament before it reaches this flow.`});
  else if(press.force > 22) flags.push({lvl:"warn",t:"High extruder force",
    d:`${press.force.toFixed(1)} N at the land. Raise nozzle temperature to cut melt viscosity before you raise flow further.`});

  if(layerTime < m.slow) flags.push({lvl:"warn",t:"Layers finish faster than the cooling window",
    d:`A ${inp.path} mm layer takes ${layerTime.toFixed(1)} s at ${vMax.toFixed(0)} mm/s, under the ${m.slow} s cooling threshold. The slicer will throttle to ${m.slowV} mm/s, so the computed speed will not be reached on small cross-sections.`});

  if(m.cham > 0 && pr.chamber !== "active") flags.push({lvl:"warn",t:"No active chamber on this printer",
    d:`${m.label} wants roughly ${m.cham} °C of chamber. The ${pr.short} only reaches ambient plus enclosure rise. Expect warping on footprints past about 80 mm, and print with the door and top closed.`});
  if(m.cham > pr.maxChamber && pr.chamber==="active") flags.push({lvl:"warn",t:"Chamber setpoint above the machine's ceiling",
    d:`${m.label} wants about ${m.cham} °C; the ${pr.short} tops out at ${pr.maxChamber} °C. Warping risk stays elevated on large parts.`});

  if(m.t > pr.maxNozzleT) flags.push({lvl:"crit",t:"Material exceeds the printer's hotend range",
    d:`${m.label} prints at about ${m.t} °C and the ${pr.short} tops out at ${pr.maxNozzleT} °C. This combination is not viable.`});
  if(m.t > body.maxT) flags.push({lvl:"crit",t:"Material exceeds this hotend's rating",
    d:`${body.name} is rated to ${body.maxT} °C; ${m.label} needs about ${m.t} °C.`});
  if(m.bed > pr.maxBedT) flags.push({lvl:"warn",t:"Bed temperature above the machine's ceiling",
    d:`${m.label} wants ${m.bed} °C; the ${pr.short} bed tops out at ${pr.maxBedT} °C.`});

  if(m.abr && !NOZZLE_MATS[inp.nozMat].abrasiveOK) flags.push({lvl:"crit",t:"Abrasive material in a soft nozzle",
    d:`${m.label} requires HRC ${m.hrc} or better. A ${NOZZLE_MATS[inp.nozMat].label.toLowerCase()} nozzle will measurably lose bore geometry within roughly ${NOZZLE_MATS[inp.nozMat].wearKg} kg.`});

  if(m.dryT > 0) flags.push({lvl:"ok",t:"Drying",
    d:`${m.dryT} °C for ${m.dryH} h. ${m.hf>0||["PA","PA-CF","PPA-CF","PET-CF","PETG","PETG-CF","PC","PC-CF","PVA","TPU-95A","TPU-85A","PPS-CF"].includes(inp.mat) ? "This grade is hygroscopic — print from a dry box or a heated chamber for long jobs." : "Store with desiccant between jobs."}`});

  return { m,g,body,pr,ceil,area,qUse,vMax,T,T1,power,press,residence,layerTime,k,fanMin,fanMax,
           chamber,bed,retract,flowRatio,flags,powerBudget };
}


/* ----------------------------- validation ------------------------------- */
/* Hardware ceilings across the registered fleet. A value beyond these is not
   a preference, it is impossible on any machine here. */
const LIMIT = { hotend:350, bed:120, chamber:65, coolPlate:60, retract:3 };

function bestCeiling(d){
  if(!hotends.length) return null;
  const ff = spoolFlowFactor(d) || 1;
  return Math.max(...hotends.map(h=>flowCeiling(h.body, +h.nozzle, h.cls, matOf(d), ff).q));
}

function validateField(rule, raw, d){
  if(raw===""||raw==null) return null;
  const m = MATERIALS[matOf(d)];
  const num = parseFloat(raw), isNum = !isNaN(num) && isFinite(num);
  const crit = msg => ({lvl:"crit", msg});
  const warn = msg => ({lvl:"warn", msg});
  const core = d.core || {};
  const g = k => { const v = core[k]; const n = parseFloat(v); return (v===""||v==null||isNaN(n)) ? null : n; };
  const lo = g("nozzle_temperature_range_low"), hi = g("nozzle_temperature_range_high");
  const loT = lo!==null ? lo : m.tlo, hiT = hi!==null ? hi : m.thi;
  const pct = v => { const n = parseFloat(String(v).replace("%","")); return isNaN(n)? null : n; };

  switch(rule){
    case "nozzle_temperature":
    case "nozzle_temperature_initial_layer": {
      if(!isNum) return crit("Needs a number in °C.");
      if(num > LIMIT.hotend) return crit(`${LIMIT.hotend} °C is the ceiling on the H2 series, and 300 °C on the X1C.`);
      if(num < 150) return crit("Below any polymer's melt range — check the units.");
      if(num < loT || num > hiT) return warn(`Outside the ${loT}–${hiT} °C window for ${m.label}.`);
      return null;
    }
    case "nozzle_temperature_range_low": {
      if(!isNum) return crit("Needs a number in °C.");
      if(num >= hiT) return crit(`Low end sits at or above the high end (${hiT} °C) — the window is inverted.`);
      if(num > m.t) return warn(`Above the ${m.label} working temperature of ${m.t} °C — the window excludes its own default.`);
      return null;
    }
    case "nozzle_temperature_range_high": {
      if(!isNum) return crit("Needs a number in °C.");
      if(num <= loT) return crit(`High end sits at or below the low end (${loT} °C) — the window is inverted.`);
      if(num > LIMIT.hotend) return crit(`Above the ${LIMIT.hotend} °C hotend ceiling.`);
      if(num < m.t) return warn(`Below the ${m.label} working temperature of ${m.t} °C.`);
      return null;
    }
    case "hot_plate_temp":
    case "textured_plate_temp": {
      if(!isNum) return crit("Needs a number in °C.");
      if(num > LIMIT.bed) return crit(`The heatbed tops out at ${LIMIT.bed} °C.`);
      if(num > m.tg + 5 && m.tg > 0) return warn(`Above the ${m.tg} °C glass transition — the base will stay soft and deform as the part builds.`);
      if(num < m.bed - 20) return warn(`${m.bed} °C is the usual figure for ${m.label}; this low invites release mid-print.`);
      return null;
    }
    case "cool_plate_temp": {
      if(!isNum) return crit("Needs a number in °C.");
      if(num > LIMIT.coolPlate) return crit(`The cool plate is not rated past ${LIMIT.coolPlate} °C.`);
      return null;
    }
    case "chamber_temperatures": {
      if(!isNum) return crit("Needs a number in °C.");
      if(num > LIMIT.chamber) return crit(`Active chamber heating stops at ${LIMIT.chamber} °C, and the X1C has none at all.`);
      if(m.tg > 0 && num > m.tg - 10) return warn(`Within 10 °C of the ${m.tg} °C glass transition — parts will sag under their own weight.`);
      if(m.cham > 0 && num === 0) return warn(`${m.label} wants roughly ${m.cham} °C of chamber. At zero, expect corner lift on anything over about 80 mm.`);
      return null;
    }
    case "filament_max_volumetric_speed": {
      if(!isNum) return crit("Needs a number in mm³/s.");
      if(num <= 0) return crit("Must be greater than zero.");
      const c = bestCeiling(d);
      if(c && num > c) return crit(`Above the computed ceiling of ${c.toFixed(1)} mm³/s for your best registered hotend. The extruder will skip before it reaches this.`);
      if(c && num > c*0.92) return warn(`Within 8% of the ${c.toFixed(1)} mm³/s ceiling — no margin for a cold spot or a worn nozzle.`);
      if(num < 1) return warn("Under 1 mm³/s is slower than any practical print.");
      return null;
    }
    case "filament_flow_ratio":
    case "mo_flow": {
      if(!isNum) return crit("Needs a decimal multiplier, around 1.0.");
      if(num < 0.7 || num > 1.3) return crit("Outside 0.70–1.30. A real flow error this large is a diameter or extruder problem, not a calibration one.");
      if(num < 0.9 || num > 1.1) return warn("More than 10% off nominal — worth confirming filament diameter before trusting it.");
      return null;
    }
    case "filament_density": {
      if(!isNum) return crit("Needs a number in g/cm³.");
      if(num < 0.5 || num > 2.5) return crit("Outside the range of any printable polymer.");
      if(Math.abs(num - m.rho) > 0.15) return warn(`${m.label} is typically ${m.rho} g/cm³.`);
      return null;
    }
    case "filament_shrink": {
      const v = pct(raw);
      if(v===null) return crit('Expects a percentage, for example "100%".');
      if(v < 90 || v > 110) return crit("Outside 90–110%. Shrink compensation this large points at a measurement error.");
      if(v < 98 || v > 104) return warn("Beyond ±4% — unusual even for a semi-crystalline material in a hot chamber.");
      return null;
    }
    case "fan_min_speed":
    case "fan_max_speed":
    case "overhang_fan_speed": {
      if(!isNum) return crit("Needs a percentage, 0–100.");
      if(num < 0 || num > 100) return crit("Fan speed is 0–100%.");
      const fmin = g("fan_min_speed"), fmax = g("fan_max_speed");
      if(rule==="fan_min_speed" && fmax!==null && num > fmax) return crit("Minimum is above the maximum.");
      if(rule==="fan_max_speed" && fmin!==null && num < fmin) return crit("Maximum is below the minimum.");
      if(m.cham > 0 && num > 40 && rule!=="overhang_fan_speed")
        return warn(`${m.label} is warp-prone; above about 40% the layer weld and corner adhesion both suffer.`);
      return null;
    }
    case "overhang_fan_threshold": {
      const v = pct(raw);
      if(v===null) return crit('Expects a percentage, for example "50%".');
      if(v < 0 || v > 100) return crit("Threshold is 0–100%.");
      return null;
    }
    case "slow_down_layer_time": {
      if(!isNum) return crit("Needs a number in seconds.");
      if(num < 0) return crit("Cannot be negative.");
      if(num < 2) return warn("Under 2 s leaves small cross-sections no time to freeze.");
      if(num > 30) return warn("Over 30 s will throttle most of the print to the minimum speed.");
      return null;
    }
    case "filament_retraction_length": {
      if(!isNum) return crit("Needs a number in mm.");
      if(num < 0) return crit("Cannot be negative.");
      if(num > LIMIT.retract) return crit(`Past ${LIMIT.retract} mm on a direct drive the filament is pulled clear of the melt zone and will jam on the restart.`);
      if(num > 1.5) return warn("Over 1.5 mm is long for a direct drive — a frequent cause of heat-creep clogs.");
      if(num > 0 && num < 0.2) return warn("Under 0.2 mm will not unload the melt pressure.");
      return null;
    }
    case "filament_dev_ams_drying_temperature": {
      if(!isNum) return crit("Needs a number in °C.");
      if(num > m.dryMax) return crit(`${m.dryMax} °C is the safe ceiling for ${m.label}. Above it the spool softens and the wraps weld to each other.`);
      if(num > m.dryT + 10) return warn(`${m.dryT} °C is the usual figure; you are close to the ${m.dryMax} °C softening limit.`);
      if(num < m.dryT - 15) return warn(`Well under the ${m.dryT} °C that actually drives moisture out of ${m.label}.`);
      return null;
    }
    case "filament_dev_ams_drying_time": {
      if(!isNum) return crit("Needs a number in hours.");
      if(num <= 0) return crit("Must be greater than zero.");
      if(num < 2) return warn("Under 2 h will not reach the core of a full spool.");
      if(num > 48) return warn("Past 48 h you risk annealing the spool rather than drying it.");
      return null;
    }
    /* ---- measured values ---- */
    case "mv_value": {
      if(!isNum) return crit("Needs a number in mm³/s.");
      if(num <= 0) return crit("Must be greater than zero.");
      const ff = flowFactorFromMeasurement(Object.assign({}, (d.measured||{}).mvs, {value:num}), matOf(d));
      if(ff===null) return null;
      if(ff < 0.4 || ff > 2.0) return crit(`That is ${(ff*100).toFixed(0)}% of the modelled figure for this combination — far enough out that the test method is the likely explanation, not the filament.`);
      if(ff < 0.7 || ff > 1.4) return warn(`${(ff*100).toFixed(0)}% of nominal. Plausible, but re-run the test before letting it drive every other nozzle.`);
      return null;
    }
    case "mv_temp": {
      if(!isNum) return crit("Needs a number in °C.");
      if(num > LIMIT.hotend) return crit(`Above the ${LIMIT.hotend} °C hotend ceiling.`);
      if(num < m.tlo || num > m.thi) return warn(`Measured outside the ${m.tlo}–${m.thi} °C window, so the figure will not transfer cleanly.`);
      return null;
    }
    case "pa_value": {
      if(!isNum) return crit("Needs a decimal k factor.");
      if(num < 0) return crit("Cannot be negative.");
      const cap = matOf(d).startsWith("TPU") ? 0.4 : 0.12;
      if(num > cap) return crit(`Above ${cap} for ${m.label} — that is usually a units error, k is in seconds.`);
      const pf = paFactorFromMeasurement(Object.assign({}, (d.measured||{}).pa, {value:num}), matOf(d));
      if(pf!==null && (pf < 0.5 || pf > 2)) return warn(`${(pf*100).toFixed(0)}% of the modelled value — check the acceleration the test ran at.`);
      return null;
    }
    case "pa_accel": {
      if(!isNum) return crit("Needs a number in mm/s².");
      if(num < 100 || num > 40000) return crit("Outside any plausible machine acceleration.");
      return null;
    }
    case "mo_diameter": {
      if(!isNum) return crit("Needs a number in mm.");
      if(num < 1.6 || num > 1.9) return crit("Outside 1.60–1.90 mm. This field is the filament, not the nozzle.");
      if(num < 1.72 || num > 1.78) return warn("Beyond the usual ±0.03 mm tolerance — expect flow to wander along the spool.");
      return null;
    }
    default: return null;
  }
}

/* The Recommend inputs carry their own geometric limits: a layer taller than
   about three quarters of the bore will not adhere, a line narrower than the
   bore cannot be laid, and a part taller than Z will not fit. */
function validateRecInputs(inp, pr){
  const out = {};
  const d = inp.d;
  if(!(inp.lh > 0)) out["r-lh"] = {lvl:"crit", msg:"Layer height must be positive."};
  else if(inp.lh > d*0.8) out["r-lh"] = {lvl:"crit", msg:`Over 80% of the ${d} mm bore. The bead has no shoulder to press against and will not bond to the layer below.`};
  else if(inp.lh > d*0.65) out["r-lh"] = {lvl:"warn", msg:`Past the usual 65% of bore for a ${d} mm nozzle — surface quality and overhangs both suffer.`};
  else if(inp.lh < d*0.15) out["r-lh"] = {lvl:"warn", msg:`Very fine for a ${d} mm nozzle; print time rises steeply for little gain.`};

  if(!(inp.lw > 0)) out["r-lw"] = {lvl:"crit", msg:"Line width must be positive."};
  else if(inp.lw < d) out["r-lw"] = {lvl:"crit", msg:`Narrower than the ${d} mm bore — the nozzle cannot lay a line thinner than its own orifice.`};
  else if(inp.lw > d*2.2) out["r-lw"] = {lvl:"crit", msg:`Over 2.2× the bore. The bead cannot be shaped this wide and will bulge.`};
  else if(inp.lw > d*1.6) out["r-lw"] = {lvl:"warn", msg:`Wide for a ${d} mm nozzle. Workable for structural infill, poor on visible walls.`};

  if(!(inp.path > 0)) out["r-path"] = {lvl:"crit", msg:"Layer path must be positive."};
  else if(inp.path < 50) out["r-path"] = {lvl:"warn", msg:"Very short — the cooling check will report a slowdown on almost any setting."};

  if(!(inp.height > 0)) out["r-h"] = {lvl:"crit", msg:"Part height must be positive."};
  else if(pr && inp.height > pr.build[2]) out["r-h"] = {lvl:"crit", msg:`Taller than the ${pr.short}'s ${pr.build[2]} mm Z travel.`};
  else if(pr && inp.height > pr.build[2]*0.92) out["r-h"] = {lvl:"warn", msg:`Within 8% of the ${pr.build[2]} mm Z limit — check clearance for the toolhead.`};
  return out;
}

function paintIssues(map){
  Object.keys(map.fields).forEach(id=>{
    const el = document.getElementById(id); if(!el) return;
    const issue = map.issues[id];
    el.classList.toggle("bad", !!issue && issue.lvl==="crit");
    el.classList.toggle("caution", !!issue && issue.lvl==="warn");
    el.setAttribute("aria-invalid", issue && issue.lvl==="crit" ? "true":"false");
    const host = el.closest("label.f") || el.parentElement;
    let msg = host.querySelector(":scope > .vmsg");
    if(!msg){ msg = document.createElement("span"); msg.className="vmsg"; host.appendChild(msg); }
    msg.textContent = issue ? issue.msg : "";
    msg.className = "vmsg" + (issue ? " on "+issue.lvl : "");
  });
}

function ruleOf(el){
  if(el.dataset.c) return el.dataset.c;
  if(el.dataset.mv) return "mv_" + el.dataset.mv;
  if(el.dataset.mp) return "pa_" + el.dataset.mp;
  if(el.dataset.mo) return "mo_" + el.dataset.mo;
  return null;
}

/* Applies classes and messages in place — never rebuilds the DOM, so it is
   safe to run on every keystroke. */
function applyValidation(){
  const d = state.draft, body = $("#dr-body");
  if(!d || !body) return;
  let crit = 0, warn = 0;
  body.querySelectorAll("[data-c],[data-mv],[data-mp],[data-mo]").forEach(el=>{
    if(el.tagName === "SELECT") return;
    const rule = ruleOf(el); if(!rule) return;
    // A number input discards text it cannot parse, leaving value === "".
    // Without this the field would look accepted while holding nothing.
    const issue = (el.validity && el.validity.badInput)
      ? { lvl:"crit", msg:"This field takes a number — the characters typed were not stored." }
      : validateField(rule, el.value, d);
    el.classList.toggle("bad", !!issue && issue.lvl === "crit");
    el.classList.toggle("caution", !!issue && issue.lvl === "warn");
    el.setAttribute("aria-invalid", issue && issue.lvl === "crit" ? "true" : "false");
    const host = el.closest("label.f") || el.parentElement;
    let msg = host.querySelector(":scope > .vmsg");
    if(!msg){ msg = document.createElement("span"); msg.className = "vmsg"; host.appendChild(msg); }
    msg.textContent = issue ? issue.msg : "";
    msg.className = "vmsg" + (issue ? " on " + issue.lvl : "");
    if(issue){ issue.lvl === "crit" ? crit++ : warn++; }
  });
  const vc = $("#dr-vcount");
  if(vc){
    vc.textContent = crit ? `${crit} out of range` : warn ? `${warn} unusual` : "";
    vc.style.color = crit ? "var(--crit)" : "var(--warn)";
  }
  const sum = body.querySelector("#v-summary");
  if(sum){
    if(crit){
      sum.className = "vsummary crit";
      sum.innerHTML = `<span class="ic">!!</span><div>${crit} value${crit>1?"s":""} outside what the hardware or the material allows${warn?`, and ${warn} worth a second look`:""}. You can still save — the fields are marked.</div>`;
    } else if(warn){
      sum.className = "vsummary warn";
      sum.innerHTML = `<span class="ic">!</span><div>${warn} value${warn>1?"s":""} outside the usual range for ${esc(MATERIALS[matOf(d)].label)}. Deliberate is fine; the reason is on each field.</div>`;
    } else {
      sum.className = "vsummary ok";
      sum.innerHTML = `<span class="ic">✓</span><div>Every entered value sits inside the expected range for ${esc(MATERIALS[matOf(d)].label)}.</div>`;
    }
  }
}

/* ------------------------------- drafts --------------------------------- */
/* Anything typed but not saved lives here, keyed by record. Closing the panel
   or reloading the page keeps it; only an explicit discard throws it away.
   Storage is per-viewer and can be unavailable, so every access is guarded. */
const DRAFT_STORE = "partsbench.drafts.v1";
let drafts = {};

function loadDrafts(){
  try{ const raw = localStorage.getItem(DRAFT_STORE); drafts = raw ? (JSON.parse(raw)||{}) : {}; }
  catch(e){ drafts = {}; }
  if(typeof drafts !== "object" || drafts === null) drafts = {};
}
let draftT;
function persistDrafts(){
  clearTimeout(draftT);
  draftT = setTimeout(()=>{ try{ localStorage.setItem(DRAFT_STORE, JSON.stringify(drafts)); }catch(e){} }, 200);
}
let libT;
function sameAsSaved(key, d){
  if(!d || d._pending) return false;
  const saved = spools.find(x=>x.id===key);
  if(!saved) return false;
  const norm = o => {
    const c = JSON.parse(JSON.stringify(o));
    delete c.id; delete c.updated; delete c._pending; delete c._started;
    ["core","advanced","measured"].forEach(k=>{ if(c[k] && !Object.keys(c[k]).length) delete c[k]; });
    return JSON.stringify(c, Object.keys(c).sort());
  };
  try{ return norm(saved) === norm(d); }catch(e){ return false; }
}
function isBlankDraft(d){
  if(!d) return false;
  return !d.brand && !d.colorName && !d.batch && !d.notes && !d.rating && !d.opened
    && !Object.keys(d.core||{}).length && !Object.keys(d.advanced||{}).length
    && !Object.keys(d.measured||{}).length;
}
function touchDraft(){
  if(!state.draftKey || !state.draft) return;
  if(sameAsSaved(state.draftKey, state.draft)) delete drafts[state.draftKey];
  else drafts[state.draftKey] = state.draft;
  persistDrafts();
  updateDraftChrome();
  clearTimeout(libT); libT = setTimeout(renderLibrary, 400);
}
function dropDraft(key){
  delete drafts[key];
  try{ localStorage.setItem(DRAFT_STORE, JSON.stringify(drafts)); }catch(e){}
  renderLibrary();
}
function pendingDrafts(){
  return Object.keys(drafts).filter(k=>drafts[k] && drafts[k]._pending)
    .map(k=>Object.assign({}, drafts[k], {id:k}));
}
function draftCount(){ return Object.keys(drafts).length; }
function updateDraftChrome(){
  const chip = $("#dr-draftchip"), dis = $("#dr-discard");
  const has = !!(state.draftKey && drafts[state.draftKey]);
  if(chip) chip.style.display = has ? "" : "none";
  if(dis) dis.style.display = has ? "" : "none";
  const cd = $("#btn-cleardrafts");
  if(cd){
    const n = draftCount();
    cd.style.display = n ? "" : "none";
    cd.textContent = n===1 ? "Clear 1 draft" : `Clear ${n} drafts`;
    cd.title = "Discard every unsaved entry, including part-finished new spools";
  }
}

/* ------------------------------ local API ------------------------------- */
/* Everything is served by app.py on this machine. The server owns the files,
   the SQLite database and the change log; the client just reflects it. */
let spools = [], hotends = [], configs = [], parts = [], prints = [], history = [];
let versions = {}, SETTINGS = {root:"", layout:""};
let ONLINE = false;

const state = { view:"library", sel:null, drTab:"core", symptoms:new Set(), draft:null,
                pinned:false, mode:"spool", configs:[], cmpSel:new Set(), hint:null, draftKey:null,
                closed:{deriv:false, physics:false, profile:false} };

const uid = () => "s" + Date.now().toString(36) + Math.random().toString(36).slice(2,6);

async function api(path, opts){
  const r = await fetch(path, Object.assign({headers:{"Content-Type":"application/json"}}, opts||{}));
  if(!r.ok){
    let msg = r.status + " " + r.statusText;
    try{ const j = await r.json(); if(j.error) msg = j.error; }catch(e){}
    throw new Error(msg);
  }
  return r.status === 204 ? null : r.json();
}
const jput = (path, body) => api(path, {method:"PUT", body:JSON.stringify(body)});
const jdel = (path)       => api(path, {method:"DELETE"});

function setStatus(ok, msg){
  ONLINE = ok;
  const dot = $("#syncdot"), t = $("#syncmsg");
  if(dot) dot.className = "dot " + (ok ? "live" : "local");
  if(t) t.textContent = msg;
}

async function refresh(){
  try{
    const st = await api("/api/state");
    spools = st.spools; hotends = st.hotends; configs = st.configs;
    parts = st.parts; prints = st.prints; history = st.history;
    versions = st.versions || {};
    SETTINGS = st.settings || SETTINGS;
    if(st.meta && Array.isArray(st.meta.scale) && st.meta.scale.length === 7) SCALE = st.meta.scale.slice();
    setStatus(true, "saved to " + shortRoot(SETTINGS.root));
    const rl = $("#rootlabel"); if(rl && SETTINGS.root) rl.textContent = shortRoot(SETTINGS.root);
    renderAll();
  }catch(e){
    setStatus(false, "server not reachable");
    const grid = $("#part-grid");
    if(grid && !parts.length) grid.innerHTML = `<div class="panel" style="grid-column:1/-1"><div class="body empty">
      Cannot reach the Parts Bench server. Check that <span class="mono">app.py</span> is still running in its console window, then reload.</div></div>`;
  }
}
function shortRoot(p){
  if(!p) return "disk";
  const bits = p.replace(/\\/g,"/").split("/").filter(Boolean);
  return bits.length > 2 ? "…/" + bits.slice(-2).join("/") : p;
}

async function boot(){
  loadDrafts();
  hotends = [];
  await refresh();
  setInterval(()=>{ if(document.visibilityState === "visible" && ONLINE) quietRefresh(); }, 20000);
}
let qrT;
async function quietRefresh(){
  clearTimeout(qrT);
  qrT = setTimeout(async ()=>{
    if($("#drawer").classList.contains("on")) return;   // never redraw under an open editor
    try{ await refresh(); }catch(e){}
  }, 50);
}

/* ---- collection writes; the server diffs and logs them ---- */
async function saveSpool(sp){
  const id = sp.id || uid(); sp.id = id;
  try{ await jput("/api/spools/" + id, sp); toast("Saved"); }
  catch(e){ toast("Could not save: " + e.message); return; }
  await refresh();
}
async function delSpool(id){
  try{ await jdel("/api/spools/" + id); toast("Deleted"); }catch(e){ toast("Could not delete"); return; }
  await refresh();
}
async function saveHotend(h, quiet){
  const id = h.id || uid(); h.id = id;
  try{ await jput("/api/hotends/" + id, h); }catch(e){ if(!quiet) toast("Could not save"); return; }
  if(!quiet) toast("Saved");
  await refresh();
}
async function delHotend(id){
  try{ await jdel("/api/hotends/" + id); }catch(e){ return; }
  await refresh();
}
async function saveConfig(c){
  const id = c.id || uid(); c.id = id;
  try{ await jput("/api/configs/" + id, c); toast("Configuration saved"); }
  catch(e){ toast("Could not save"); return; }
  await refresh();
}
async function delConfig(id){
  try{ await jdel("/api/configs/" + id); }catch(e){ return; }
  state.cmpSel.delete(id);
  await refresh();
}
async function saveScale(){
  try{ await jput("/api/meta/scale", SCALE); toast("Scale saved"); }
  catch(e){ toast("Could not save the scale"); }
}

/* --------------------------------- ui ----------------------------------- */
const $ = s => document.querySelector(s);
const esc = s => String(s==null?"":s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let toastT;
function toast(t){ const e=$("#toast"); e.textContent=t; e.classList.add("on"); clearTimeout(toastT); toastT=setTimeout(()=>e.classList.remove("on"),2000); }

document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>{
  state.view = b.dataset.view;
  if(!state.pinned) drawer(false);
  document.querySelectorAll(".tab").forEach(t=>t.setAttribute("aria-selected", String(t===b)));
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("on", v.id==="v-"+state.view));
  renderAll();
}));

function renderAll(){ renderLibrary(); renderParts(); renderRecommend(); renderDiagnose(); renderCompare(); renderHotends(); renderHistory(); renderStorage(); renderReference(); wireHints(); }

/* ---- hints ---- */
function wireHints(){
  document.querySelectorAll(".hintbtn").forEach(b=>{
    if(b.dataset.wired) return; b.dataset.wired="1";
    b.addEventListener("click",()=>{
      const k=b.dataset.hint, slot=document.getElementById(b.dataset.slot);
      const open = state.hint===k;
      state.hint = open ? null : k;
      document.querySelectorAll(".hintbtn").forEach(x=>x.setAttribute("aria-expanded", String(!open && x===b)));
      document.querySelectorAll("[id^='hint-']").forEach(x=>{ if(x!==slot) x.innerHTML=""; });
      slot.innerHTML = open ? "" : `<div class="hintcard"><h4>${esc(HINTS[k].title)}</h4>${HINTS[k].html}</div>`;
    });
  });
}

/* ---- stars ---- */
function starsHTML(v, editable){
  let h = '<span class="stars">';
  for(let i=1;i<=7;i++) h += `<button class="star ${i<=(v||0)?"on":""}" ${editable?`data-star="${i}"`:"disabled"} title="${esc(i+" — "+SCALE[i-1])}" aria-label="${esc(i+" of 7: "+SCALE[i-1])}">${i<=(v||0)?"★":"☆"}</button>`;
  return h + "</span>";
}

/* ---- library ---- */
function matOf(s){ return MATERIALS[s.type] ? s.type : "PLA"; }
function spoolFlowFactor(s){ return s.measured && s.measured.mvs ? flowFactorFromMeasurement(s.measured.mvs, matOf(s)) : null; }

function renderLibrary(){
  const q = ($("#q").value||"").toLowerCase(), ft=$("#f-type").value, fb=$("#f-brand").value, fs=$("#f-state").value;
  // filter option lists
  const types=[...new Set(spools.map(s=>s.type))].sort(), brands=[...new Set(spools.map(s=>s.brand))].sort();
  syncOptions($("#f-type"), types, "All types");
  syncOptions($("#f-brand"), brands, "All brands");

  const rows = pendingDrafts().concat(spools);
  const list = rows.filter(s=>{
    if(ft && s.type!==ft) return false;
    if(fb && s.brand!==fb) return false;
    const ff = spoolFlowFactor(s);
    if(fs==="measured" && !ff) return false;
    if(fs==="unmeasured" && ff) return false;
    if(fs==="abrasive" && !(MATERIALS[matOf(s)]||{}).abr) return false;
    if(fs==="wet" && !s.needsDry) return false;
    if(fs==="rated" && !s.rating) return false;
    if(fs==="unrated" && s.rating) return false;
    if(q){ const hay=[s.brand,s.type,s.colorName,s.batch,s.notes].join(" ").toLowerCase(); if(!hay.includes(q)) return false; }
    return true;
  }).sort((a,b)=>(a.brand+a.type+a.colorName).localeCompare(b.brand+b.type+b.colorName));

  const nPending = pendingDrafts().length;
  $("#count").textContent = `${list.length} of ${rows.length} spool${rows.length===1?"":"s"}`
    + (nPending? ` · ${nPending} unsaved` : "");
  updateDraftChrome();
  const tb = $("#rows");
  if(!list.length){
    tb.innerHTML = `<tr><td colspan="8"><div class="empty">${rows.length? "No spools match these filters." : "No spools yet. Add one, or import a Bambu Studio filament profile."}</div></td></tr>`;
    return;
  }
  tb.innerHTML = list.map(s=>{
    const m = MATERIALS[matOf(s)]||MATERIALS.PLA;
    const ff = spoolFlowFactor(s);
    const mv = s.measured&&s.measured.mvs&&s.measured.mvs.value ? s.measured.mvs.value : null;
    const pills = [];
    if(s._pending) pills.push('<span class="pill warn">draft — not saved</span>');
    else if(drafts[s.id]) pills.push('<span class="pill warn">unsaved edits</span>');
    if(s.example) pills.push('<span class="pill">example</span>');
    if(m.abr) pills.push('<span class="pill warn">abrasive</span>');
    if(s.needsDry) pills.push('<span class="pill crit">needs drying</span>');
    if(ff) pills.push(`<span class="pill ok">flow ${(ff*100).toFixed(0)}% nominal</span>`);
    if(s.advanced && Object.keys(s.advanced).length) pills.push(`<span class="pill acc">${Object.keys(s.advanced).length} custom</span>`);
    return `<tr data-id="${s.id}">
      <td><div class="cellflex"><span class="swatch" style="background:${esc(s.colorHex||"#888")}"></span>
        <span>${esc(s.colorName||"—")}</span></div></td>
      <td>${esc(s.brand|| (s._pending? "new spool" : "—"))}</td>
      <td>${esc(m.label)}</td>
      <td class="mono">${esc(s.batch||"—")}</td>
      <td class="sub num">${esc(s.opened||"—")}</td>
      <td data-rate="${s.id}">${starsHTML(s.rating,true)}</td>
      <td class="mono num">${mv? mv.toFixed(1)+" mm³/s" : '<span class="sub">—</span>'}</td>
      <td><div class="cellflex" style="gap:5px; flex-wrap:wrap">${pills.join("")||'<span class="sub">—</span>'}</div></td>
    </tr>`;
  }).join("");
  tb.querySelectorAll("tr[data-id]").forEach(tr=>tr.addEventListener("click",()=>openSpool(tr.dataset.id)));
  tb.querySelectorAll("[data-rate] .star").forEach(btn=>btn.addEventListener("click",e=>{
    e.stopPropagation();
    const id = btn.closest("[data-rate]").dataset.rate;
    const sp = spools.find(x=>x.id===id); if(!sp) return;
    const v = +btn.dataset.star;
    sp.rating = (sp.rating===v) ? 0 : v;
    saveSpool(sp);
  }));
}
function syncOptions(sel, vals, first){
  const cur = sel.value;
  sel.innerHTML = `<option value="">${first}</option>` + vals.map(v=>`<option${v===cur?" selected":""}>${esc(v)}</option>`).join("");
  sel.value = vals.includes(cur) ? cur : "";
}
["#q","#f-type","#f-brand","#f-state"].forEach(s=>$(s).addEventListener("input",renderLibrary));
$("#btn-cleardrafts").addEventListener("click",()=>{
  const n = draftCount(); if(!n) return;
  if(!confirm(`Discard ${n} unsaved ${n===1?"entry":"entries"}? Saved spools are not affected.`)) return;
  drafts = {};
  try{ localStorage.setItem(DRAFT_STORE, "{}"); }catch(e){}
  state.draftKey = null; drawer(false); renderLibrary();
  toast(n===1? "Draft cleared" : `${n} drafts cleared`);
});

/* ---- spool drawer ---- */
const DR_TABS = [["core","Core"],["advanced","Advanced"],["measured","Measured"],["export","Export"]];
function blankSpool(){
  return { brand:"", type:"PLA", colorName:"", colorHex:"#3D6E8F", batch:"", opened:"",
           notes:"", needsDry:false, core:{}, advanced:{}, measured:{} };
}
function openSpool(id){
  state.mode = "spool"; state.part = null;
  const saved = spools.find(s=>s.id===id);
  if(drafts[id]) state.draft = JSON.parse(JSON.stringify(drafts[id]));
  else if(saved) state.draft = JSON.parse(JSON.stringify(saved));
  else return;                       // stale row; nothing to open
  state.draftKey = id;
  state.sel = saved ? id : null;     // pending drafts have nothing to delete yet
  state.drTab = "core";
  $("#dr-del").style.display = saved ? "" : "none";
  drawer(true); renderDrawer();
}

/* A new spool is a draft with its own key, so several can be part-finished at
   once and each shows in the library while you carry on browsing. */
function newSpool(){
  state.mode = "spool"; state.part = null;
  const blank = Object.keys(drafts).find(k=>drafts[k] && drafts[k]._pending && isBlankDraft(drafts[k]));
  if(blank){
    state.draft = drafts[blank]; state.draftKey = blank; state.sel = null; state.drTab = "core";
    $("#dr-del").style.display = "none";
    drawer(true); renderDrawer();
    return;
  }
  const key = "draft_" + uid();
  const d = blankSpool(); d._pending = true; d._started = new Date().toISOString();
  drafts[key] = d; persistDrafts();
  state.draft = d; state.draftKey = key; state.sel = null; state.drTab = "core";
  $("#dr-del").style.display = "none";
  drawer(true); renderDrawer(); renderLibrary();
}
function drawer(on){
  if(!on && state.mode !== "spool"){
    state.mode = "spool"; state.part = null; state.printDraft = null;
    $("#dr-del").textContent = "Delete";
    $("#dr-save").textContent = "Save spool";
    resetSaveHandler();
  }
  // Closing never discards what was typed — but an untouched new-spool form
  // leaves nothing behind, so Add can be opened and abandoned freely.
  if(on === false && state.draftKey && state.draft){
    if(state.draft._pending && isBlankDraft(state.draft)){ delete drafts[state.draftKey]; persistDrafts(); state.draftKey=null; }
    else touchDraft();
  }
  $("#drawer").classList.toggle("on",on);
  $("#scrim").classList.toggle("on", on && !state.pinned);
  if(!on){ state.pinned = false; document.body.classList.remove("pinned"); syncPinBtn(); }
}
function syncPinBtn(){
  const b = $("#dr-pin"); if(!b) return;
  b.textContent = state.pinned ? "Unpin" : "Pin";
  b.classList.toggle("primary", state.pinned);
  b.title = state.pinned ? "Return to an overlay panel" : "Dock this panel so it stays open while you move between tabs";
}
const PIN_OK = window.matchMedia("(min-width:1180px)");
function enforcePin(){
  if(!PIN_OK.matches && state.pinned){
    state.pinned = false;
    document.body.classList.remove("pinned");
    $("#scrim").classList.toggle("on", $("#drawer").classList.contains("on"));
    syncPinBtn();
  }
}
if(PIN_OK.addEventListener) PIN_OK.addEventListener("change", enforcePin);
else if(PIN_OK.addListener) PIN_OK.addListener(enforcePin);

$("#dr-pin").addEventListener("click",()=>{
  if(!PIN_OK.matches){ toast("Docking needs a wider window — the panel stays as an overlay here"); return; }
  state.pinned = !state.pinned;
  document.body.classList.toggle("pinned", state.pinned);
  $("#scrim").classList.toggle("on", !state.pinned);
  syncPinBtn();
  if(state.pinned) toast("Panel pinned — it stays open while you switch tabs");
});
$("#scrim").addEventListener("click",()=>drawer(false));
$("#dr-close").addEventListener("click",()=>drawer(false));
$("#btn-add").addEventListener("click",newSpool);

function updateDrawerTitle(){
  const d = state.draft; if(!d) return;
  const m = MATERIALS[matOf(d)];
  $("#dr-title").textContent = (d.brand||d.colorName)
    ? `${d.brand||"Spool"} · ${d.colorName||m.label}` : "New spool";
}

/* Rebuilding .dbody replaces every field, so remember which one had focus and
   put the caret back where it was. */
function captureFocus(){
  const a = document.activeElement;
  if(!a || !$("#dr-body").contains(a)) return null;
  for(const attr of ["data-k","data-c","data-a","data-mv","data-mp","data-mo","id"]){
    const v = a.getAttribute(attr);
    if(v) return { sel:`[${attr}="${CSS.escape(v)}"]`,
                   start:a.selectionStart, end:a.selectionEnd };
  }
  return null;
}
function restoreFocus(f){
  if(!f) return;
  const el = $("#dr-body").querySelector(f.sel);
  if(!el) return;
  el.focus();
  try{ if(f.start!=null && el.setSelectionRange) el.setSelectionRange(f.start, f.end); }catch(e){}
}

function renderDrawer(){
  const d = state.draft; if(!d) return;
  const m = MATERIALS[matOf(d)];
  $("#dr-title").textContent = d.brand||d.colorName ? `${d.brand||"Spool"} · ${d.colorName||m.label}` : "New spool";
  $("#dr-tabs").innerHTML = DR_TABS.map(([k,l])=>`<button class="dtab" data-t="${k}" aria-selected="${state.drTab===k}">${l}</button>`).join("");
  $("#dr-tabs").querySelectorAll(".dtab").forEach(b=>b.addEventListener("click",()=>{state.drTab=b.dataset.t; renderDrawer();}));
  const body = $("#dr-body");
  const focus = captureFocus();
  body.innerHTML = state.drTab==="core" ? drCore(d,m)
    : state.drTab==="advanced" ? drAdvanced(d)
    : state.drTab==="measured" ? drMeasured(d,m)
    : drExport(d,m);
  wireDrawer();
  applyValidation();
  updateDraftChrome();
  restoreFocus(focus);
}

function fld(label,key,val,type,extra){
  return `<label class="f"><span>${label}</span><input type="${type||"text"}" data-k="${key}" value="${esc(val==null?"":val)}" ${extra||""}></label>`;
}
function drCore(d,m){
  const c = d.core||{};
  const dv = (k,fallback)=> c[k]!==undefined && c[k]!=="" ? c[k] : "";
  const ph = v=>`placeholder="${v}"`;
  return `
  <div class="vsummary ok" id="v-summary"></div>
  <fieldset class="fieldset"><legend>Identification</legend>
    <div class="grid g2">
      ${fld("Brand","brand",d.brand)}
      <label class="f"><span>Material type</span><select data-k="type">${Object.keys(MATERIALS).map(k=>`<option value="${k}"${k===d.type?" selected":""}>${MATERIALS[k].label}</option>`).join("")}</select></label>
      ${fld("Colour name","colorName",d.colorName)}
      <label class="f"><span>Colour</span><input type="color" data-k="colorHex" value="${esc(d.colorHex||"#3D6E8F")}"></label>
      ${fld("Batch / lot number","batch",d.batch)}
      ${fld("Opened","opened",d.opened,"date")}
    </div>
    <div style="margin-top:12px; display:flex; gap:14px; align-items:center; flex-wrap:wrap">
      <label style="display:flex; gap:7px; align-items:center; font-size:13px"><input type="checkbox" data-k="needsDry" ${d.needsDry?"checked":""} style="width:auto"> Flagged for drying</label>
      ${m.abr?'<span class="pill warn">abrasive — hardened or carbide nozzle required</span>':""}
    </div>
  </fieldset>

  <fieldset class="fieldset"><legend>Core print parameters</legend>
    <p class="hint" style="margin:-4px 0 12px">Blank means the generic ${esc(m.label)} value is used. Fill a field only where this batch differs.</p>
    <div class="grid g2">
      <label class="f"><span>Nozzle temp °C</span><input type="number" data-c="nozzle_temperature" value="${dv("nozzle_temperature")}" ${ph(m.t)}></label>
      <label class="f"><span>First layer nozzle °C</span><input type="number" data-c="nozzle_temperature_initial_layer" value="${dv("nozzle_temperature_initial_layer")}" ${ph(m.t1)}></label>
      <label class="f"><span>Range low °C</span><input type="number" data-c="nozzle_temperature_range_low" value="${dv("nozzle_temperature_range_low")}" ${ph(m.tlo)}></label>
      <label class="f"><span>Range high °C</span><input type="number" data-c="nozzle_temperature_range_high" value="${dv("nozzle_temperature_range_high")}" ${ph(m.thi)}></label>
      <label class="f"><span>Hot plate °C</span><input type="number" data-c="hot_plate_temp" value="${dv("hot_plate_temp")}" ${ph(m.bed)}></label>
      <label class="f"><span>Textured plate °C</span><input type="number" data-c="textured_plate_temp" value="${dv("textured_plate_temp")}" ${ph(m.bed)}></label>
      <label class="f"><span>Cool plate °C</span><input type="number" data-c="cool_plate_temp" value="${dv("cool_plate_temp")}" ${ph(m.cool)}></label>
      <label class="f"><span>Chamber °C</span><input type="number" data-c="chamber_temperatures" value="${dv("chamber_temperatures")}" ${ph(m.cham)}></label>
      <label class="f"><span>Max volumetric mm³/s</span><input type="number" step="0.1" data-c="filament_max_volumetric_speed" value="${dv("filament_max_volumetric_speed")}" placeholder="computed"></label>
      <label class="f"><span>Flow ratio</span><input type="number" step="0.001" data-c="filament_flow_ratio" value="${dv("filament_flow_ratio")}" ${ph(m.flow)}></label>
      <label class="f"><span>Density g/cm³</span><input type="number" step="0.01" data-c="filament_density" value="${dv("filament_density")}" ${ph(m.rho)}></label>
      <label class="f"><span>Shrink %</span><input type="text" data-c="filament_shrink" value="${dv("filament_shrink")}" placeholder="100%"></label>
      <label class="f"><span>Fan min %</span><input type="number" data-c="fan_min_speed" value="${dv("fan_min_speed")}" ${ph(m.fanMin)}></label>
      <label class="f"><span>Fan max %</span><input type="number" data-c="fan_max_speed" value="${dv("fan_max_speed")}" ${ph(m.fanMax)}></label>
      <label class="f"><span>Overhang fan %</span><input type="number" data-c="overhang_fan_speed" value="${dv("overhang_fan_speed")}" ${ph(m.ohFan)}></label>
      <label class="f"><span>Overhang threshold</span><input type="text" data-c="overhang_fan_threshold" value="${dv("overhang_fan_threshold")}" ${ph(m.ohThr)}></label>
      <label class="f"><span>Slow-down layer time s</span><input type="number" data-c="slow_down_layer_time" value="${dv("slow_down_layer_time")}" ${ph(m.slow)}></label>
      <label class="f"><span>Retraction mm</span><input type="number" step="0.05" data-c="filament_retraction_length" value="${dv("filament_retraction_length")}" placeholder="computed"></label>
      <label class="f"><span>Drying °C</span><input type="number" data-c="filament_dev_ams_drying_temperature" value="${dv("filament_dev_ams_drying_temperature")}" ${ph(m.dryT)}></label>
      <label class="f"><span>Drying hours</span><input type="number" data-c="filament_dev_ams_drying_time" value="${dv("filament_dev_ams_drying_time")}" ${ph(m.dryH)}></label>
    </div>
  </fieldset>

  <fieldset class="fieldset"><legend>Quality rating</legend>
    <div class="starrow">
      <span id="dr-stars">${starsHTML(d.rating,true)}</span>
      <span class="sub" id="dr-scale">${d.rating? esc(d.rating+" — "+SCALE[d.rating-1]) : "not rated"}</span>
      ${d.rating? '<button class="btn ghost sm" id="dr-clearrate">Clear</button>' : ""}
    </div>
    <p class="hint">Rate the batch, not the brand. The wording of each step is editable under Reference.</p>
  </fieldset>

  <fieldset class="fieldset"><legend>Notes</legend>
    <textarea data-k="notes" rows="3" placeholder="Anything that only applies to this lot.">${esc(d.notes||"")}</textarea>
  </fieldset>`;
}

function drAdvanced(d){
  const adv = d.advanced||{};
  const keys = Object.keys(adv);
  const groups = BAMBU_KEYS.map(([g,ks])=>`<optgroup label="${esc(g)}">${ks.map(k=>`<option value="${k}">${k}</option>`).join("")}</optgroup>`).join("");
  return `
  <p class="hint" style="margin-bottom:14px">Any Bambu Studio filament key can be set here and it will be written into the exported profile verbatim, overriding both the material default and the core field above. Keys are the real profile names as shipped in Bambu Studio's filament presets.</p>
  <div class="grid" style="grid-template-columns:1fr auto; gap:8px; margin-bottom:14px">
    <select id="adv-pick">${groups}</select>
    <button class="btn" id="adv-add">Add key</button>
  </div>
  <div id="adv-rows">
    ${keys.length? keys.map(k=>`<div class="kvrow"><span class="k mono">${esc(k)}</span><input type="text" data-a="${esc(k)}" value="${esc(adv[k])}"><button class="btn ghost sm" data-rm="${esc(k)}" aria-label="Remove ${esc(k)}">✕</button></div>`).join("")
      : '<p class="sub">No custom keys on this spool.</p>'}
  </div>
  <div style="margin-top:22px">
    <label class="f"><span>Free-form key</span><div class="grid" style="grid-template-columns:1fr auto; gap:8px">
      <input type="text" id="adv-free" placeholder="e.g. filament_ramming_volumetric_speed">
      <button class="btn" id="adv-freeadd">Add</button>
    </div></label>
  </div>`;
}

function predictionTable(d, ff, pf){
  if(!ff && !pf) return "";
  return `<div class="tablewrap" style="margin-top:14px"><table style="min-width:520px"><thead><tr>
    <th>Combination</th><th>Predicted max flow</th><th>Predicted k factor</th></tr></thead><tbody>` +
    hotends.map(h=>{
      const c = flowCeiling(h.body, +h.nozzle, h.cls, matOf(d), ff||1);
      const k = paFor(matOf(d), h.body, +h.nozzle, pf||1);
      return `<tr style="cursor:default"><td>${esc(h.name)}</td>
        <td class="mono num">${c.q.toFixed(1)} mm³/s <span class="sub">${c.bound==="rating"?"hotend rated":"melt limited"}</span></td>
        <td class="mono num">${k.toFixed(3)}</td></tr>`;
    }).join("") + `</tbody></table></div>`;
}

function drMeasured(d,m){
  const mm = (d.measured&&d.measured.mvs)||{}, mp = (d.measured&&d.measured.pa)||{};
  const ff = spoolFlowFactor(d), pf = paFactorFromMeasurement(mp, matOf(d));
  const hopts = hotends.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join("");
  const table = `<div id="mv-table">${predictionTable(d, ff, pf)}</div>`;
  return `
  <div class="vsummary ok" id="v-summary"></div>
  <p class="hint" style="margin-bottom:14px">Measure one combination properly and the model transfers it to every other nozzle and hotend for this spool. The measurement sets a flow factor relative to nominal for the material, which then scales with melt-zone volume and nozzle class.</p>
  <fieldset class="fieldset"><legend>Measured maximum volumetric flow</legend>
    <div class="grid g3">
      <label class="f"><span>Measured on</span><select data-mv="hot">${hopts}</select></label>
      <label class="f"><span>Value mm³/s</span><input type="number" step="0.1" data-mv="value" value="${mm.value||""}"></label>
      <label class="f"><span>At nozzle °C</span><input type="number" data-mv="temp" value="${mm.temp||""}" placeholder="${m.t}"></label>
    </div>
    <p class="hint" id="mv-factor">${ff? `This spool flows <b>${(ff*100).toFixed(0)}%</b> of nominal for ${esc(m.label)}.`:""}</p>
  </fieldset>
  <fieldset class="fieldset"><legend>Measured pressure advance</legend>
    <div class="grid g3">
      <label class="f"><span>Measured on</span><select data-mp="hot">${hopts}</select></label>
      <label class="f"><span>k factor</span><input type="number" step="0.001" data-mp="value" value="${mp.value||""}"></label>
      <label class="f"><span>At accel mm/s²</span><input type="number" data-mp="accel" value="${mp.accel||""}" placeholder="10000"></label>
    </div>
    <p class="hint" id="pa-factor">${pf? `Pressure advance runs <b>${(pf*100).toFixed(0)}%</b> of nominal for this material.`:""}</p>
  </fieldset>
  <fieldset class="fieldset"><legend>Measured filament</legend>
    <div class="grid g2">
      <label class="f"><span>Mean diameter mm</span><input type="number" step="0.001" data-mo="diameter" value="${(d.measured&&d.measured.diameter)||""}" placeholder="1.750"></label>
      <label class="f"><span>Calibrated flow ratio</span><input type="number" step="0.001" data-mo="flow" value="${(d.measured&&d.measured.flow)||""}" placeholder="${m.flow}"></label>
    </div>
  </fieldset>
  ${table}`;
}

function bambuProfile(d, hotendId){
  const m = MATERIALS[matOf(d)], c = d.core||{}, adv = d.advanced||{};
  const h = hotends.find(x=>x.id===hotendId) || hotends[0];
  const ff = spoolFlowFactor(d);
  const ceil = h ? flowCeiling(h.body, +h.nozzle, h.cls, matOf(d), ff||1) : null;
  const pr = h ? PRINTERS[h.printer] : PRINTERS.x1c;
  const A = v => [String(v)];
  const o = {
    type:"filament",
    name:`${d.brand||"Custom"} ${m.label} ${d.colorName||""}${d.batch? " ["+d.batch+"]":""}`.replace(/\s+/g," ").trim(),
    from:"User", instantiation:"true",
    filament_settings_id:A(`${d.brand||"Custom"} ${m.label}${d.batch? " "+d.batch:""}`),
    filament_vendor:A(d.brand||"Custom"),
    filament_type:A(m.label.split(" ")[0].replace("/","")),
    filament_diameter:A((d.measured&&d.measured.diameter)||1.75),
    filament_density:A(c.filament_density||m.rho),
    filament_flow_ratio:A(c.filament_flow_ratio||(d.measured&&d.measured.flow)||m.flow),
    filament_max_volumetric_speed:A(c.filament_max_volumetric_speed || (ceil? (ceil.q*0.85).toFixed(1) : 12)),
    nozzle_temperature:A(c.nozzle_temperature||m.t),
    nozzle_temperature_initial_layer:A(c.nozzle_temperature_initial_layer||m.t1),
    nozzle_temperature_range_low:A(c.nozzle_temperature_range_low||m.tlo),
    nozzle_temperature_range_high:A(c.nozzle_temperature_range_high||m.thi),
    temperature_vitrification:A(m.tg),
    chamber_temperatures:A(c.chamber_temperatures || (pr.chamber==="active"? Math.min(pr.maxChamber,m.cham) : 0)),
    hot_plate_temp:A(c.hot_plate_temp||m.bed),
    hot_plate_temp_initial_layer:A(c.hot_plate_temp||m.bed1),
    textured_plate_temp:A(c.textured_plate_temp||m.bed),
    textured_plate_temp_initial_layer:A(c.textured_plate_temp||m.bed1),
    cool_plate_temp:A(c.cool_plate_temp||m.cool),
    cool_plate_temp_initial_layer:A(c.cool_plate_temp||m.cool),
    eng_plate_temp:A(m.bed>=90? m.bed : 0),
    eng_plate_temp_initial_layer:A(m.bed>=90? m.bed1 : 0),
    fan_min_speed:A(c.fan_min_speed!==undefined&&c.fan_min_speed!==""?c.fan_min_speed:m.fanMin),
    fan_max_speed:A(c.fan_max_speed!==undefined&&c.fan_max_speed!==""?c.fan_max_speed:m.fanMax),
    overhang_fan_speed:A(c.overhang_fan_speed||m.ohFan),
    overhang_fan_threshold:A(c.overhang_fan_threshold||m.ohThr),
    slow_down_layer_time:A(c.slow_down_layer_time||m.slow),
    slow_down_min_speed:A(m.slowV),
    filament_retraction_length:A(c.filament_retraction_length || (h? (BODIES[h.body].retract*m.retract).toFixed(2) : 0.8)),
    filament_shrink:A(c.filament_shrink||"100%"),
    required_nozzle_HRC:A(m.hrc),
    filament_dev_ams_drying_temperature:[String(c.filament_dev_ams_drying_temperature||m.dryT)],
    filament_dev_ams_drying_time:[String(c.filament_dev_ams_drying_time||m.dryH)],
    compatible_printers:[`${pr.profile} ${h? h.nozzle : 0.4} nozzle`]
  };
  Object.keys(adv).forEach(k=>{ o[k] = Array.isArray(adv[k]) ? adv[k] : [String(adv[k])]; });
  return o;
}

function drExport(d,m){
  const hopts = hotends.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join("");
  const first = hotends[0] ? hotends[0].id : null;
  const json = JSON.stringify(bambuProfile(d, state.exportHot||first), null, 2);
  return `
  <p class="hint" style="margin-bottom:12px">A Bambu Studio custom filament profile using the real profile key names. Save it as a <span class="mono">.json</span> and use <b>Filament → Custom → Import</b> in Bambu Studio. Check the <span class="mono">compatible_printers</span> string against the printer preset name on your machine — it must match exactly.</p>
  <div class="grid" style="grid-template-columns:1fr auto auto; gap:8px; margin-bottom:12px; align-items:end">
    <label class="f"><span>Build for</span><select id="ex-hot">${hopts}</select></label>
    <button class="btn" id="ex-copy">Copy</button>
    <button class="btn primary" id="ex-dl">Download</button>
  </div>
  <textarea id="ex-json" rows="22" readonly>${esc(json)}</textarea>`;
}

function wireDrawer(){
  const d = state.draft;
  $("#dr-body").querySelectorAll("[data-k]").forEach(el=>{
    el.addEventListener("input",()=>{
      const k = el.dataset.k;
      d[k] = el.type==="checkbox" ? el.checked : el.value;
      // Update the heading in place. Never re-render the drawer on keystrokes —
      // replacing the DOM would drop focus out of the field being typed into.
      if(k==="brand"||k==="colorName") updateDrawerTitle();
      touchDraft();
    });
    // A material change alters every placeholder and default, so rebuild — but
    // only once the select is committed, never mid-keystroke.
    if(el.dataset.k==="type") el.addEventListener("change",()=>renderDrawer());
  });
  $("#dr-body").querySelectorAll("[data-c]").forEach(el=>{
    el.addEventListener("input",()=>{
      d.core = d.core||{};
      if(el.value==="") delete d.core[el.dataset.c]; else d.core[el.dataset.c]=el.value;
      applyValidation(); touchDraft();
    });
  });
  $("#dr-body").querySelectorAll("[data-a]").forEach(el=>{
    el.addEventListener("input",()=>{ d.advanced[el.dataset.a] = el.value; touchDraft(); });
  });
  $("#dr-body").querySelectorAll("[data-rm]").forEach(el=>{
    el.addEventListener("click",()=>{ delete d.advanced[el.dataset.rm]; touchDraft(); renderDrawer(); });
  });
  $("#dr-body").querySelectorAll("#dr-stars .star").forEach(btn=>btn.addEventListener("click",()=>{
    const v=+btn.dataset.star; d.rating = (d.rating===v)?0:v; touchDraft();
    const f = captureFocus(); renderDrawer(); restoreFocus(f);
  }));
  if($("#dr-clearrate")) $("#dr-clearrate").addEventListener("click",()=>{ d.rating=0; renderDrawer(); });
  const addKey = k=>{ if(!k) return; d.advanced = d.advanced||{}; if(d.advanced[k]===undefined) d.advanced[k]=""; touchDraft(); renderDrawer(); };
  if($("#adv-add")) $("#adv-add").addEventListener("click",()=>addKey($("#adv-pick").value));
  if($("#adv-freeadd")) $("#adv-freeadd").addEventListener("click",()=>addKey($("#adv-free").value.trim()));

  ["mv","mp","mo"].forEach(pfx=>{
    $("#dr-body").querySelectorAll(`[data-${pfx}]`).forEach(el=>{
      const slot = pfx==="mv"?"mvs":pfx==="mp"?"pa":null;
      if(slot){
        const cur = (d.measured&&d.measured[slot])||{};
        if(el.dataset[pfx]==="hot" && cur.hot) el.value = cur.hot;
        el.addEventListener("input",()=>{
          d.measured = d.measured||{}; d.measured[slot] = d.measured[slot]||{};
          const o = d.measured[slot], f = el.dataset[pfx];
          if(f==="hot"){ const h=hotends.find(x=>x.id===el.value); o.hot=el.value; if(h){o.body=h.body;o.nozzle=h.nozzle;o.cls=h.cls;} }
          else o[f] = el.value===""? "" : parseFloat(el.value);
          if(!o.body && hotends[0]){ o.hot=hotends[0].id; o.body=hotends[0].body; o.nozzle=hotends[0].nozzle; o.cls=hotends[0].cls; }
          if(f==="hot") renderDrawer(); else { updateMeasuredReadout(); applyValidation(); }
          touchDraft();
        });
      } else {
        el.addEventListener("input",()=>{
          d.measured=d.measured||{};
          d.measured[el.dataset.mo] = el.value===""?"":parseFloat(el.value);
          applyValidation(); touchDraft();
        });
      }
    });
  });

  if($("#ex-hot")){
    $("#ex-hot").value = state.exportHot || (hotends[0]&&hotends[0].id) || "";
    $("#ex-hot").addEventListener("change",()=>{ state.exportHot = $("#ex-hot").value; renderDrawer(); });
    $("#ex-copy").addEventListener("click",async()=>{
      try{ await navigator.clipboard.writeText($("#ex-json").value); toast("Profile copied"); }
      catch(e){ $("#ex-json").select(); toast("Select and copy"); }
    });
    $("#ex-dl").addEventListener("click",async()=>{
      const name = (state.draft.brand||"custom")+"_"+matOf(state.draft)+(state.draft.batch? "_"+state.draft.batch:"")+".json";
      const blob = new Blob([$("#ex-json").value], {type:"application/json"});
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name.replace(/\s+/g,"_");
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
      toast("Downloaded");
    });
  }
}
/* Recompute only the derived figures on the Measured tab, leaving the inputs
   (and the caret) untouched. */
function updateMeasuredReadout(){
  const d = state.draft; if(!d || state.drTab!=="measured") return;
  const ff = spoolFlowFactor(d);
  const pf = paFactorFromMeasurement((d.measured||{}).pa, matOf(d));
  const fEl = $("#mv-factor"), pEl = $("#pa-factor"), tEl = $("#mv-table");
  if(fEl) fEl.innerHTML = ff ? `This spool flows <b>${(ff*100).toFixed(0)}%</b> of nominal for ${esc(MATERIALS[matOf(d)].label)}.` : "";
  if(pEl) pEl.innerHTML = pf ? `Pressure advance runs <b>${(pf*100).toFixed(0)}%</b> of nominal for this material.` : "";
  if(tEl) tEl.innerHTML = predictionTable(d, ff, pf);
}

/* ---- import ---- */
$("#btn-import").addEventListener("click",()=>{
  state.draft = blankSpool(); state.sel = null; state.drTab="core";
  $("#dr-del").style.display="none"; drawer(true);
  $("#dr-body").innerHTML = `
    <fieldset class="fieldset"><legend>Import a Bambu Studio filament profile</legend>
      <p class="hint" style="margin-bottom:10px">Paste the contents of a <span class="mono">.json</span> filament preset, or pick the file. Recognised keys land in the core fields; everything else is preserved on the Advanced tab so nothing is lost on the round trip.</p>
      <input type="file" id="imp-file" accept=".json,application/json" style="margin-bottom:10px">
      <textarea id="imp-text" rows="14" placeholder='{ "type": "filament", "nozzle_temperature": ["220"], ... }'></textarea>
      <div style="margin-top:10px; display:flex; gap:8px"><button class="btn primary" id="imp-go">Import</button></div>
      <div id="imp-msg" class="hint"></div>
    </fieldset>`;
  $("#imp-file").addEventListener("change",e=>{
    const f = e.target.files[0]; if(!f) return;
    const r = new FileReader(); r.onload = ()=>{ $("#imp-text").value = r.result; }; r.readAsText(f);
  });
  $("#imp-go").addEventListener("click",()=>{
    let o; try{ o = JSON.parse($("#imp-text").value); }
    catch(e){ $("#imp-msg").innerHTML = '<span style="color:var(--crit)">That is not valid JSON. Check for a trailing comma.</span>'; return; }
    const val = v => Array.isArray(v)? v[0] : v;
    const s = blankSpool();
    s.brand = val(o.filament_vendor) || "";
    const t = String(val(o.filament_type)||"PLA").toUpperCase();
    s.type = Object.keys(MATERIALS).find(k=>k.toUpperCase()===t) ||
             Object.keys(MATERIALS).find(k=>k.toUpperCase().startsWith(t)) || "PLA";
    s.colorName = (o.name||"").replace(/\[.*?\]/,"").replace(s.brand,"").trim() || "";
    const bm = /\[(.+?)\]/.exec(o.name||""); if(bm) s.batch = bm[1];
    const coreKeys = new Set(BAMBU_KEYS.flatMap(g=>g[1]));
    const meta = new Set(["type","name","from","instantiation","inherits","version","filament_id",
      "filament_settings_id","compatible_printers","filament_vendor","filament_type"]);
    let n=0;
    Object.keys(o).forEach(k=>{
      if(meta.has(k)) return;
      const v = val(o[k]);
      if(coreKeys.has(k)){ s.core[k] = v; } else { s.advanced[k] = v; }
      n++;
    });
    state.draft = s; state.drTab = "core"; renderDrawer();
    toast(`Imported ${n} keys`);
  });
});

/* ---- recommend ---- */
function hotendOptions(sel, printerFilter){
  const list = hotends.filter(h=>!printerFilter || h.printer===printerFilter || BODIES[h.body].printers.includes(printerFilter));
  const cur = sel.value;
  sel.innerHTML = list.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join("");
  if(list.some(h=>h.id===cur)) sel.value = cur;
}
function spoolOptions(sel){
  const cur = sel.value;
  sel.innerHTML = `<option value="">— generic material —</option>` +
    spools.map(s=>`<option value="${s.id}">${esc((s.brand||"?")+" "+(MATERIALS[matOf(s)]||{}).label+" · "+(s.colorName||"")+(s.batch?" ["+s.batch+"]":""))}</option>`).join("");
  if(spools.some(s=>s.id===cur)) sel.value = cur;
}

function renderRecommend(){
  if(state.view!=="recommend") return;
  const sSel=$("#r-spool"), mSel=$("#r-mat"), pSel=$("#r-printer"), hSel=$("#r-hotend");
  spoolOptions(sSel);
  if(!mSel.options.length) mSel.innerHTML = Object.keys(MATERIALS).map(k=>`<option value="${k}">${MATERIALS[k].label}</option>`).join("");
  if(!pSel.options.length) pSel.innerHTML = Object.keys(PRINTERS).map(k=>`<option value="${k}">${PRINTERS[k].name}</option>`).join("");
  hotendOptions(hSel, pSel.value);

  const spool = spools.find(s=>s.id===sSel.value);
  if(spool){ mSel.value = matOf(spool); mSel.disabled = true; } else mSel.disabled = false;
  const h = hotends.find(x=>x.id===hSel.value) || hotends[0];
  if(!h){ $("#rec-out").innerHTML = '<div class="panel"><div class="body empty">Add a hotend combination first.</div></div>'; return; }

  const inp = {
    mat: mSel.value || "PLA", printer: pSel.value, body: h.body, d:+h.nozzle, cls:h.cls, nozMat:h.nozMat,
    goal: $("#r-goal").value, lh:+$("#r-lh").value||0.2, lw:+$("#r-lw").value||0.42,
    path:+$("#r-path").value||900, height:+$("#r-h").value||60,
    flowFactor: spool? (spoolFlowFactor(spool)||1) : 1,
    paFactor: spool? (paFactorFromMeasurement((spool.measured||{}).pa, matOf(spool))||1) : 1
  };
  const issues = validateRecInputs(inp, PRINTERS[inp.printer]);
  paintIssues({fields:{"r-lh":1,"r-lw":1,"r-path":1,"r-h":1}, issues});

  const r = recommend(inp);
  const flagOrder = {crit:0,warn:1,ok:2};
  r.flags.sort((a,b)=>flagOrder[a.lvl]-flagOrder[b.lvl]);

  $("#rec-out").innerHTML = `
  <div class="panel">
    <header><h3>Operating point</h3>
      <span class="pill ${r.ceil.bound==="rating"?"warn":"acc"}">${r.ceil.bound==="rating"?"limited by hotend rating":"limited by melt rate"}</span>
    </header>
    <div class="readout">
      <div class="ro h"><div class="lab">Max flow</div><div class="val">${r.ceil.q.toFixed(1)}<small>mm³/s</small></div><div class="note">ceiling for this combination</div></div>
      <div class="ro"><div class="lab">Set MVS to</div><div class="val">${r.qUse.toFixed(1)}<small>mm³/s</small></div><div class="note">${Math.round(r.g.flowUse*100)}% of ceiling for ${r.g.label.toLowerCase()}</div></div>
      <div class="ro"><div class="lab">Max speed</div><div class="val">${r.vMax.toFixed(0)}<small>mm/s</small></div><div class="note">at ${inp.lw}×${inp.lh} mm</div></div>
      <div class="ro h"><div class="lab">Nozzle</div><div class="val">${r.T}<small>°C</small></div><div class="note">first layer ${r.T1} °C</div></div>
      <div class="ro h"><div class="lab">Bed</div><div class="val">${r.bed}<small>°C</small></div><div class="note">${r.chamber? "chamber "+r.chamber+" °C" : PRINTERS[inp.printer].chamber==="active"? "chamber off" : "no active chamber"}</div></div>
      <div class="ro c"><div class="lab">Fan</div><div class="val">${r.fanMin}–${r.fanMax}<small>%</small></div><div class="note">overhang ${r.m.ohFan}%</div></div>
      <div class="ro"><div class="lab">k factor</div><div class="val">${r.k.toFixed(3)}</div><div class="note">${inp.paFactor!==1?"scaled from your measurement":"starting value"}</div></div>
      <div class="ro"><div class="lab">Retraction</div><div class="val">${r.retract}<small>mm</small></div><div class="note">${r.m.label} on ${r.body.name.split(" ")[0]}</div></div>
    </div>
  </div>

  <div class="grid g2" style="gap:14px; align-items:start">
   <div class="grid" style="gap:14px">
    <div class="panel${state.closed.physics?" closed":""}" data-panel="physics">
      <header><h3>Physics check</h3><button class="collapse" data-c="physics">${state.closed.physics?"Show":"Hide"}</button></header>
      <div class="body"><div class="flags">${r.flags.map(f=>`
        <div class="flag ${f.lvl}"><span class="ic">${f.lvl==="crit"?"!!":f.lvl==="warn"?"!":"✓"}</span>
          <div><b>${esc(f.t)}</b>${esc(f.d)}</div></div>`).join("")}</div>
      </div>
    </div>
    <div class="panel${state.closed.profile?" closed":""}" data-panel="profile">
    <header><h3>Profile values</h3><div style="display:flex; gap:9px; align-items:center; margin-left:auto"><span class="sub">${esc(r.m.label)} · ${esc(h.name)}</span><button class="collapse" data-c="profile">${state.closed.profile?"Show":"Hide"}</button></div></header>
    <div class="tablewrap" style="border:0; border-radius:0">
      <table class="paramtable"><tbody>
        ${[
          ["Nozzle temperature", r.T+" °C", "nozzle_temperature"],
          ["First layer nozzle", r.T1+" °C", "nozzle_temperature_initial_layer"],
          ["Bed (hot plate)", r.bed+" °C", "hot_plate_temp"],
          ["Chamber", r.chamber+" °C", "chamber_temperatures"],
          ["Max volumetric speed", r.qUse.toFixed(1)+" mm³/s", "filament_max_volumetric_speed"],
          ["Flow ratio", r.flowRatio.toFixed(3), "filament_flow_ratio"],
          ["Fan minimum", r.fanMin+" %", "fan_min_speed"],
          ["Fan maximum", r.fanMax+" %", "fan_max_speed"],
          ["Overhang fan", r.m.ohFan+" %", "overhang_fan_speed"],
          ["Overhang threshold", r.m.ohThr, "overhang_fan_threshold"],
          ["Slow-down layer time", r.m.slow+" s", "slow_down_layer_time"],
          ["Retraction length", r.retract+" mm", "filament_retraction_length"],
          ["Required nozzle hardness", "HRC "+r.m.hrc, "required_nozzle_HRC"],
          ["Drying", r.m.dryT+" °C / "+r.m.dryH+" h", "filament_dev_ams_drying_temperature"]
        ].map(([l,v,k])=>`<tr style="cursor:default"><td>${esc(l)}<span class="key">${k}</span></td><td class="mono num">${esc(v)}</td></tr>`).join("")}
      </tbody></table>
    </div>
    </div>
   </div>
   <div class="panel${state.closed.deriv?" closed":""}" data-panel="deriv">
     <header><h3>Derivation</h3><button class="collapse" data-c="deriv">${state.closed.deriv?"Show":"Hide"}</button></header>
     <div class="body"><div class="derive">${derivation(inp,r)}</div></div>
   </div>
  </div>`;
  wireCollapse($("#rec-out"));
  $("#rec-out").querySelectorAll("[data-c]").forEach(()=>{});
}

function wireCollapse(root){
  (root||document).querySelectorAll(".collapse").forEach(b=>{
    if(b.dataset.wired) return; b.dataset.wired="1";
    b.addEventListener("click",e=>{
      e.stopPropagation();
      const k=b.dataset.c; state.closed[k]=!state.closed[k];
      const panel=b.closest(".panel");
      panel.classList.toggle("closed", state.closed[k]);
      b.textContent = state.closed[k] ? "Show" : "Hide";
    });
  });
}

function derivation(inp,r){
  const n=(x,p)=>Number(x).toFixed(p===undefined?2:p);
  const e = expFor(inp.mat, inp.cls);
  const base = BODIES[inp.body].vEff[inp.cls]!==undefined ? BODIES[inp.body].vEff[inp.cls] : BODIES[inp.body].vEff.standard;
  return `<span class="c">— melt-zone volume ————————————————</span>
V_eff = V₀·(D/0.4)^e   <span class="c">e = ${e} · ${inp.mat} ${inp.cls==="highflow"?"HF":"std"}</span>
      = ${n(base,1)}·(${inp.d}/0.4)^${e}
      = <span class="r">${n(r.ceil.vEff,1)} mm³</span>

<span class="c">— flow ceiling ——————————————————</span>
Q_melt = A_${inp.mat}${r.ceil.hf!==1? " · h_hf":""} · V_eff${inp.flowFactor!==1? " · f_spool":""}
       = ${MATERIALS[inp.mat].A}${r.ceil.hf!==1? " · "+n(r.ceil.hf,2):""} · ${n(r.ceil.vEff,1)}${inp.flowFactor!==1? " · "+n(inp.flowFactor,2):""}  =  ${n(r.ceil.melt,1)} mm³/s
Q_rated = ${r.ceil.cap} mm³/s   <span class="c">${esc(BODIES[inp.body].name)}</span>
Q_max  = min(…) = <span class="r">${n(r.ceil.q,1)} mm³/s</span>
         <span class="c">${r.ceil.bound==="melt"?"melt limited":"at the hotend's rating"}</span>

<span class="c">— extrusion geometry ——————————————</span>
A = w·h − h²(1 − π/4)
  = ${inp.lw}·${inp.lh} − ${inp.lh}²(0.2146)  =  ${n(r.area,4)} mm²
v = Q_use/A = ${n(r.qUse,1)}/${n(r.area,4)}  =  <span class="r">${n(r.vMax,0)} mm/s</span>

<span class="c">— heat balance ————————————————</span>
P = Q·ρ·(c_p·ΔT + Δh_f)
  = ${n(r.qUse,1)}·${MATERIALS[inp.mat].rho}e-3·(${MATERIALS[inp.mat].cp}·${r.T-AMBIENT}+${MATERIALS[inp.mat].hf})
  = <span class="r">${n(r.power.w,1)} W</span>  <span class="c">of ~${n(r.powerBudget,0)} W usable</span>

<span class="c">— melt residence ——————————————</span>
τ = V_eff/Q = ${n(r.ceil.vEff,1)}/${n(r.qUse,1)}
  = <span class="r">${n(r.residence,2)} s</span>  <span class="c">want > 2 s</span>

<span class="c">— nozzle land, power-law melt ————————</span>
γ̇_w = Q(3n+1)/(π·n·R³)   <span class="c">n = ${MATERIALS[inp.mat].n}</span>
    = <span class="r">${r.press.shear.toExponential(2)} s⁻¹</span>
τ_w = K·γ̇_wⁿ = ${n(r.press.tau/1000,0)} kPa
ΔP  = 2·τ_w·L/R = ${n(r.press.dP/1e6,2)} MPa  <span class="c">L = ${LAND} mm</span>
F   = ΔP·A_fil = <span class="r">${n(r.press.force,1)} N</span>  <span class="c">at the land alone</span>

<span class="c">— cooling ——————————————————</span>
t_layer = path/v = ${inp.path}/${n(r.vMax,0)}
        = <span class="r">${n(r.layerTime,1)} s</span>  <span class="c">threshold ${r.m.slow} s</span>`;
}
$("#btn-savecfg").addEventListener("click",()=>{
  const h = hotends.find(x=>x.id===$("#r-hotend").value) || hotends[0];
  const sp = spools.find(x=>x.id===$("#r-spool").value);
  const mat = sp ? matOf(sp) : $("#r-mat").value;
  const auto = `${sp? (sp.brand+" "+(sp.colorName||"")).trim() : MATERIALS[mat].label} · ${h? h.name : "?"} · ${GOALS[$("#r-goal").value].label}`;
  const name = prompt("Name this configuration", auto);
  if(name===null) return;
  saveConfig({ name:name.trim()||auto, spool:$("#r-spool").value||"", mat, printer:$("#r-printer").value,
    hotend:h?h.id:"", goal:$("#r-goal").value, lh:+$("#r-lh").value, lw:+$("#r-lw").value,
    path:+$("#r-path").value, height:+$("#r-h").value, created:new Date().toISOString() });
  state.cmpSel.add("pending");
});

["#r-spool","#r-mat","#r-printer","#r-hotend","#r-goal","#r-lh","#r-lw","#r-path","#r-h"].forEach(s=>{
  $(s).addEventListener("input",renderRecommend); $(s).addEventListener("change",renderRecommend);
});

/* ---- diagnose ---- */
function renderDiagnose(){
  if(state.view!=="diagnose") return;
  spoolOptions($("#d-spool"));
  if(!$("#d-printer").options.length) $("#d-printer").innerHTML = Object.keys(PRINTERS).map(k=>`<option value="${k}">${PRINTERS[k].name}</option>`).join("");
  hotendOptions($("#d-hotend"), $("#d-printer").value);

  $("#symptoms").innerHTML = SYMPTOMS.map(s=>
    `<button class="symptom" data-s="${s.id}" aria-pressed="${state.symptoms.has(s.id)}">${esc(s.label)}<em>${esc(s.hint)}</em></button>`).join("");
  $("#symptoms").querySelectorAll(".symptom").forEach(b=>b.addEventListener("click",()=>{
    const id=b.dataset.s; state.symptoms.has(id)? state.symptoms.delete(id) : state.symptoms.add(id);
    renderDiagnose();
  }));
  $("#d-count").textContent = state.symptoms.size ? `${state.symptoms.size} selected` : "select one or more";

  const out = $("#diag-out");
  if(!state.symptoms.size){ out.innerHTML = `<div class="panel"><div class="body empty">Pick what you are seeing. Selecting more than one symptom sharpens the ranking — moisture and nozzle wear each produce a recognisable cluster.</div></div>`; return; }

  const spool = spools.find(s=>s.id===$("#d-spool").value);
  const h = hotends.find(x=>x.id===$("#d-hotend").value) || hotends[0];
  const matKey = spool? matOf(spool) : "PLA";
  const m = MATERIALS[matKey];
  const onset = $("#d-onset").value;
  const hygroSet = ["PA","PA-CF","PPA-CF","PET-CF","PETG","PETG-CF","PC","PC-CF","PVA","TPU-95A","TPU-85A","PPS-CF"];
  const isHygro = hygroSet.includes(matKey);
  const wear = h ? (h.kg||0)/NOZZLE_MATS[h.nozMat].wearKg : 0;

  const agg = new Map();
  state.symptoms.forEach(sid=>{
    const sy = SYMPTOMS.find(x=>x.id===sid); if(!sy) return;
    sy.causes.forEach(c=>{
      let w = c.w;
      if(c.hygro) w *= isHygro ? 1.35 : 0.75;
      if(c.abrasive) w *= m.abr ? 1.3 : 0.7;
      if(c.abrasive && wear>0.8) w *= 1.4;
      if(c.needsChamber) w *= (h && PRINTERS[h.printer].chamber!=="active" && m.cham>0) ? 1.4 : (m.cham>0?1.0:0.4);
      if(c.mech) w *= 0.55;
      if(c.multi) w *= (h && h.printer==="h2c") ? 1.3 : 0.6;
      if(c.drift) w *= onset==="drift" ? 1.45 : onset==="sudden" ? 0.7 : 1;
      if(c.sudden) w *= onset==="sudden" ? 1.4 : 0.85;
      if(onset==="new" && (c.drift||c.sudden)) w *= 0.6;
      const key = c.t;
      const prev = agg.get(key);
      if(prev){ prev.w += w*0.75; prev.from.push(sy.label); }
      else agg.set(key, {c, w, from:[sy.label]});
    });
  });
  const ranked = [...agg.values()].sort((a,b)=>b.w-a.w).slice(0,8);
  const top = ranked[0] ? ranked[0].w : 1;

  const ctx = [];
  if(spool) ctx.push(`${spool.brand||"spool"} ${m.label}${spool.batch? " batch "+spool.batch:""}`);
  else ctx.push(`generic ${m.label}`);
  if(h) ctx.push(`${h.name}`);
  if(h && wear>0.8) ctx.push(`nozzle at ${(wear*100).toFixed(0)}% of expected life`);
  if(isHygro) ctx.push("hygroscopic grade");

  out.innerHTML = `
  <div class="panel" style="margin-bottom:14px">
    <header><h3>Ranked causes</h3><span class="sub">${esc(ctx.join(" · "))}</span></header>
    <div class="body" style="padding-top:4px">
      <p class="hint" style="margin:6px 0 14px">Ranking is weighted by material, hotend, nozzle wear and onset pattern — not a fixed list. Work down it; each entry names the test that confirms or clears it.</p>
      ${ranked.map((r,i)=>`
      <div class="cause">
        <div class="ch">
          <span class="rank">${i+1}</span>
          <div style="flex:1">
            <h4>${esc(r.c.t)}</h4>
            <p>${esc(r.c.why)}</p>
            ${r.from.length>1? `<p class="sub" style="margin-top:5px">Explains: ${esc(r.from.join(", "))}</p>`:""}
          </div>
          <div class="conf"><span class="sub">${Math.round(r.w/top*100)}%</span><div class="bar"><i style="width:${Math.round(r.w/top*100)}%"></i></div></div>
        </div>
        <div class="cb">
          <div class="fixlist">${r.c.fixes.map(([k,d,t])=>`<div class="fix"><span class="d ${k}">${esc(d)}</span><span>${esc(t)}</span></div>`).join("")}</div>
          <div class="next"><b>Next step</b>${esc(r.c.next)}</div>
        </div>
      </div>`).join("")}
    </div>
  </div>`;
}
["#d-spool","#d-printer","#d-hotend","#d-onset"].forEach(s=>$(s).addEventListener("change",renderDiagnose));

/* ---- parts + history wiring ---- */
$("#pq").addEventListener("input",renderParts);
$("#btn-addpart").addEventListener("click",newPart);
["#hq","#h-kind"].forEach(x=>$(x).addEventListener("input",renderHistory));
$("#h-kind").addEventListener("change",renderHistory);
$("#btn-verify").addEventListener("click",()=>{
  const pan = $("#verify-panel");
  pan.style.display = pan.style.display==="none" ? "" : "none";
  if(pan.style.display==="") $("#verify-out").innerHTML = "";
});
$("#verify-close").addEventListener("click",()=>{ $("#verify-panel").style.display="none"; });
$("#verify-pick").addEventListener("click",()=>$("#verify-file").click());
$("#verify-file").addEventListener("change",e=>{ if(e.target.files[0]) verifyFile(e.target.files[0]); });
(function(){
  const d = $("#verify-drop");
  ["dragenter","dragover"].forEach(ev=>d.addEventListener(ev,e=>{ e.preventDefault(); d.classList.add("over"); }));
  ["dragleave","drop"].forEach(ev=>d.addEventListener(ev,e=>{ e.preventDefault(); d.classList.remove("over"); }));
  d.addEventListener("drop",e=>{ const f=e.dataTransfer.files[0]; if(f) verifyFile(f); });
})();

/* ---- compare ---- */
function configInputs(c){
  const h = hotends.find(x=>x.id===c.hotend) || hotends[0];
  const sp = spools.find(x=>x.id===c.spool);
  const mat = sp ? matOf(sp) : (MATERIALS[c.mat]? c.mat : "PLA");
  if(!h) return null;
  return { cfg:c, spool:sp, hot:h, inp:{
    mat, printer: PRINTERS[c.printer]? c.printer : "x1c", body:h.body, d:+h.nozzle, cls:h.cls, nozMat:h.nozMat,
    goal: GOALS[c.goal]? c.goal : "balanced", lh:+c.lh||0.2, lw:+c.lw||0.42, path:+c.path||900, height:+c.height||60,
    flowFactor: sp? (spoolFlowFactor(sp)||1) : 1,
    paFactor: sp? (paFactorFromMeasurement((sp.measured||{}).pa, matOf(sp))||1) : 1 }};
}

function renderCompare(){
  if(state.view!=="compare") return;
  $("#cmp-count").textContent = configs.length ? `${state.cmpSel.size} of ${configs.length} selected` : "";
  state.cmpSel.delete("pending");
  $("#cmp-chips").innerHTML = configs.length
    ? configs.map(c=>`<button class="chip" data-cfg="${c.id}" aria-pressed="${state.cmpSel.has(c.id)}">${esc(c.name)}</button>`).join("")
      + `<button class="btn ghost sm" id="cmp-clear">Clear selection</button>`
    : `<p class="sub" style="margin:0">No configurations yet. Build one on the Recommend tab and use <b>Save as configuration</b> — the inputs are stored, and every value here is recomputed live from them.</p>`;
  $("#cmp-chips").querySelectorAll("[data-cfg]").forEach(b=>b.addEventListener("click",()=>{
    const id=b.dataset.cfg;
    if(state.cmpSel.has(id)) state.cmpSel.delete(id);
    else { if(state.cmpSel.size>=4){ toast("Four columns is the limit — deselect one first"); return; } state.cmpSel.add(id); }
    renderCompare();
  }));
  if($("#cmp-clear")) $("#cmp-clear").addEventListener("click",()=>{ state.cmpSel.clear(); renderCompare(); });

  const picked = configs.filter(c=>state.cmpSel.has(c.id)).map(configInputs).filter(Boolean);
  const out = $("#cmp-out");
  if(picked.length<1){ out.innerHTML = `<div class="panel"><div class="body empty">Select one or more configurations above. With two or more, every row where they disagree is highlighted.</div></div>`; return; }

  const res = picked.map(x=>({x, r:recommend(x.inp)}));
  const ROWS = [
    ["Setup", null],
    ["Material", d=>MATERIALS[d.x.inp.mat].label],
    ["Spool", d=>d.x.spool? ((d.x.spool.brand||"")+" "+(d.x.spool.colorName||"")).trim()+(d.x.spool.batch?" ["+d.x.spool.batch+"]":"") : "generic"],
    ["Quality rating", d=>d.x.spool&&d.x.spool.rating? d.x.spool.rating+"/7" : "—"],
    ["Printer", d=>PRINTERS[d.x.inp.printer].name],
    ["Hotend / nozzle", d=>d.x.hot.name],
    ["Goal", d=>d.r.g.label],
    ["Layer × width", d=>d.x.inp.lh+" × "+d.x.inp.lw+" mm"],
    ["Flow", null],
    ["Melt volume V_eff", d=>d.r.ceil.vEff.toFixed(1)+" mm³"],
    ["Flow ceiling", d=>d.r.ceil.q.toFixed(1)+" mm³/s"],
    ["Limited by", d=>d.r.ceil.bound==="melt"?"melt rate":"hotend rating"],
    ["Max volumetric speed", d=>d.r.qUse.toFixed(1)+" mm³/s"],
    ["Max print speed", d=>d.r.vMax.toFixed(0)+" mm/s"],
    ["Temperature", null],
    ["Nozzle", d=>d.r.T+" °C"],
    ["First layer nozzle", d=>d.r.T1+" °C"],
    ["Bed", d=>d.r.bed+" °C"],
    ["Chamber", d=>d.r.chamber+" °C"],
    ["Cooling & motion", null],
    ["Fan", d=>d.r.fanMin+"–"+d.r.fanMax+" %"],
    ["Overhang fan", d=>d.r.m.ohFan+" %"],
    ["Slow-down layer time", d=>d.r.m.slow+" s"],
    ["Layer time at speed", d=>d.r.layerTime.toFixed(1)+" s"],
    ["k factor", d=>d.r.k.toFixed(3)],
    ["Retraction", d=>d.r.retract+" mm"],
    ["Flow ratio", d=>d.r.flowRatio.toFixed(3)],
    ["Physics", null],
    ["Heater power", d=>d.r.power.w.toFixed(1)+" W"],
    ["Melt residence", d=>d.r.residence.toFixed(2)+" s"],
    ["Extruder force", d=>d.r.press.force.toFixed(1)+" N"],
    ["Nozzle pressure", d=>(d.r.press.dP/1e6).toFixed(2)+" MPa"],
    ["Warnings", d=>{const n=d.r.flags.filter(f=>f.lvl!=="ok").length; return n? n+" open":"none";}]
  ];

  out.innerHTML = `
  <div class="panel">
    <header><h3>Side by side</h3><span class="sub">recomputed live — cells differing from the first column are marked</span></header>
    <div class="tablewrap" style="border:0; border-radius:0">
      <table class="cmptable" style="min-width:${260+res.length*180}px"><thead><tr>
        <th style="width:220px">Parameter</th>
        ${res.map(d=>`<th class="cfg">${esc(d.x.cfg.name)}</th>`).join("")}
      </tr></thead><tbody>
      ${ROWS.map(([label,fn])=>{
        if(!fn) return `<tr class="grp"><td colspan="${res.length+1}">${esc(label)}</td></tr>`;
        const vals = res.map(fn);
        return `<tr style="cursor:default"><td>${esc(label)}</td>${vals.map((v,i)=>
          `<td class="v ${i===0?"base":(v!==vals[0]?"diff":"")}">${esc(v)}</td>`).join("")}</tr>`;
      }).join("")}
      </tbody></table>
    </div>
    <div class="body" style="border-top:1px solid var(--line); display:flex; gap:8px; flex-wrap:wrap">
      ${res.map(d=>`<button class="btn ghost sm" data-del="${d.x.cfg.id}">Delete “${esc(d.x.cfg.name)}”</button>`).join("")}
    </div>
  </div>`;
  out.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>delConfig(b.dataset.del)));
}

/* ---- hotends ---- */
function renderHotends(){
  if(state.view!=="hotends") return;
  const wrap = $("#hot-list");
  wrap.innerHTML = hotends.map(h=>{
    const b = BODIES[h.body], nm = NOZZLE_MATS[h.nozMat], v = vEffFor(h.body,+h.nozzle,h.cls,"PLA");
    const wear = (h.kg||0)/nm.wearKg;
    const wl = wear>1? "crit" : wear>0.7? "warn" : "ok";
    const flows = ["PLA","PETG","ABS","PA-CF"].map(k=>{
      const c = flowCeiling(h.body,+h.nozzle,h.cls,k,1);
      return `<div class="ro"><div class="lab">${MATERIALS[k].label}</div><div class="val">${c.q.toFixed(1)}<small>mm³/s</small></div><div class="note">${c.bound==="rating"?"hotend rated":"melt limited"}</div></div>`;
    }).join("");
    return `<div class="panel" data-h="${h.id}">
      <header>
        <h3 style="text-transform:none; letter-spacing:0; font-size:14px; color:var(--ink)">${esc(h.name)}</h3>
        <div style="display:flex; gap:7px; align-items:center; flex-wrap:wrap">
          <span class="pill">${esc(b.name)}</span>
          <span class="pill acc">Ø${h.nozzle} ${NOZZLE_CLASS[h.cls].label.toLowerCase()}</span>
          <span class="pill">${esc(nm.label)}</span>
          <span class="pill ${wl}">${(h.kg||0)} kg · ${Math.round(wear*100)}% of life</span>
          <button class="btn ghost sm" data-edit="${h.id}">Edit</button>
        </div>
      </header>
      <div class="readout">
        <div class="ro"><div class="lab">Melt volume</div><div class="val">${v.toFixed(0)}<small>mm³</small></div><div class="note">V_eff, PLA basis</div></div>
        ${flows}
        <div class="ro"><div class="lab">Rated cap</div><div class="val">${b.cap}<small>mm³/s</small></div><div class="note">${esc(b.anchor)}</div></div>
      </div>
      <div class="body" style="padding-top:11px; padding-bottom:11px">
        <div class="grid g3" style="gap:11px; align-items:end">
          <label class="f"><span>Filament through kg</span><input type="number" step="0.05" data-kg="${h.id}" value="${h.kg||0}"></label>
          <label class="f" style="grid-column:span 2"><span>Notes</span><input type="text" data-note="${h.id}" value="${esc(h.notes||"")}" placeholder="Core, tip supplier, install date…"></label>
        </div>
        ${wear>0.7? `<p class="hint" style="color:var(--${wear>1?"crit":"warn"})">${wear>1? "Past the expected bore life for this nozzle material. Measure a single-wall cube before trusting dimensional work." : "Approaching the expected bore life. Schedule a replacement and log a single-wall measurement now as a baseline."}</p>`:""}
      </div>
    </div>`;
  }).join("");
  wrap.querySelectorAll("[data-kg]").forEach(el=>el.addEventListener("change",()=>{
    const h = hotends.find(x=>x.id===el.dataset.kg); h.kg = parseFloat(el.value)||0; saveHotend(h);
  }));
  wrap.querySelectorAll("[data-note]").forEach(el=>el.addEventListener("change",()=>{
    const h = hotends.find(x=>x.id===el.dataset.note); h.notes = el.value; saveHotend(h);
  }));
  wrap.querySelectorAll("[data-edit]").forEach(el=>el.addEventListener("click",()=>editHotend(el.dataset.edit)));
}
$("#btn-addhot").addEventListener("click",()=>editHotend(null));

function editHotend(id){
  state.mode = "spool"; state.part = null;
  const h = id ? Object.assign({}, hotends.find(x=>x.id===id))
    : { name:"", body:"revo", printer:"x1c", nozzle:0.4, cls:"standard", nozMat:"hardened", kg:0, notes:"" };
  state.sel = null; drawer(true);
  $("#dr-title").textContent = id? "Edit combination" : "New hotend / nozzle combination";
  $("#dr-tabs").innerHTML = "";
  $("#dr-del").style.display = id ? "" : "none";
  $("#dr-body").innerHTML = `
    <fieldset class="fieldset"><legend>Combination</legend>
      <div class="grid g2">
        <label class="f" style="grid-column:span 2"><span>Name</span><input type="text" id="h-name" value="${esc(h.name)}" placeholder="H2S · 0.6 high-flow hardened"></label>
        <label class="f"><span>Hotend body</span><select id="h-body">${Object.keys(BODIES).map(k=>`<option value="${k}"${k===h.body?" selected":""}>${BODIES[k].name}</option>`).join("")}</select></label>
        <label class="f"><span>Printer</span><select id="h-printer">${Object.keys(PRINTERS).map(k=>`<option value="${k}"${k===h.printer?" selected":""}>${PRINTERS[k].name}</option>`).join("")}</select></label>
        <label class="f"><span>Nozzle Ø mm</span><select id="h-noz">${[0.2,0.4,0.6,0.8].map(d=>`<option value="${d}"${+h.nozzle===d?" selected":""}>${d.toFixed(1)}</option>`).join("")}</select></label>
        <label class="f"><span>Nozzle class</span><select id="h-cls">${Object.keys(NOZZLE_CLASS).map(k=>`<option value="${k}"${k===h.cls?" selected":""}>${NOZZLE_CLASS[k].label}</option>`).join("")}</select></label>
        <label class="f"><span>Nozzle material</span><select id="h-mat">${Object.keys(NOZZLE_MATS).map(k=>`<option value="${k}"${k===h.nozMat?" selected":""}>${NOZZLE_MATS[k].label}</option>`).join("")}</select></label>
        <label class="f"><span>Filament through kg</span><input type="number" step="0.05" id="h-kg" value="${h.kg||0}"></label>
        <label class="f" style="grid-column:span 2"><span>Notes</span><input type="text" id="h-notes" value="${esc(h.notes||"")}"></label>
      </div>
      <p class="hint" style="margin-top:12px">The body sets the effective melt volume; nozzle class sets how that volume scales with diameter — 0.30 for standard geometry, 0.80 for high-flow, both fitted to published flow tables. A high-flow tip in a standard body is still capped by the body's rating.</p>
      <div id="h-preview" style="margin-top:14px"></div>
    </fieldset>`;
  const preview = ()=>{
    const b=$("#h-body").value, d=+$("#h-noz").value, c=$("#h-cls").value;
    const v = vEffFor(b,d,c,"PLA"), q = flowCeiling(b,d,c,"PLA",1);
    $("#h-preview").innerHTML = `<div class="derive">V_eff = ${v.toFixed(1)} mm³   →   PLA ceiling ${q.q.toFixed(1)} mm³/s  [${q.bound==="melt"?"melt limited":"hotend rated"}]</div>`;
  };
  ["#h-body","#h-noz","#h-cls"].forEach(s=>$(s).addEventListener("change",preview)); preview();
  const kg = $("#h-kg");
  const checkKg = ()=>{
    const v = parseFloat(kg.value);
    const life = NOZZLE_MATS[$("#h-mat").value].wearKg;
    let issue = null;
    if(kg.value!=="" && (isNaN(v) || v < 0)) issue = {lvl:"crit", msg:"Filament through cannot be negative."};
    else if(v > life*1.5) issue = {lvl:"crit", msg:`Well past the ~${life} kg bore life of a ${NOZZLE_MATS[$("#h-mat").value].label.toLowerCase()} nozzle. Measure a single-wall cube before trusting any dimensional work through it.`};
    else if(v > life*0.7) issue = {lvl:"warn", msg:`Approaching the ~${life} kg bore life for this nozzle material — schedule a replacement.`};
    paintIssues({fields:{"h-kg":1}, issues:{"h-kg":issue}});
  };
  kg.addEventListener("input",checkKg); $("#h-mat").addEventListener("change",checkKg); checkKg();
  $("#dr-save").onclick = async ()=>{
    const o = { id:h.id, name:$("#h-name").value || `${PRINTERS[$("#h-printer").value].short} · ${(+$("#h-noz").value).toFixed(1)} ${NOZZLE_CLASS[$("#h-cls").value].label.toLowerCase()}`,
      body:$("#h-body").value, printer:$("#h-printer").value, nozzle:+$("#h-noz").value, cls:$("#h-cls").value,
      nozMat:$("#h-mat").value, kg:parseFloat($("#h-kg").value)||0, notes:$("#h-notes").value };
    await saveHotend(o); drawer(false); resetSaveHandler();
  };
  $("#dr-del").onclick = async ()=>{ if(h.id){ await delHotend(h.id); } drawer(false); resetSaveHandler(); };
}
function resetSaveHandler(){
  $("#dr-save").onclick = async()=>{
    const key = state.draftKey;
    const body = Object.assign({}, state.draft);
    delete body._pending; delete body._started;
    if(!state.sel) delete body.id;               // a pending draft mints a real id on save
    await saveSpool(body);
    if(key) dropDraft(key);
    state.draftKey = null;
    drawer(false);
  };
  $("#dr-del").onclick = async()=>{
    if(state.sel){ await delSpool(state.sel); if(state.draftKey) dropDraft(state.draftKey); state.draftKey=null; drawer(false); }
  };
  $("#dr-discard").onclick = ()=>{
    const key = state.draftKey; if(!key) return;
    const wasPending = drafts[key] && drafts[key]._pending;
    dropDraft(key);
    if(wasPending || !spools.find(x=>x.id===key)){ state.draftKey=null; drawer(false); toast("Draft discarded"); }
    else { openSpool(key); toast("Reverted to the saved values"); }
    updateDraftChrome();
  };
}

/* ---- reference ---- */
function renderReference(){
  if(state.view!=="reference") return;
  const rows = Object.keys(MATERIALS).map(k=>{
    const m = MATERIALS[k];
    return `<tr style="cursor:default"><td>${esc(m.label)}</td><td class="mono num">${m.A}</td><td class="mono num">${m.eS} / ${m.eH}</td><td class="mono num">${m.t}</td>
      <td class="mono num">${m.tlo}–${m.thi}</td><td class="mono num">${m.bed}</td><td class="mono num">${m.cham||"—"}</td>
      <td class="mono num">${m.tg}</td><td class="mono num">${m.rho}</td><td class="mono num">${m.fanMin}–${m.fanMax}</td>
      <td class="mono num">${m.dryT}/${m.dryH}h</td><td>${m.abr? '<span class="pill warn">HRC '+m.hrc+'</span>':'<span class="sub">—</span>'}</td></tr>`;
  }).join("");

  // validation chart: model vs E3D published Revo figures
  const obs = [
    {m:"PLA",  c:"standard", pts:[[0.4,13],[0.6,14],[0.8,17]]},
    {m:"PLA",  c:"highflow", pts:[[0.4,16],[0.6,22],[0.8,28]]},
    {m:"PETG", c:"standard", pts:[[0.4,17],[0.6,18],[0.8,20]]},
    {m:"PETG", c:"highflow", pts:[[0.4,27],[0.6,31],[0.8,38]]}
  ];
  const W=560,H=260,PADL=44,PADB=34,PADT=14,PADR=12;
  const xs = d => PADL + (d-0.2)/(0.8-0.2)*(W-PADL-PADR);
  const ys = q => H-PADB - (q/40)*(H-PADB-PADT);
  let marks="";
  const colors={standard:"var(--cool)",highflow:"var(--heat)"};
  obs.forEach(o=>{
    const modelPts=[0.4,0.6,0.8].map(d=>[d, flowCeiling("revo",d,o.c,o.m,1).q]);
    marks += `<polyline points="${modelPts.map(p=>xs(p[0])+","+ys(p[1])).join(" ")}" fill="none" stroke="${colors[o.c]}" stroke-width="1.6" ${o.m==="PETG"?'stroke-dasharray="5 3"':""}/>`;
    marks += o.pts.map(p=>`<circle cx="${xs(p[0])}" cy="${ys(p[1])}" r="3.4" fill="var(--surface)" stroke="${colors[o.c]}" stroke-width="1.6"/>`).join("");
  });
  let grid="";
  [0,10,20,30,40].forEach(q=>{ grid += `<line x1="${PADL}" y1="${ys(q)}" x2="${W-PADR}" y2="${ys(q)}" stroke="var(--line)" stroke-width="1"/>
    <text x="${PADL-8}" y="${ys(q)+4}" text-anchor="end" font-size="10" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${q}</text>`; });
  [0.2,0.4,0.6,0.8].forEach(d=>{ grid += `<text x="${xs(d)}" y="${H-PADB+16}" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${d.toFixed(1)}</text>`; });

  $("#ref-out").innerHTML = `
  <div class="grid g2" style="gap:14px; align-items:start">
    <div class="panel">
      <header><h3>The model</h3></header>
      <div class="body">
        <div class="formula"><h4>Flow ceiling is a melt-rate problem, not an orifice problem</h4>
          <p>Standard nozzles barely gain flow as they get bigger — E3D's own figures go 13 → 14 → 17 mm³/s from 0.4 to 0.8 mm in PLA. High-flow nozzles nearly double over the same range. That difference is not the hole; it is the melt zone. So the model carries one physical parameter per hotend, an effective melt volume, and scales it by nozzle class.</p>
          <div class="derive">V_eff = V₀·(D/0.4)^e        e is per material and nozzle class
Q_melt = A_material · h_hf · V_eff
Q_max  = min(Q_melt, hotend rating)</div>
          <p>The exponent is not universal. PLA gains strongly with bore size (e ≈ 0.39 standard, 0.82 high flow) because its ceiling is set by conduction and latent heat. ASA barely gains at all (0.18 / 0.38) because its ceiling is set by viscosity, which a bigger hole does not fix. That single difference is what makes a 0.8 mm nozzle worth fitting for PLA and nearly pointless for ASA.</p></div>
        <div class="formula"><h4>Three independent checks on the operating point</h4>
          <p>The ceiling says what the hotend can deliver. These say whether the rest of the system agrees.</p>
          <div class="derive">P = Q·ρ·(c_p·ΔT + Δh_f)      heater power against budget
τ = V_eff/Q                  melt residence, want > 2 s
γ̇ = Q(3n+1)/(π·n·R³)        wall shear at the land
ΔP = 2·K·γ̇ⁿ·L/R  →  F = ΔP·A_fil   extruder force</div>
          <p>The pressure term uses a power-law melt rather than a Newtonian one, because polymer melts shear-thin by an order of magnitude across the rates a nozzle sees. It is why TPU needs a tenth of PLA's flow at the same extruder force.</p></div>
        <div class="formula"><h4>One measurement transfers to every combination</h4>
          <p>Measure maximum flow once on any hotend and nozzle, and the ratio to nominal becomes a property of the spool. It then rides through the melt-volume scaling to every other combination in the Hotends tab — which is why the Measured tab shows a full prediction table after a single entry. Pressure advance transfers the same way, scaling inversely with nozzle diameter and with melt-zone compliance.</p></div>
      </div>
    </div>
    <div class="panel">
      <header><h3>Model against published data</h3><span class="sub">E3D Revo, lines are the model</span></header>
      <div class="body">
        <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Modelled flow ceiling against E3D's published Revo figures">
          ${grid}
          <line x1="${PADL}" y1="${PADT}" x2="${PADL}" y2="${H-PADB}" stroke="var(--line-strong)" stroke-width="1"/>
          <line x1="${PADL}" y1="${H-PADB}" x2="${W-PADR}" y2="${H-PADB}" stroke="var(--line-strong)" stroke-width="1"/>
          ${marks}
          <text x="${PADL}" y="${PADT+2}" font-size="10" fill="var(--muted)" font-family="IBM Plex Mono, monospace">mm³/s</text>
          <text x="${W-PADR}" y="${H-4}" text-anchor="end" font-size="10" fill="var(--muted)" font-family="IBM Plex Mono, monospace">nozzle Ø mm</text>
        </svg>
        <div class="legend">
          <span><i style="background:var(--cool)"></i>standard nozzle</span>
          <span><i style="background:var(--heat)"></i>high flow</span>
          <span>solid PLA · dashed PETG · circles are E3D's measurements</span>
        </div>
        <p class="hint">Anchored on the 0.4 mm figure for each material and class, the model reproduces all 18 of E3D's published Revo values within 8.8%, and 22 of 22 checks against E3D and Bambu together within 10%. The Bambu case is a genuine out-of-sample test: H2S 0.4 at 25 mm³/s and 0.4 high-flow at 35 predict 48 mm³/s for a 0.6 high-flow tip, which the standard hotend's 40 mm³/s rating clips to exactly the 40 Bambu publishes. Everything past 0.8 mm, and every filled grade, is extrapolation — measure it and record it.</p>
      </div>
    </div>
  </div>

  <div class="panel">
    <header><h3>Quality scale</h3>
      <div style="display:flex; gap:9px; align-items:center">
        <button class="hintbtn" data-hint="rating" data-slot="hint-scale" aria-expanded="false" aria-label="About the scale">?</button>
        <button class="btn sm" id="scale-reset">Restore defaults</button>
        <button class="btn primary sm" id="scale-save">Save scale</button>
      </div>
    </header>
    <div class="body">
      <div id="hint-scale"></div>
      <p class="hint" style="margin:0 0 13px">Seven steps. Rewrite each one so it describes an outcome your shop actually distinguishes — the wording shows on every spool's stars and in the comparison table.</p>
      ${SCALE.map((t,i)=>`<div class="scalerow">
        <span class="n">${"★".repeat(i+1)}<span style="color:var(--line-strong)">${"☆".repeat(6-i)}</span></span>
        <input type="text" data-scale="${i}" value="${esc(t)}">
      </div>`).join("")}
    </div>
  </div>

  <div class="panel">
    <header><h3>Machines</h3></header>
    <div class="tablewrap" style="border:0"><table style="min-width:760px"><thead><tr>
      <th>Printer</th><th>Build mm</th><th>Nozzle max</th><th>Bed max</th><th>Chamber</th><th>Notes</th></tr></thead><tbody>
      ${Object.keys(PRINTERS).map(k=>{const p=PRINTERS[k];return `<tr style="cursor:default"><td><b>${esc(p.name)}</b></td>
        <td class="mono num">${p.build.join(" × ")}</td><td class="mono num">${p.maxNozzleT} °C</td>
        <td class="mono num">${p.maxBedT} °C</td>
        <td>${p.chamber==="active"? `<span class="pill heat">active to ${p.maxChamber} °C</span>`:'<span class="pill">passive</span>'}</td>
        <td class="sub">${esc(p.note)}</td></tr>`;}).join("")}
    </tbody></table></div>
  </div>

  <div class="panel">
    <header><h3>Material constants</h3><span class="sub">A = melt coefficient · Tg = vitrification</span></header>
    <div class="tablewrap" style="border:0"><table style="min-width:900px"><thead><tr>
      <th>Material</th><th>A s⁻¹</th><th>e std / hf</th><th>Nozzle °C</th><th>Range</th><th>Bed °C</th><th>Chamber °C</th>
      <th>Tg °C</th><th>ρ g/cm³</th><th>Fan %</th><th>Drying</th><th>Nozzle</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="body" style="border-top:1px solid var(--line)">
      <p class="srcs">Machine figures from Bambu Lab's published specifications for the
      <a href="https://bambulab.com/en-us/h2s/tech-specs">H2S</a> and <a href="https://bambulab.com/en/h2c/specs">H2C</a>,
      the <a href="https://public-cdn.bambulab.com/store/bambulab-X1-carbon-tech-specs.pdf">X1&nbsp;Carbon spec sheet</a>, and the
      <a href="https://wiki.bambulab.com/en/knowledge-sharing/volumetric-speed">volumetric-speed wiki page</a>.
      Nozzle flow calibration from <a href="https://e3d-online.com/blogs/news/revo-high-flow">E3D's Revo High Flow figures</a>.
      Profile key names are taken from the filament presets shipped in the BambuStudio repository.
      Material constants are typical values for the polymer family — measure your own and store them against the batch.
      Bambu Studio preset export and import paths follow Bambu Lab's own documentation.</p>
    </div>
  </div>`;
  $("#ref-out").querySelectorAll("[data-scale]").forEach(el=>el.addEventListener("input",()=>{
    SCALE[+el.dataset.scale] = el.value;
  }));
  $("#scale-save").addEventListener("click",saveScale);
  $("#scale-reset").addEventListener("click",()=>{ SCALE = SCALE_DEFAULT.slice(); renderReference(); saveScale(); });
}

/* ==========================================================================
   PARTS  -  reading and filing happen on the server (app.py), which unzips
   the 3MF, measures the mesh, renders the thumbnail and writes the file into
   the library folder. The client only uploads and displays.
   ========================================================================== */
const SETTINGS_HIGHLIGHT = [
  ["layer_height","Layer height","mm"], ["initial_layer_print_height","First layer","mm"],
  ["line_width","Line width","mm"], ["wall_loops","Wall loops",""],
  ["sparse_infill_density","Infill",""], ["sparse_infill_pattern","Infill pattern",""],
  ["top_shell_layers","Top layers",""], ["bottom_shell_layers","Bottom layers",""],
  ["nozzle_temperature","Nozzle","°C"], ["nozzle_temperature_initial_layer","First layer nozzle","°C"],
  ["hot_plate_temp","Bed","°C"], ["chamber_temperatures","Chamber","°C"],
  ["filament_type","Filament",""], ["filament_settings_id","Filament preset",""],
  ["print_settings_id","Process preset",""], ["printer_settings_id","Printer preset",""],
  ["nozzle_diameter","Nozzle Ø","mm"], ["filament_max_volumetric_speed","Max flow","mm³/s"],
  ["enable_support","Supports",""], ["brim_type","Brim",""],
  ["sparse_infill_speed","Infill speed","mm/s"], ["outer_wall_speed","Outer wall speed","mm/s"]
];
const thumbUrl = v => v && v.thumb ? "/api/thumb/" + v.id + ".png" : null;

/* Which printers can physically take this bounding box. */
function fitsPrinters(bbox){
  if(!bbox) return [];
  return Object.keys(PRINTERS).map(k=>{
    const p = PRINTERS[k];
    const d = [...bbox].sort((a,b)=>b-a), b = [...p.build].sort((a,b)=>b-a);
    return { key:k, name:p.short, fits: d[0]<=b[0] && d[1]<=b[1] && d[2]<=b[2] };
  });
}

/* ---------------------------- parts + prints ---------------------------- */
async function savePart(pt, quiet){
  const id = pt.id || uid(); pt.id = id;
  try{
    const r = await jput("/api/parts/" + id, pt);
    if(r && r.moved) toast("Files moved to " + r.moved);
    else if(!quiet) toast("Part saved");
  }catch(e){ toast("Could not save part: " + e.message); return null; }
  await refresh();
  return id;
}
async function delPart(id){
  try{ await jdel("/api/parts/" + id); }catch(e){ toast("Could not delete"); return; }
  await refresh();
}
async function delVersion(partId, vid){
  try{ await jdel("/api/parts/" + partId + "/versions/" + vid); }catch(e){ return; }
  await refresh();
}
async function loadVersions(partId){ return versions[partId] || []; }
async function savePrint(pr){
  const id = pr.id || uid(); pr.id = id;
  try{ await jput("/api/prints/" + id, pr); }catch(e){ toast("Could not save the print record"); return; }
  await refresh();
}
async function delPrint(id){
  try{ await jdel("/api/prints/" + id); }catch(e){ return; }
  await refresh();
}

/* The server writes the change log, so the client only reads it. */
function historyFor(kind, id){
  const d = history.find(h=>h.id === kind + "_" + id);
  return d ? d.entries || [] : [];
}
function logChange(){ /* server-side */ }

function fmtWhen(iso){
  const d = new Date(iso); if(isNaN(d)) return iso||"";
  const diff = (Date.now() - d.getTime())/1000;
  if(diff < 60) return "just now";
  if(diff < 3600) return Math.floor(diff/60) + " min ago";
  if(diff < 86400) return Math.floor(diff/3600) + " h ago";
  if(diff < 86400*7) return Math.floor(diff/86400) + " d ago";
  return d.toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"});
}
const fmtBytes = b => b==null ? "—" : b>1073741824 ? (b/1073741824).toFixed(1)+" GB"
  : b>1048576 ? (b/1048576).toFixed(1)+" MB" : b>1024 ? Math.round(b/1024)+" kB" : b+" B";
const fmtDur = s => s==null ? "—" : s>=3600 ? Math.floor(s/3600)+" h "+Math.round(s%3600/60)+" m" : Math.round(s/60)+" m";

/* -------------------------------- parts view ---------------------------- */
function partThumb(p){
  const vs = versions[p.id] || [];
  const latest = vs.find(v=>v.thumb);
  return latest ? thumbUrl(latest) : null;
}
function latestVersion(p){
  const vs = (versions[p.id]||[]).slice().sort((a,b)=>(b.uploadedAt||"").localeCompare(a.uploadedAt||""));
  return vs[0] || null;
}
function printsFor(partId){ return prints.filter(pr=>pr.partId===partId)
  .sort((a,b)=>(b.date||"").localeCompare(a.date||"")); }

function renderParts(){
  if(state.view!=="parts") return;
  const q = ($("#pq").value||"").toLowerCase();
  const list = parts.filter(p=>{
    if(!q) return true;
    const vs = (versions[p.id]||[]).map(v=>v.fileName).join(" ");
    return [p.name,p.description,(p.tags||[]).join(" "),vs].join(" ").toLowerCase().includes(q);
  }).sort((a,b)=>(a.name||"").localeCompare(b.name||""));

  $("#pcount").textContent = `${list.length} of ${parts.length} part${parts.length===1?"":"s"} · ${prints.length} print${prints.length===1?"":"s"} logged`;
  const wrap = $("#part-grid");
  if(!list.length){
    wrap.innerHTML = `<div class="panel" style="grid-column:1/-1"><div class="body empty">
      ${parts.length? "No parts match that search." :
        "No parts yet. Drop a 3MF or STL below, or use Add part — a Bambu Studio project file brings its plate render, filament usage, print time and every slicer setting with it."}</div></div>`;
    return;
  }
  wrap.innerHTML = list.map(p=>{
    const v = latestVersion(p), th = partThumb(p), pr = printsFor(p.id);
    const nv = (versions[p.id]||[]).length;
    const dims = v && v.mesh ? v.mesh.bbox.map(x=>x.toFixed(0)).join(" × ")+" mm" : "";
    return `<button class="partcard" data-part="${p.id}">
      <span class="pthumb">${th? `<img src="${th}" alt="">` : `<span class="noimg">no preview</span>`}</span>
      <span class="pmeta">
        <b>${esc(p.name||"Untitled part")}</b>
        <span class="sub">${esc(dims || (v? v.fileName : "no file yet"))}</span>
        <span class="prow">
          ${nv? `<span class="pill acc">v${nv}</span>`:`<span class="pill">no version</span>`}
          ${pr.length? `<span class="pill ok">${pr.length} print${pr.length>1?"s":""}</span>`:""}
          ${(p.tags||[]).slice(0,2).map(t=>`<span class="pill">${esc(t)}</span>`).join("")}
        </span>
      </span>
    </button>`;
  }).join("");
  wrap.querySelectorAll("[data-part]").forEach(b=>b.addEventListener("click",()=>openPart(b.dataset.part)));
}

/* ------------------------------ part drawer ----------------------------- */
const PART_TABS = [["overview","Overview"],["versions","Versions"],["prints","Prints"],["phistory","History"]];

function openPart(id){
  const p = parts.find(x=>x.id===id);
  if(!p) return;
  state.mode = "part"; state.part = JSON.parse(JSON.stringify(p)); state.partTab = "overview";
  drawer(true);
  loadVersions(id).then(()=>renderPartDrawer());
  renderPartDrawer();
}
function newPart(){
  state.mode = "part";
  state.part = { id:null, name:"", description:"", tags:[], category:"", created:new Date().toISOString() };
  state.partTab = "overview";
  drawer(true); renderPartDrawer();
}

function renderPartDrawer(){
  const p = state.part; if(!p) return;
  $("#dr-title").textContent = p.name || "New part";
  $("#dr-draftchip").style.display = "none";
  $("#dr-discard").style.display = "none";
  $("#dr-del").style.display = p.id ? "" : "none";
  $("#dr-del").textContent = "Delete part";
  $("#dr-save").textContent = "Save part";
  $("#dr-tabs").innerHTML = PART_TABS.map(([k,l])=>{
    const n = k==="versions" ? (versions[p.id]||[]).length
            : k==="prints" ? printsFor(p.id).length : 0;
    return `<button class="dtab" data-pt="${k}" aria-selected="${state.partTab===k}">${l}${n?` <span class="sub">${n}</span>`:""}</button>`;
  }).join("");
  $("#dr-tabs").querySelectorAll("[data-pt]").forEach(b=>b.addEventListener("click",()=>{ state.partTab=b.dataset.pt; renderPartDrawer(); }));

  const body = $("#dr-body");
  const f = captureFocus();
  body.innerHTML = state.partTab==="overview" ? partOverview(p)
    : state.partTab==="versions" ? partVersions(p)
    : state.partTab==="prints" ? partPrints(p)
    : partHistory(p);
  wirePartDrawer();
  restoreFocus(f);

  $("#dr-save").onclick = async ()=>{ await savePart(state.part); drawer(false); state.mode="spool"; resetSaveHandler(); };
  $("#dr-del").onclick = async ()=>{
    if(!state.part.id) return;
    if(!confirm("Delete this part, its versions and its print records?")) return;
    for(const v of (versions[state.part.id]||[])) await delVersion(state.part.id, v.id);
    for(const pr of printsFor(state.part.id)) await delPrint(pr.id);
    await delPart(state.part.id);
    drawer(false); state.mode="spool"; resetSaveHandler();
  };
}

function partOverview(p){
  const v = latestVersion(p);
  const fits = v && v.mesh ? fitsPrinters(v.mesh.bbox) : [];
  return `
  <fieldset class="fieldset"><legend>Identification</legend>
    <div class="grid g2">
      <label class="f" style="grid-column:span 2"><span>Part name</span><input type="text" id="pt-name" value="${esc(p.name||"")}" placeholder="Extruder idler bracket"></label>
      <label class="f"><span>Category</span><input type="text" id="pt-cat" value="${esc(p.category||"")}" placeholder="Fixture, spare, tooling…"></label>
      <label class="f"><span>Tags</span><input type="text" id="pt-tags" value="${esc((p.tags||[]).join(", "))}" placeholder="comma separated"></label>
      <label class="f" style="grid-column:span 2"><span>Description</span><textarea id="pt-desc" rows="3" placeholder="What it is, where it goes, what matters about it.">${esc(p.description||"")}</textarea></label>
    </div>
  </fieldset>
  ${p.id ? `<p class="hint" style="margin:-6px 0 16px">Filed at <span class="mono">${esc((p.category||"Uncategorised"))}/${esc(p.name||"part")}/</span> in the library. Renaming the part or changing its category moves the folder.</p>`:""}
  ${v ? `
  <fieldset class="fieldset"><legend>Latest version</legend>
    <div class="vsplit">
      <div class="vthumb">${v.thumb? `<img src="${thumbUrl(v)}" alt="Preview of ${esc(p.name||"part")}" loading="lazy">` : `<span class="noimg">no preview</span>`}</div>
      <div class="readout" style="border:1px solid var(--line); border-radius:var(--r)">
        ${v.mesh ? `
        <div class="ro"><div class="lab">Bounding box</div><div class="val" style="font-size:14px">${v.mesh.bbox.map(x=>x.toFixed(1)).join(" × ")}<small>mm</small></div></div>
        <div class="ro"><div class="lab">Solid volume</div><div class="val" style="font-size:14px">${(v.mesh.volume/1000).toFixed(1)}<small>cm³</small></div></div>
        <div class="ro"><div class="lab">Triangles</div><div class="val" style="font-size:14px">${v.mesh.triangles.toLocaleString()}</div></div>` : ""}
        ${v.slice && v.slice.plates[0] ? `
        <div class="ro"><div class="lab">Sliced time</div><div class="val" style="font-size:14px">${fmtDur(v.slice.plates[0].seconds)}</div></div>
        <div class="ro"><div class="lab">Sliced weight</div><div class="val" style="font-size:14px">${v.slice.plates[0].weightG ?? "—"}<small>g</small></div></div>` : ""}
        <div class="ro"><div class="lab">File</div><div class="val" style="font-size:14px">${esc((v.fileType||"").toUpperCase())}<small>${fmtBytes(v.sizeBytes)}</small></div></div>
      </div>
    </div>
    ${fits.length ? `<div class="fitrow">${fits.map(f=>`<span class="pill ${f.fits?"ok":"crit"}">${f.fits?"fits":"too large for"} ${f.name}</span>`).join("")}</div>` : ""}
  </fieldset>` : `<p class="hint">No file attached yet. Add one on the Versions tab.</p>`}
  <div style="display:flex; gap:8px; flex-wrap:wrap">
    <button class="btn" id="pt-addver">Add a version</button>
    ${p.id? `<button class="btn primary" id="pt-logprint">Log a print</button>`:""}
  </div>`;
}

function partVersions(p){
  const vs = (versions[p.id]||[]).slice().sort((a,b)=>(b.uploadedAt||"").localeCompare(a.uploadedAt||""));
  return `
  <div class="drop" id="pt-drop">
    <b>Drop a 3MF or STL here</b>
    <span class="sub">or <button class="linkbtn" id="pt-pick">choose a file</button></span>
    <input type="file" id="pt-file" accept=".3mf,.stl,model/3mf,model/stl" style="display:none">
    <p class="hint" style="margin:9px 0 0">A Bambu Studio project brings its plate render, filament usage, print time and every slicer key. A plain STL gets a rendered preview, bounding box and solid volume.</p>
  </div>
  <div id="pt-ingest"></div>
  ${vs.length ? vs.map((v,i)=>`
    <div class="verrow">
      <div class="vthumb sm">${v.thumb? `<img src="${thumbUrl(v)}" alt="" loading="lazy">` : `<span class="noimg">—</span>`}</div>
      <div style="flex:1; min-width:0">
        <div class="starrow" style="gap:8px">
          <b>${esc(v.label || ("v"+(vs.length-i)))}</b>
          <span class="pill ${i===0?"acc":""}">${i===0?"latest":"superseded"}</span>
          <span class="sub">${fmtWhen(v.uploadedAt)}</span>
        </div>
        <div class="sub mono" style="word-break:break-all">${esc(v.fileName)} · ${fmtBytes(v.sizeBytes)}</div>
        ${v.mesh? `<div class="sub">${v.mesh.bbox.map(x=>x.toFixed(1)).join(" × ")} mm · ${(v.mesh.volume/1000).toFixed(1)} cm³ · ${v.mesh.triangles.toLocaleString()} triangles${v.mesh.sampled?" (sampled)":""}</div>`:""}
        ${v.slice&&v.slice.plates[0]? `<div class="sub">${fmtDur(v.slice.plates[0].seconds)} · ${v.slice.plates[0].weightG??"?"} g · ${esc(v.slice.plates[0].printerModel||"")} ${esc(v.slice.plates[0].nozzle||"")} mm nozzle</div>`:""}
        ${v.slice&&v.slice.filaments.length? `<div class="sub">${v.slice.filaments.map(f=>`<span class="swatch xs" style="background:${esc(f.color||"#888")}"></span>${esc(f.type)} ${f.usedG.toFixed(1)} g`).join(" · ")}</div>`:""}
        <div class="sub mono" title="SHA-256 of the file as uploaded">${v.sha256? "sha256 "+esc(v.sha256.slice(0,16))+"…" : "no fingerprint"}</div>
        <div style="display:flex; gap:7px; margin-top:6px; flex-wrap:wrap">
          ${v.settingsAll? `<button class="btn ghost sm" data-vset="${v.id}">Slicer settings</button>`:""}
          <a class="btn ghost sm" href="/api/file/${v.id}">Download</a>
          <button class="btn ghost sm" data-vreveal="${v.id}">Show in folder</button>
          <button class="btn ghost sm" data-vdel="${v.id}">Remove</button>
        </div>
        <div id="vset-${v.id}"></div>
      </div>
    </div>`).join("") : `<p class="hint">No versions yet.</p>`}`;
}

function settingsTable(v){
  const s = v.settings||{}, all = v.settingsAll||{};
  const rows = SETTINGS_HIGHLIGHT.filter(([k])=>s[k]!==undefined)
    .map(([k,label,unit])=>`<tr style="cursor:default"><td>${esc(label)}<span class="key">${k}</span></td><td class="mono num">${esc(String(s[k]))} ${esc(unit)}</td></tr>`).join("");
  const n = Object.keys(all).length;
  return `<div class="tablewrap" style="margin-top:9px"><table class="paramtable"><tbody>${rows}</tbody></table></div>
    <p class="hint">${n} slicer keys captured in total; the ${SETTINGS_HIGHLIGHT.filter(([k])=>s[k]!==undefined).length} that drive the result are shown.</p>`;
}

function partPrints(p){
  const list = printsFor(p.id);
  return `
  <button class="btn primary" id="pt-logprint2" style="margin-bottom:14px">Log a print</button>
  ${list.length ? list.map(pr=>{
    const sp = spools.find(s=>s.id===pr.spoolId);
    const h = hotends.find(x=>x.id===pr.hotendId);
    const v = (versions[p.id]||[]).find(x=>x.id===pr.versionId);
    const oc = pr.outcome||"ok";
    return `<div class="printrow">
      <div class="ocbar ${oc}"></div>
      <div style="flex:1; min-width:0">
        <div class="starrow" style="gap:8px">
          <b>${esc(pr.date||"undated")}</b>
          <span class="pill ${oc==="ok"?"ok":oc==="mixed"?"warn":"crit"}">${oc==="ok"?"good":oc==="mixed"?"acceptable":"failed"}</span>
          ${v? `<span class="pill acc">${esc(v.label||v.fileName)}</span>` : `<span class="pill">version not recorded</span>`}
        </div>
        <div class="sub">${sp? esc((sp.brand||"")+" "+(MATERIALS[matOf(sp)]||{}).label+" "+(sp.colorName||"")+(sp.batch?" ["+sp.batch+"]":"")) : "spool not recorded"}
          ${h? " · "+esc(h.name) : ""}${pr.printer? " · "+esc(PRINTERS[pr.printer].name):""}</div>
        ${pr.weightG||pr.durationMin? `<div class="sub">${pr.weightG? pr.weightG+" g":""}${pr.weightG&&pr.durationMin?" · ":""}${pr.durationMin? Math.floor(pr.durationMin/60)+" h "+(pr.durationMin%60)+" m":""}</div>`:""}
        ${pr.notes? `<div class="sub" style="margin-top:3px">${esc(pr.notes)}</div>`:""}
        ${pr.snapshot? `<button class="btn ghost sm" data-psnap="${pr.id}" style="margin-top:6px">Parameters used</button><div id="psnap-${pr.id}"></div>`:""}
        <button class="btn ghost sm" data-pdel="${pr.id}" style="margin-top:6px">Remove</button>
      </div>
    </div>`;
  }).join("") : `<p class="hint">No prints logged against this part yet. Logging one captures the file version, the exact spool and batch, the hotend, and a frozen copy of the parameters in force at the time.</p>`}`;
}

function partHistory(p){
  const ents = p.id ? historyFor("part", p.id) : [];
  return ents.length ? entriesHTML(ents) : `<p class="hint">No changes recorded yet.</p>`;
}
function entriesHTML(ents){
  return `<div class="timeline">${ents.map(e=>`
    <div class="tl">
      <div class="tldot ${e.action}"></div>
      <div style="flex:1; min-width:0">
        <div class="starrow" style="gap:8px">
          <b>${e.action==="create"?"Created":e.action==="delete"?"Deleted":"Updated"}</b>
          <span class="sub">${fmtWhen(e.ts)}</span>
          ${e.n? `<span class="pill">${e.n} field${e.n>1?"s":""}</span>`:""}
        </div>
        ${(e.changes||[]).length? `<div class="chgs">${e.changes.map(c=>`
          <div class="chg"><span class="mono cf">${esc(c.f)}</span>
            <span class="mono ca">${esc(c.a)}</span><span class="arw">→</span><span class="mono cb">${esc(c.b)}</span></div>`).join("")}</div>`:""}
      </div>
    </div>`).join("")}</div>`;
}

function wirePartDrawer(){
  const p = state.part;
  const bind = (id, key, xf)=>{ const el=$(id); if(el) el.addEventListener("input",()=>{ p[key] = xf? xf(el.value) : el.value; if(key==="name") $("#dr-title").textContent = el.value||"New part"; }); };
  bind("#pt-name","name"); bind("#pt-cat","category"); bind("#pt-desc","description");
  bind("#pt-tags","tags", v=>v.split(",").map(t=>t.trim()).filter(Boolean));

  const goVer = ()=>{ state.partTab="versions"; renderPartDrawer(); };
  if($("#pt-addver")) $("#pt-addver").addEventListener("click",goVer);
  if($("#pt-logprint")) $("#pt-logprint").addEventListener("click",()=>openPrintForm(p));
  if($("#pt-logprint2")) $("#pt-logprint2").addEventListener("click",()=>openPrintForm(p));

  const drop = $("#pt-drop"), file = $("#pt-file");
  if(drop){
    $("#pt-pick").addEventListener("click",()=>file.click());
    file.addEventListener("change",e=>{ if(e.target.files[0]) handleModel(e.target.files[0]); });
    ["dragenter","dragover"].forEach(ev=>drop.addEventListener(ev,e=>{ e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave","drop"].forEach(ev=>drop.addEventListener(ev,e=>{ e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop",e=>{ const f=e.dataTransfer.files[0]; if(f) handleModel(f); });
  }
  $("#dr-body").querySelectorAll("[data-vdel]").forEach(b=>b.addEventListener("click",async()=>{
    if(!confirm("Remove this version?")) return;
    await delVersion(p.id, b.dataset.vdel);
    logChange("part", p.id, p.name, "update", {"version count":(versions[p.id]||[]).length+1},
              {"version count":(versions[p.id]||[]).length});
    renderPartDrawer(); renderParts();
  }));
  $("#dr-body").querySelectorAll("[data-vreveal]").forEach(b=>b.addEventListener("click",()=>{
    const v = (versions[p.id]||[]).find(x=>x.id===b.dataset.vreveal);
    if(v && v.relPath) api("/api/reveal",{method:"POST",body:JSON.stringify({path:v.relPath})}).catch(()=>{});
  }));
  $("#dr-body").querySelectorAll("[data-vset]").forEach(b=>b.addEventListener("click",()=>{
    const host = $("#vset-"+b.dataset.vset);
    if(host.innerHTML){ host.innerHTML=""; b.textContent="Slicer settings"; return; }
    const v = (versions[p.id]||[]).find(x=>x.id===b.dataset.vset);
    host.innerHTML = settingsTable(v); b.textContent="Hide settings";
  }));
  $("#dr-body").querySelectorAll("[data-psnap]").forEach(b=>b.addEventListener("click",()=>{
    const host = $("#psnap-"+b.dataset.psnap);
    if(host.innerHTML){ host.innerHTML=""; b.textContent="Parameters used"; return; }
    const pr = prints.find(x=>x.id===b.dataset.psnap);
    host.innerHTML = `<div class="tablewrap" style="margin-top:9px"><table class="paramtable"><tbody>${
      Object.keys(pr.snapshot).map(k=>`<tr style="cursor:default"><td>${esc(k)}</td><td class="mono num">${esc(String(pr.snapshot[k]))}</td></tr>`).join("")
    }</tbody></table></div>`;
    b.textContent="Hide parameters";
  }));
  $("#dr-body").querySelectorAll("[data-pdel]").forEach(b=>b.addEventListener("click",async()=>{
    if(!confirm("Remove this print record?")) return;
    await delPrint(b.dataset.pdel); renderPartDrawer();
  }));
}

async function handleModel(file){
  const host = $("#pt-ingest");
  host.innerHTML = `<div class="flag"><span class="ic">…</span><div><b>Uploading ${esc(file.name)}</b>${fmtBytes(file.size)} — the server is filing it, unzipping any slicer data and rendering the preview.</div></div>`;

  if(!state.part.id){
    if(!state.part.name) state.part.name = file.name.replace(/\.(3mf|stl)$/i,"").replace(/[_-]+/g," ");
    const id = await savePart(state.part, true);
    if(!id){ host.innerHTML = `<div class="flag crit"><span class="ic">!!</span><div><b>Could not create the part</b>The server refused the record.</div></div>`; return; }
    state.part.id = id;
  }
  let res;
  try{
    const r = await fetch(`/api/parts/${state.part.id}/versions?name=${encodeURIComponent(file.name)}`,
                          {method:"POST", body:file});
    res = await r.json();
    if(!r.ok) throw new Error(res.error || (r.status + " " + r.statusText));
  }catch(e){
    host.innerHTML = `<div class="flag crit"><span class="ic">!!</span><div><b>Upload failed</b>${esc(e.message)}</div></div>`;
    return;
  }
  await refresh();
  const v = res.version || {};
  host.innerHTML = (v.warnings && v.warnings.length)
    ? `<div class="flag warn"><span class="ic">!</span><div><b>${esc(v.label||"Version")} filed with a caveat</b>${esc(v.warnings.join(" "))}</div></div>`
    : "";
  toast(`${v.label||"Version"} filed to ${v.relPath ? v.relPath.split("/").slice(0,-1).join("/") : "the library"}`);
  renderPartDrawer(); renderParts();
}

/* ------------------------------ print form ------------------------------ */
function openPrintForm(p, existing){
  const vs = (versions[p.id]||[]).slice().sort((a,b)=>(b.uploadedAt||"").localeCompare(a.uploadedAt||""));
  const pr = existing || { partId:p.id, versionId: vs[0]? vs[0].id : "", date:new Date().toISOString().slice(0,10),
    printer:"x1c", hotendId:hotends[0]?hotends[0].id:"", spoolId:"", outcome:"ok", weightG:"", durationMin:"", notes:"" };
  state.printDraft = pr;
  const body = $("#dr-body");
  body.innerHTML = `
    <fieldset class="fieldset"><legend>Print record</legend>
      <div class="grid g2">
        <label class="f"><span>Date</span><input type="date" id="pr-date" value="${esc(pr.date)}"></label>
        <label class="f"><span>Part version used</span><select id="pr-ver">
          ${vs.length? vs.map(v=>`<option value="${v.id}"${v.id===pr.versionId?" selected":""}>${esc(v.label||v.fileName)} · ${esc(v.fileName)}</option>`).join("")
             : `<option value="">no versions on file</option>`}
        </select></label>
        <label class="f"><span>Printer</span><select id="pr-printer">${Object.keys(PRINTERS).map(k=>`<option value="${k}"${k===pr.printer?" selected":""}>${PRINTERS[k].name}</option>`).join("")}</select></label>
        <label class="f"><span>Hotend / nozzle</span><select id="pr-hot">${hotends.map(h=>`<option value="${h.id}"${h.id===pr.hotendId?" selected":""}>${esc(h.name)}</option>`).join("")}</select></label>
        <label class="f" style="grid-column:span 2"><span>Spool used</span><select id="pr-spool">
          <option value="">not recorded</option>
          ${spools.map(s=>`<option value="${s.id}"${s.id===pr.spoolId?" selected":""}>${esc((s.brand||"?")+" "+(MATERIALS[matOf(s)]||{}).label+" · "+(s.colorName||"")+(s.batch?" ["+s.batch+"]":""))}</option>`).join("")}
        </select></label>
        <label class="f"><span>Outcome</span><select id="pr-outcome">
          <option value="ok"${pr.outcome==="ok"?" selected":""}>Good — met requirements</option>
          <option value="mixed"${pr.outcome==="mixed"?" selected":""}>Acceptable — usable with defects</option>
          <option value="fail"${pr.outcome==="fail"?" selected":""}>Failed</option>
        </select></label>
        <label class="f"><span>Weight g</span><input type="number" step="0.1" id="pr-weight" value="${esc(pr.weightG)}"></label>
        <label class="f"><span>Duration minutes</span><input type="number" id="pr-dur" value="${esc(pr.durationMin)}"></label>
        <label class="f"><span>Goal used</span><select id="pr-goal">${Object.keys(GOALS).map(k=>`<option value="${k}"${k===(pr.goal||"balanced")?" selected":""}>${GOALS[k].label}</option>`).join("")}</select></label>
        <label class="f" style="grid-column:span 2"><span>Notes</span><textarea id="pr-notes" rows="3" placeholder="What went right or wrong, and anything you changed by hand.">${esc(pr.notes||"")}</textarea></label>
      </div>
      <p class="hint">Saving freezes the parameter set in force for that spool, hotend and printer, so this record still means something after the profile moves on.</p>
    </fieldset>`;
  $("#dr-save").textContent = "Save print";
  $("#dr-del").style.display = "none";
  $("#dr-save").onclick = async ()=>{
    const g = id => { const el=$(id); return el? el.value : ""; };
    const rec = Object.assign({}, pr, {
      date:g("#pr-date"), versionId:g("#pr-ver"), printer:g("#pr-printer"), hotendId:g("#pr-hot"),
      spoolId:g("#pr-spool"), outcome:g("#pr-outcome"), goal:g("#pr-goal"),
      weightG: g("#pr-weight")===""?"":+g("#pr-weight"),
      durationMin: g("#pr-dur")===""?"":+g("#pr-dur"), notes:g("#pr-notes")
    });
    rec.snapshot = buildSnapshot(rec);
    rec.label = `${state.part.name||"part"} · ${rec.date}`;
    await savePrint(rec);
    state.partTab = "prints"; renderPartDrawer(); toast("Print logged");
  };
}

/* A frozen copy of what the engine recommends for this combination right now,
   so a record still reads correctly after the profile is retuned. */
function buildSnapshot(rec){
  const h = hotends.find(x=>x.id===rec.hotendId);
  const sp = spools.find(s=>s.id===rec.spoolId);
  if(!h) return null;
  const mat = sp ? matOf(sp) : "PLA";
  const inp = { mat, printer:rec.printer, body:h.body, d:+h.nozzle, cls:h.cls, nozMat:h.nozMat,
    goal:rec.goal||"balanced", lh:0.2, lw:+h.nozzle+0.02, path:900, height:60,
    flowFactor: sp? (spoolFlowFactor(sp)||1) : 1,
    paFactor: sp? (paFactorFromMeasurement((sp.measured||{}).pa, mat)||1) : 1 };
  try{
    const r = recommend(inp);
    return {
      material: MATERIALS[mat].label,
      spool: sp ? ((sp.brand||"")+" "+(sp.colorName||"")+(sp.batch?" ["+sp.batch+"]":"")).trim() : "not recorded",
      hotend: h.name, printer: PRINTERS[rec.printer].name, goal: r.g.label,
      "flow ceiling": r.ceil.q.toFixed(1)+" mm³/s",
      "max volumetric speed": r.qUse.toFixed(1)+" mm³/s",
      "nozzle temperature": r.T+" °C", "bed": r.bed+" °C", "chamber": r.chamber+" °C",
      "fan": r.fanMin+"–"+r.fanMax+" %", "k factor": r.k.toFixed(3),
      "retraction": r.retract+" mm", "flow ratio": r.flowRatio.toFixed(3),
      "captured": new Date().toISOString().slice(0,16).replace("T"," ")
    };
  }catch(e){ return null; }
}

/* ------------------------------ history view ---------------------------- */
function renderHistory(){
  if(state.view!=="history") return;
  const kind = $("#h-kind").value, q = ($("#hq").value||"").toLowerCase();
  const rows = [];
  history.forEach(doc=>{
    if(kind && doc.kind !== kind) return;
    if(q && !((doc.name||"")+" "+doc.kind).toLowerCase().includes(q)) return;
    (doc.entries||[]).forEach(e=>rows.push({doc, e}));
  });
  rows.sort((a,b)=>(b.e.ts||"").localeCompare(a.e.ts||""));
  const shown = rows.slice(0, 200);
  $("#hcount").textContent = rows.length ? `${shown.length} of ${rows.length} entries` : "";
  const KIND = {spool:"Spool", part:"Part", print:"Print", hotend:"Hotend", config:"Configuration", scale:"Quality scale"};
  $("#hist-out").innerHTML = shown.length ? `<div class="panel"><div class="body">
    <div class="timeline">${shown.map(({doc,e})=>`
      <div class="tl">
        <div class="tldot ${e.action}"></div>
        <div style="flex:1; min-width:0">
          <div class="starrow" style="gap:8px">
            <span class="pill">${esc(KIND[doc.kind]||doc.kind)}</span>
            <b>${esc(doc.name||doc.targetId)}</b>
            <span class="sub">${e.action==="create"?"created":e.action==="delete"?"deleted":"updated"} · ${fmtWhen(e.ts)}</span>
          </div>
          ${(e.changes||[]).length? `<div class="chgs">${e.changes.slice(0,8).map(c=>`
            <div class="chg"><span class="mono cf">${esc(c.f)}</span>
              <span class="mono ca">${esc(c.a)}</span><span class="arw">→</span><span class="mono cb">${esc(c.b)}</span></div>`).join("")}
            ${e.changes.length>8? `<div class="sub">and ${e.changes.length-8} more</div>`:""}</div>`:""}
        </div>
      </div>`).join("")}</div></div></div>`
    : `<div class="panel"><div class="body empty">Nothing recorded yet. Every save to a spool, part, hotend, configuration or print record is logged here with the fields that moved.</div></div>`;
}

/* ---------------------------- file verification ------------------------- */
/* Hashed on the server: window.crypto.subtle is unavailable over plain http
   to a LAN address, so doing this in the browser would fail on every machine
   except the one running the app. */
async function verifyFile(file){
  const out = $("#verify-out");
  out.innerHTML = `<div class="flag"><span class="ic">…</span><div><b>Hashing ${esc(file.name)}</b>${fmtBytes(file.size)}</div></div>`;
  let res;
  try{
    const r = await fetch(`/api/verify?name=${encodeURIComponent(file.name)}`, {method:"POST", body:file});
    res = await r.json();
    if(!r.ok) throw new Error(res.error||"failed");
  }catch(e){
    out.innerHTML = `<div class="flag crit"><span class="ic">!!</span><div><b>Could not check that file</b>${esc(e.message)}</div></div>`;
    return;
  }
  out.innerHTML = res.match
    ? `<div class="flag ok"><span class="ic">✓</span><div><b>Byte-for-byte match</b>${esc(file.name)} is ${esc(res.match.label||res.match.fileName)} of ${esc(res.match.partName||"a part")}, filed ${fmtWhen(res.match.uploadedAt)}.<div class="mono sub" style="margin-top:4px">${esc(res.match.relPath||"")}</div></div></div>`
    : `<div class="flag warn"><span class="ic">!</span><div><b>No match on record</b>Nothing in the library has this fingerprint. Either it is a new revision, or it was edited after being filed.<div class="mono sub" style="margin-top:5px; word-break:break-all">sha256 ${esc(res.hash)}</div></div></div>`;
}

/* ------------------------------- storage view --------------------------- */
async function renderStorage(){
  if(state.view !== "storage") return;
  const out = $("#store-out");
  let d;
  try{ d = await api("/api/storage"); }
  catch(e){ out.innerHTML = `<div class="panel"><div class="body empty">Cannot reach the server.</div></div>`; return; }
  const cats = d.categories || [];
  out.innerHTML = `
  <div class="panel" style="margin-bottom:14px">
    <header><h3>Library</h3><button class="btn sm" id="st-open">Open in Explorer</button></header>
    <div class="readout">
      <div class="ro"><div class="lab">Root</div><div class="val" style="font-size:13px; word-break:break-all">${esc(d.root)}</div></div>
      <div class="ro"><div class="lab">Layout</div><div class="val mono" style="font-size:12px">${esc(d.layout)}</div></div>
      <div class="ro"><div class="lab">Stored</div><div class="val">${fmtBytes(d.bytes)}<small>${d.files} files</small></div></div>
      <div class="ro"><div class="lab">Free on disk</div><div class="val">${fmtBytes(d.free)}</div></div>
    </div>
  </div>
  ${d.missing && d.missing.length ? `
  <div class="panel" style="margin-bottom:14px">
    <header><h3>Files missing from disk</h3><span class="pill crit">${d.missing.length}</span></header>
    <div class="body"><p class="hint" style="margin-top:0">These versions are in the database but their file is gone — moved or deleted outside the app. Re-upload the file, or remove the version.</p>
    ${d.missing.map(m=>`<div class="sub mono">${esc(m.part||"?")} — ${esc(m.file)}</div>`).join("")}</div>
  </div>`:""}
  <div class="panel" style="margin-bottom:14px">
    <header><h3>Categories on disk</h3></header>
    ${cats.length ? `<div class="tablewrap" style="border:0"><table><thead><tr>
      <th>Folder</th><th>Parts</th><th>Files</th><th>Size</th></tr></thead><tbody>
      ${cats.map(c=>`<tr style="cursor:default"><td class="mono">${esc(c.name)}</td>
        <td class="num">${c.parts}</td><td class="num">${c.files}</td><td class="num">${fmtBytes(c.bytes)}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="body empty">Nothing filed yet.</div>`}
  </div>
  <div class="panel">
    <header><h3>Import an existing folder</h3></header>
    <div class="body">
      <p class="hint" style="margin-top:0">Point this at a folder of models you already have. Every <span class="mono">.stl</span> and <span class="mono">.3mf</span> under it becomes a part, filed into the library layout. Files already in the library are recognised by their fingerprint and skipped, so running it twice is safe.</p>
      <div class="grid" style="grid-template-columns:minmax(0,1fr) 170px auto; gap:9px; align-items:end">
        <label class="f"><span>Folder on this machine</span><input type="text" id="st-path" placeholder="D:\\Models\\Brackets"></label>
        <label class="f"><span>File them under</span><input type="text" id="st-cat" value="Imported"></label>
        <button class="btn primary" id="st-scan">Import</button>
      </div>
      <div id="st-result"></div>
    </div>
  </div>`;

  $("#st-open").addEventListener("click",()=>api("/api/reveal",{method:"POST",body:JSON.stringify({path:d.root})}).catch(()=>{}));
  $("#st-scan").addEventListener("click", async ()=>{
    const path = $("#st-path").value.trim();
    if(!path){ toast("Give it a folder path first"); return; }
    const res = $("#st-result");
    res.innerHTML = `<div class="flag"><span class="ic">…</span><div><b>Scanning</b>Reading every model under that folder. Large trees take a moment.</div></div>`;
    try{
      const r = await api("/api/scan", {method:"POST", body:JSON.stringify({path, category:$("#st-cat").value.trim()||"Imported"})});
      res.innerHTML = `<div class="flag ok"><span class="ic">✓</span><div><b>${r.added} part${r.added===1?"":"s"} filed</b>${r.found} model file${r.found===1?"":"s"} found${r.skipped?`, ${r.skipped} already in the library`:""}.${r.names.length?`<div class="sub" style="margin-top:5px">${r.names.map(esc).join(", ")}${r.added>r.names.length?" …":""}</div>`:""}</div></div>`;
      await refresh();
    }catch(e){
      res.innerHTML = `<div class="flag crit"><span class="ic">!!</span><div><b>Import failed</b>${esc(e.message)}</div></div>`;
    }
  });
}

/* ------------------------------- start ---------------------------------- */
document.addEventListener("keydown", e=>{ if(e.key === "Escape") drawer(false); });
resetSaveHandler();
renderAll();
boot();
