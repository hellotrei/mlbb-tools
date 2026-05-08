#!/usr/bin/env python3
# Download verified Liquipedia team logos to apps/web/static/teams/
# Usage: python3 scripts/download-team-logos.py

import os
import time
import urllib.request
import urllib.error

BASE = "https://liquipedia.net/commons/special:filepath"
DEST = "apps/web/static/teams"

LOGOS = {
    # MPL Indonesia S17
    "onic_esports":       "ONIC_Esports_allmode.png",
    "team_liquid_id":     "Team_Liquid_allmode.png",
    "dewa_united":        "Dewa_United_Esports_allmode.png",
    "bigetron":           "Bigetron_Esports_allmode.png",
    "alter_ego":          "Alter_Ego_2022_allmode.png",
    "evos":               "EVOS_Esports_allmode.png",
    "geek_fam":           "Geek_Fam_allmode.png",
    "natus_vincere":      "Natus_Vincere_allmode.png",
    "rex_regum_qeon":     "Rex_Regum_Qeon_allmode.png",
    # MPL Philippines S17
    "team_liquid_ph":     "Team_Liquid_Echo_full_darkmode.png",
    "twisted_minds":      "Twisted_Minds_2023_full_darkmode.png",
    "omega_esports_ph":   "Omega_Esports_(Philippines)_2025_full_darkmode.png",
    "aurora_gaming":      "Aurora_allmode.png",
    "ap_bren":            "AP_Bren_allmode.png",
    "tnc_pro_team":       "TNC_Pro_Team_allmode.png",
    "team_falcons_ph":    "Team_Falcons_2022_allmode.png",
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; mlbb-tools/1.0)"
}

os.makedirs(DEST, exist_ok=True)

for key, filename in LOGOS.items():
    outfile = os.path.join(DEST, f"{key}.png")

    if os.path.exists(outfile):
        print(f"✓ already exists: {key}")
        continue

    url = f"{BASE}/{filename}"
    print(f"⬇  {key}  →  {filename}")

    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = resp.read()

        # Verify PNG magic bytes
        if data[:4] == b'\x89PNG':
            with open(outfile, "wb") as f:
                f.write(data)
            print(f"   ✓ saved ({len(data)//1024}KB)")
        else:
            print(f"   ✗ not a PNG (got HTML?), skipping")

    except urllib.error.HTTPError as e:
        print(f"   ✗ HTTP {e.code}: {e.reason}")
    except Exception as e:
        print(f"   ✗ error: {e}")

    time.sleep(3)

print(f"\nDone. Files in {DEST}:")
for f in sorted(os.listdir(DEST)):
    path = os.path.join(DEST, f)
    print(f"  {f}  ({os.path.getsize(path)//1024}KB)")

