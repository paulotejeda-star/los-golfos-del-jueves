#!/usr/bin/env python3
"""Caddy PTC · Garmin Golf → caddy-data.json

Baja de Garmin Connect el handicap, las tarjetas y el golpe por golpe de Paulo,
calcula la estrategia y escribe ../caddy-data.json (solo agregados: ni tokens
ni coordenadas GPS salen al archivo publicado).

Uso (con el venv de VityHealth, que ya trae garth):
  "<VityHealth>/garmin-venv/bin/python" -I caddy/caddy_sync.py

Tokens: GARMIN_TOKENS (default: tokens de VityHealth). Solo se leen; el refresh
de oauth2 vive en memoria y no se escribe de vuelta.
"""
import json
import math
import os
import statistics as st
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import garth
import requests

# garth baja sus llaves de S3 sin límite de tiempo y el 19-nov se quedó colgado ahí:
# toda llamada lleva 30 s de tope para que falle con error en vez de esperar para siempre.
_request = requests.Session.request
requests.Session.request = lambda self, *a, **k: _request(self, *a, **{"timeout": 30, **k})

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "caddy-data.json"
DEFAULT_TOKENS = Path(
    "/Users/paulotejeda/Documents/Visual Studio Code Claude/01-Lead-Connect/VityHealth/garmin_tokens"
)
BASE = "https://connectapi.garmin.com/gcs-golfcommunity/api/v2"
UA = "GCM-iOS-5.7.2.1"
SEMI = 180 / 2**31  # semicírculos de Garmin → grados
INSIDE = 30  # metros: frontera del juego corto
# El plan hoyo por hoyo con golpe por golpe es de La Huerta; las rondas en otros
# campos se listan en el progreso pero no mezclan su tarjeta con la de La Huerta.
HOME = "huerta"
# Rondas que no fueron el juego de Paulo: se ven en el progreso, marcadas, pero no
# entran a los promedios ni a las distancias del Caddy. (El handicap lo calcula
# Garmin y ahí ya quedó contada.) Clave: (fecha, n-ésima ronda de ese día).
EXCLUDE = {
    ("2026-11-16", 2): "Otra persona jugó los 9 hoyos con tu reloj",
}
# Palos que dictó Paulo el 22-nov-2026, porque el reloj no los marcó. En estas rondas
# salió con su Driver (M4) en los par 4 y par 5. Clave: (fecha, n-ésima ronda del día).
DRIVER_ROUNDS = {("2026-11-18", 1), ("2026-11-22", 1), ("2026-11-22", 2)}
# Golpes puntuales: (fecha, ronda del día, hoyo, número de golpe en Garmin) → (palo, metros).
# Los metros son los que dijo Paulo y mandan sobre el reloj, que en estos midió mal
# (47, 25 y 175 m): Driver de 100 yd y 165 yd, Madera 3 de «100 o 120 m» (punto medio).
YD = 0.9144
CLUB_NOTES = {
    ("2026-11-22", 1, 6, 1): ("Driver", round(100 * YD)),
    ("2026-11-22", 1, 6, 2): ("Madera 3", 110),
    ("2026-11-22", 2, 6, 1): ("Driver", round(165 * YD)),
}
# Cómo lo dijo Paulo, para mostrarlo mientras el palo tenga un solo golpe anotado.
CLUB_RANGE = {"Madera 3": "de 100 a 120 m"}
# Golpes que el reloj no registró y Paulo dictó con su distancia: palo → [(metros, campo)].
# Hoyo 1 de La Huerta, 22-nov: salida con el M4 de 170 yd (1ª vuelta) y 140 yd (2ª vuelta).
CLUB_UNRECORDED = {"Driver": [(round(170 * YD), "La Huerta"), (round(140 * YD), "La Huerta")]}
# Un columpio de práctica queda guardado en un hoyo mucho antes de jugarlo (el 22-nov,
# dos en el hoyo 7 con hora anterior a la salida del 1). Más de 20 min antes del
# siguiente golpe del mismo hoyo = no fue parte del hoyo.
MAX_GAP_MS = 20 * 60 * 1000


def session():
    garth.resume(os.environ.get("GARMIN_TOKENS", str(DEFAULT_TOKENS)))
    c = garth.client
    c.refresh_oauth2()
    headers = {"Authorization": str(c.oauth2_token), "User-Agent": UA}

    def get(path, **params):
        r = c.sess.get(BASE + path, params=params or None, headers=headers, timeout=30)
        if not r.ok:
            raise SystemExit(f"Garmin {r.status_code} en {path}: {r.text[:300]}")
        return r.json()

    return get


def meters(a, b):
    la1, lo1, la2, lo2 = (v * SEMI * math.pi / 180 for v in (a["lat"], a["lon"], b["lat"], b["lon"]))
    return 6371000 * math.hypot((lo2 - lo1) * math.cos((la1 + la2) / 2), la2 - la1)


def mean(xs, nd=1):
    xs = list(xs)
    return round(st.mean(xs), nd) if xs else None


def drop_stale(sh):
    """Quita los golpes guardados mucho antes de jugar el hoyo (ver MAX_GAP_MS)."""
    keep = sh[-1:]
    for x in reversed(sh[:-1]):
        if x.get("shotTime") and keep[0].get("shotTime") and keep[0]["shotTime"] - x["shotTime"] > MAX_GAP_MS:
            break
        keep.insert(0, x)
    return keep


def driver_shot(sh):
    """La salida real del hoyo, o None si el reloj no deja claro cuál fue.

    Un golpe que arranca en lie Unknown es un columpio camino a la salida: cuenta el
    siguiente. Uno que va de salida a salida es ambiguo y no se le atribuye al Driver.
    """
    first = sh[0]
    if first["startLoc"].get("lie") == "Unknown" and len(sh) > 1:
        first = sh[1]
    if first["startLoc"].get("lie") != "TeeBox" or first["endLoc"].get("lie") == "TeeBox":
        return None
    return first


def main():
    get = session()
    stats = get("/player/stats")
    summaries = get("/scorecard/summary", **{"per-page": 200, "user-locale": "es"})["scorecardSummaries"]

    club_list = get("/club/player", **{"per-page": 100})
    club_types = {t["value"]: t["name"] for t in get("/club/types")}
    rounds, holes = [], []
    full_shots, club_shots = [], defaultdict(list)
    dictated = defaultdict(list)  # palo → golpes que Paulo dictó (no entran a la tabla del plan)
    course = None
    summaries = sorted(summaries, key=lambda s: s.get("startTime") or "")
    per_day = defaultdict(int)
    for s in summaries:
        det = get("/scorecard/detail", **{"scorecard-ids": str(s["id"]), "include-longest-shot-distance": "true"})
        d = det["scorecardDetails"][0]
        sc = d["scorecard"]
        snap = det["courseSnapshots"][0]
        pars = snap["holePars"]
        day = (sc.get("formattedStartTime") or sc["startTime"])[:10]
        per_day[day] += 1
        skip = EXCLUDE.get((day, per_day[day]))
        home = HOME in (snap.get("name") or "").lower()
        if course is None and home:
            tee = next((t for t in snap.get("tees", []) if t.get("name") == sc.get("teeBox")), (snap.get("tees") or [{}])[0])
            course = {
                "name": snap["name"],
                "city": snap.get("city"),
                "par18": snap.get("roundPar"),
                "rating18": tee.get("rating"),
                "slope": tee.get("slope"),
                "holeIndex": [int(tee["holeHandicaps"][i:i + 2]) for i in range(0, 36, 2)] if tee.get("holeHandicaps") else None,
                "pars": [int(p) for p in pars],
            }
        played = [h for h in sc["holes"] if h.get("strokes")]
        par_played = sum(int(pars[h["number"] - 1]) for h in played)
        rounds.append({
            "date": sc.get("formattedStartTime", sc["startTime"])[:10],
            "holes": len(played),
            "strokes": sc.get("strokes"),
            "par": par_played,
            "overPerHole": round((sc["strokes"] - par_played) / len(played), 2) if played else None,
            "longest": round(d.get("longestShotInMeters") or 0),
            **({} if home else {"course": snap.get("name"), "tee": sc.get("teeBox"),
                                 "perHole": [h.get("strokes") for h in sorted(sc["holes"], key=lambda h: h["number"])]}),
            **({"excluded": skip} if skip else {}),
        })
        round_no = per_day[day]
        driver_round = (day, round_no) in DRIVER_ROUNDS
        if skip or not (home or driver_round):
            continue

        shots = get(f"/shot/scorecard/{s['id']}/hole",
                    **{"hole-numbers": "-".join(str(i) for i in range(1, 19)), "image-size": "IMG_730X730"})
        strokes = {h["number"]: h.get("strokes") for h in sc["holes"]}
        fairway = {h["number"]: h.get("fairwayShotOutcome") for h in sc["holes"]}
        where = "La Huerta" if home else (snap.get("name") or "").split(" Residencial")[0].replace("Tiburon", "Tiburón")
        for hs in shots.get("holeShots", []):
            n = hs["holeNumber"]
            pin = hs.get("pinPosition")
            sh = sorted(hs.get("shots") or [], key=lambda x: x["shotOrder"])
            # Solo en las rondas revisadas: el 4-nov un mismo hoyo se jugó dos veces con
            # más de 20 min de diferencia y este filtro borraría golpes reales.
            if driver_round:
                sh = drop_stale(sh)
            if not pin or not sh or not strokes.get(n):
                continue
            if driver_round:
                noted = {}
                for x in sh:
                    note = CLUB_NOTES.get((day, round_no, n, x["shotOrder"]))
                    if note:
                        noted[x["shotOrder"]] = note[0]
                        x["meters"] = note[1]
                tee_shot = driver_shot(sh) if int(pars[n - 1]) >= 4 else None
                if tee_shot and not noted:
                    noted[tee_shot["shotOrder"]] = "Driver"
                for x in sh:
                    if x["shotOrder"] in noted:
                        dictated[noted[x["shotOrder"]]].append((x["meters"], where))
            if not home:
                continue
            for x in sh:
                if x.get("shotType") in ("TEE", "APPROACH", "LAYUP") and x.get("meters", 0) > 40:
                    full_shots.append(x["meters"])
                    if x.get("clubId"):
                        club_shots[x["clubId"]].append(x["meters"])
            dist = [meters(x["startLoc"], pin) for x in sh]
            long_shots = sum(1 for v in dist if v > INSIDE)
            holes.append({
                "n": n,
                "par": int(pars[n - 1]),
                "strokes": strokes[n],
                "len": dist[0],
                "tee": sh[0]["meters"],
                "left": meters(sh[0]["endLoc"], pin),
                "teeLie": sh[0]["endLoc"].get("lie"),
                "inside": strokes[n] - long_shots,
                "fairway": fairway.get(n),
            })

    # Handicap de cancha (fórmula WHS) y par personal por hoyo
    hi = stats.get("handicap")
    ch18 = round(hi * course["slope"] / 113 + (course["rating18"] - course["par18"])) if hi and course.get("slope") else None
    personal = []
    for i in range(9):
        idx = course["holeIndex"][i] if course.get("holeIndex") else 18
        extra = (ch18 // 18) + (1 if idx <= ch18 % 18 else 0) if ch18 else 0
        personal.append(course["pars"][i] + extra)

    by_hole = defaultdict(list)
    for h in holes:
        by_hole[h["n"]].append(h)
    # Si el reloj marcó la salida tarde (p. ej. un hoyo de 74 m medido en 8 m), esa
    # ronda no sirve para distancias: se descarta la que mide menos del 70% de la
    # mediana del hoyo. Los golpes sí cuentan.
    for H in by_hole.values():
        med = st.median(h["len"] for h in H)
        for h in H:
            h["ok"] = h["len"] >= 0.7 * med

    def group(par):
        H = [h for h in holes if h["par"] == par]
        V = [h for h in H if h["ok"]]
        return {
            "n": len(H),
            "avgStrokes": mean((h["strokes"] for h in H), 2),
            "holeLen": mean((h["len"] for h in V), 0),
            "teeDist": mean((h["tee"] for h in V), 0),
            "leftToPin": mean((h["left"] for h in V), 0),
            "teeOnGreen": sum(1 for h in V if h["teeLie"] == "Green"),
            "teeRough": sum(1 for h in V if h["teeLie"] == "Rough"),
            "teeBunker": sum(1 for h in V if h["teeLie"] == "Bunker"),
            # Solo hoyos con la salida registrada: si el reloj no la marcó, los golpes
            # que faltan se contarían como juego corto (22-nov, hoyo 1: 1.4 → 3.3).
            "insideAvg": mean((h["inside"] for h in V), 2),
        }

    p3, p4 = group(3), group(4)
    blowups = sum(1 for h in holes if h["strokes"] >= h["par"] + 4)

    # Ahorros que estima el Caddy por cada 9 hoyos (7 par 3 y 2 par 4 en La Huerta)
    n3 = sum(1 for p in course["pars"][:9] if p == 3)
    n4 = sum(1 for p in course["pars"][:9] if p == 4)
    save_short = round(max(0, (p3["insideAvg"] or 0) - 3.0) * n3, 1)
    save_tee3 = round(min(1.5, max(0, ((p3["teeRough"] + p3["teeBunker"]) / max(p3["n"], 1)) * n3 * 0.25)), 1)
    save_p4 = round(max(0, (p4["avgStrokes"] or 0) - 5.5) * n4, 1)
    save_damage = round(blowups / max(len(holes), 1) * 9 * 1.5, 1)

    nine = [r for r in rounds if r["holes"] == 9 and not r.get("excluded") and not r.get("course")]
    avg9 = mean((r["strokes"] for r in nine), 0) if nine else round((p3["avgStrokes"] * n3 + p4["avgStrokes"] * n4))

    plan = []
    for i in range(9):
        n = i + 1
        H = by_hole.get(n, [])
        plan.append({
            "n": n,
            "par": course["pars"][i],
            "index": course["holeIndex"][i] if course.get("holeIndex") else None,
            "personalPar": personal[i],
            "len": round(st.median([h["len"] for h in H if h["ok"]])) if H else None,
            "avg": mean((h["strokes"] for h in H), 1),
            "best": min((h["strokes"] for h in H), default=None),
            "times": len(H),
            "tee": mean((h["tee"] for h in H if h["ok"]), 0),
            "inside": mean((h["inside"] for h in H if h["ok"]), 1),
        })

    # Bolsa: distancia de cada palo. Si el reloj trae el palo marcado (3 tiros o más)
    # se usa la mediana real; si no, se estima: el palo más largo = el 10% más largo
    # de tus tiros completos; los demás siguen la escalera de la tabla (ver LADDER).
    # Bolsa real de Paulo (15-nov-2026). En Garmin varios palos están retirados, así
    # que la lista manda aquí; el segundo valor liga el palo con su tipo en Garmin
    # para usar la distancia real cuando el reloj traiga el palo marcado.
    BAG = [("Driver", "Driver"), ("Madera 3", "3 Wood"),
           ("Hierro 4", "4 Iron"), ("Hierro 5", "5 Iron"), ("Hierro 6", "6 Iron"), ("Hierro 7", "7 Iron"),
           ("Hierro 8", "8 Iron"), ("Hierro 9", "9 Iron"), ("PW", "Pitching Wedge"), ("AW", "Gap Wedge"),
           ("Sand 52°", None), ("Sand 56°", "Sand Wedge")]
    garmin_ids = {club_types.get(c["clubTypeId"]): c["id"] for c in club_list if not c.get("deleted")}
    fs = sorted(full_shots)
    # Guía de distancias que mandó Paulo el 22-nov (columna de hombres, en yardas), tal
    # cual. Su SW es el 56°. No trae AW ni 52°: se reparten parejo entre el PW y el 56°.
    LADDER_YD = {"Driver": 230, "Madera 3": 215, "Hierro 4": 170, "Hierro 5": 160, "Hierro 6": 150,
                 "Hierro 7": 140, "Hierro 8": 130, "Hierro 9": 115, "PW": 105, "AW": 97,
                 "Sand 52°": 89, "Sand 56°": 80}
    est = {name: v * YD for name, v in LADDER_YD.items()}
    for name, extra in CLUB_UNRECORDED.items():
        dictated[name].extend(extra)
    clubs = []
    for name, gtype in BAG:
        real = club_shots.get(garmin_ids.get(gtype), []) if gtype else []
        clubs.append({
            "name": name,
            "m": round(st.median(real)) if len(real) >= 3 else round(est[name]),
            "source": "garmin" if len(real) >= 3 else "estimado",
            **({"model": "M4"} if name == "Driver" else {}),
            # Lo real de los golpes dictados va aparte: `m` sigue siendo la tabla, porque
            # el plan ordena la bolsa por distancia y un Driver de 153 m quedaría abajo
            # del Hierro 4 y se sugeriría para tirar a green.
            **({"dictated": {
                "n": len(dictated[name]),
                **({"range": CLUB_RANGE[name]} if len(dictated[name]) == 1 and name in CLUB_RANGE else {}),
                "median": round(st.median(v for v, _ in dictated[name])),
                "best": round(max(v for v, _ in dictated[name])),
                "byCourse": {w: sum(1 for _, c in dictated[name] if c == w)
                             for w in sorted({c for _, c in dictated[name]})},
            }} if dictated.get(name) else {}),
        })
    shots_pct = {k: round(fs[int(q * (len(fs) - 1))]) for k, q in (("p50", .5), ("p75", .75), ("p90", .9))} if fs else {}

    sg = []
    names = {"DRIVE": "Salida", "APPROACH": "Aproximación", "CHIP": "Chip", "PUTT": "Putt",
             "BUNKER": "Bunker", "RECOVERY": "Recuperación"}
    for r in stats.get("strokesGainedRatings", []):
        sg.append({
            "key": r["statShotType"],
            "name": names.get(r["statShotType"], r["statShotType"]),
            "you": r.get("playerStrokesGained"),
            "group": r.get("groupStrokesGained"),
            "trend": r.get("trend"),
        })

    data = {
        "player": "Paulo Tejeda C",
        "updated": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "handicap": hi,
        "courseHandicap18": ch18,
        "rounds": rounds,
        "numRounds": stats.get("numRounds"),
        "holesWithShots": len(holes),
        "course": {k: course[k] for k in ("name", "city", "par18", "rating18", "slope")},
        "personalPar9": sum(personal),
        "par9": sum(course["pars"][:9]),
        "avg9": avg9,
        "fairway": stats.get("roundStat", {}),
        "strokesGained": sg,
        "par3": p3,
        "par4": p4,
        "blowups": blowups,
        "savings": {"tee3": save_tee3, "short": save_short, "par4": save_p4, "damage": save_damage},
        "plan": plan,
        "clubs": clubs,
        "fullShots": {"n": len(fs), **shots_pct, "max": round(fs[-1]) if fs else None},
        "puttsTracked": any(r.get("playerStrokesGained") is not None for r in stats.get("strokesGainedRatings", []) if r["statShotType"] == "PUTT"),
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    print(f"OK → {OUT}  handicap {hi} · {len(rounds)} rondas · {len(holes)} hoyos con golpe por golpe")


if __name__ == "__main__":
    sys.exit(main())
