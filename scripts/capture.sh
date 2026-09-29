#!/usr/bin/env bash
# Headless Edge captures (software WebGL) of a running server. usage: BASE=http://localhost:4173 scripts/capture.sh [outdir]
BASE=${BASE:-http://localhost:4173}; OUT=${1:-../project/renders/web}; mkdir -p "$OUT"
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
shot() { for try in 1 2 3 4; do "$EDGE" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars --window-size=${3:-1280,800} \
  --virtual-time-budget=120000 --screenshot="$(cygpath -w "$(realpath "$OUT")/$1.png")" "$BASE/?autostart&$2" >/dev/null 2>&1; [ "$(stat -c %s "$OUT/$1.png" 2>/dev/null || echo 0)" -gt 40000 ] && break; done; echo "$1 $(stat -c %s "$OUT/$1.png" 2>/dev/null)"; }
shot web_01_living        "pose=3.35,4.98,22,6"
shot web_02_living_eve    "pose=3.35,4.98,22,6&mode=evening"
shot web_03_passage       "pose=4.25,4.65,-90,4&doors=D03,D04"
shot web_04_bedroom1      "pose=3.30,5.60,180,-4&doors=D02,D05"
shot web_05_bedroom2      "pose=7.37,3.05,75,-6&doors=D03"
shot web_06_bath_common   "pose=4.50,5.00,180,-18&doors=D04"
shot web_07_bath_attached "pose=3.20,7.75,-90,-14&doors=D05"
shot web_08_balcony       "pose=-0.9,4.6,-90,0&doors=D01"
shot web_09_overview      "inspect&pose=4.0,4.65,-90,0"
shot web_10_mobile        "pose=3.35,4.98,22,6" 390,844
