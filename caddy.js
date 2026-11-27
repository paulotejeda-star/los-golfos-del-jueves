/* Caddy PTC · estrategia para bajar handicap con los datos de Garmin de Paulo.
   Lee /caddy-data.json (lo genera caddy/caddy_sync.py) y pinta la pestaña #tab-caddy. */
(function () {
  'use strict';

  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt1 = (n) => Number(n).toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmt0 = (n) => Math.round(Number(n)).toLocaleString('es-MX');
  const pct = (n) => `${Math.round(n)}%`;
  const yd = (m) => Math.round(Number(m) * 1.0936);
  const mYd = (m) => `${fmt0(m)} m (${yd(m)} yd)`;
  // v2 (22-nov): tabla nueva. Los ajustes guardados contra la tabla anterior ya no aplican.
  const BAG_KEY = 'caddy_ptc_bolsa_v2';

  let data = null;
  let campos = [];
  let rendered = false;
  const COURSE_KEY = 'caddy_ptc_campo';
  const TEE_KEY = 'caddy_ptc_salida_';
  let courseKey = 'huerta';
  try { courseKey = localStorage.getItem(COURSE_KEY) || 'huerta'; } catch (e) { /* sin almacenamiento */ }
  let selectedHole = 1;
  const active = new Set();

  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const shortDate = (iso) => { const [, m, d] = iso.split('-'); return `${Number(d)}-${MONTHS[Number(m) - 1]}`; };

  // ---------- animación de números ----------
  function countUp(el, to, decimals, ms) {
    if (!el) return;
    const f = decimals ? fmt1 : fmt0;
    if (REDUCED) { el.textContent = f(to); return; }
    const from = Number(el.dataset.v || 0);
    const t0 = performance.now();
    const dur = ms || 1200;
    function step(t) {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = f(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step); else el.dataset.v = to;
    }
    requestAnimationFrame(step);
  }

  // ---------- escenas SVG animadas ----------
  function ball(path, color, dur, delay) {
    if (REDUCED) {
      const nums = path.match(/-?\d+(\.\d+)?/g) || [0, 0];
      return `<circle cx="${nums[nums.length - 2]}" cy="${nums[nums.length - 1]}" r="4" fill="${color}"/>`;
    }
    return `<circle r="4" fill="${color}" stroke="#fff" stroke-width="1">
      <animateMotion dur="${dur}s" begin="${delay}s" repeatCount="indefinite" path="${path}"
        keyPoints="0;1;1" keyTimes="0;0.55;1" calcMode="linear"/></circle>`;
  }

  const SCENES = {
    // Par 3: la salida se queda corta; con un palo más llega al green
    tee3: () => `
      <svg viewBox="0 0 300 120" class="cd-scene" role="img" aria-label="Con un palo más la bola llega al green">
        <rect x="0" y="0" width="300" height="120" fill="#0a2019"/>
        <ellipse cx="160" cy="70" rx="70" ry="34" fill="#14532d" opacity=".55"/>
        <ellipse cx="245" cy="62" rx="38" ry="24" fill="#22c55e" opacity=".85"/>
        <line x1="252" y1="62" x2="252" y2="34" stroke="#fef3c7" stroke-width="1.5"/>
        <path d="M252 34 L266 39 L252 44 Z" fill="#f59e0b"/>
        <circle cx="252" cy="62" r="3" fill="#052e22"/>
        <rect x="18" y="58" width="16" height="10" rx="2" fill="#1f4d3d"/>
        <path d="M26 62 Q110 -10 190 64" fill="none" stroke="#fb7185" stroke-width="1.5" class="cd-dash"/>
        <path d="M26 62 Q140 -30 246 62" fill="none" stroke="#34d399" stroke-width="1.5" class="cd-dash"/>
        ${ball('M26 62 Q110 -10 190 64', '#fb7185', 2.6, 0)}
        ${ball('M26 62 Q140 -30 246 62', '#34d399', 2.6, 1.3)}
        <text x="168" y="104" fill="#fb7185" font-size="10" font-weight="700">tu salida hoy</text>
        <text x="214" y="104" fill="#34d399" font-size="10" font-weight="700" dx="40">+1 palo</text>
      </svg>`,
    // Juego corto: rodar en vez de volar
    short: () => `
      <svg viewBox="0 0 300 120" class="cd-scene" role="img" aria-label="Golpe rodado hacia el hoyo">
        <rect x="0" y="0" width="300" height="120" fill="#0a2019"/>
        <rect x="0" y="86" width="300" height="34" fill="#14532d" opacity=".6"/>
        <rect x="110" y="86" width="190" height="34" fill="#22c55e" opacity=".8"/>
        <circle cx="240" cy="92" r="5" fill="#052e22"/>
        <circle cx="240" cy="92" r="9" fill="none" stroke="#34d399" class="cd-pulse"/>
        <line x1="240" y1="92" x2="240" y2="58" stroke="#fef3c7" stroke-width="1.5"/>
        <path d="M240 58 L254 63 L240 68 Z" fill="#f59e0b"/>
        <path d="M40 90 Q120 -10 200 92" fill="none" stroke="#fb7185" stroke-width="1.5" class="cd-dash"/>
        <path d="M40 90 Q80 66 118 90 L238 92" fill="none" stroke="#34d399" stroke-width="1.5" class="cd-dash"/>
        ${ball('M40 90 Q120 -10 200 92', '#fb7185', 2.4, 0)}
        ${ball('M40 90 Q80 66 118 90 L238 92', '#34d399', 2.4, 1.2)}
        <text x="96" y="30" fill="#fb7185" font-size="10" font-weight="700">globo: rebota y se pasa</text>
        <text x="20" y="112" fill="#052e22" font-size="10" font-weight="800" dx="110">rodada: hierro 8</text>
      </svg>`,
    // Par 4: apunta a la izquierda porque fallas a la derecha
    par4: () => `
      <svg viewBox="0 0 300 120" class="cd-scene" role="img" aria-label="Apuntar al lado izquierdo del fairway">
        <rect x="0" y="0" width="300" height="120" fill="#0a2019"/>
        <path d="M20 60 C90 20 200 20 280 60 C200 100 90 100 20 60 Z" fill="#14532d" opacity=".25"/>
        <rect x="20" y="40" width="250" height="40" rx="20" fill="#166534" opacity=".7"/>
        <ellipse cx="272" cy="60" rx="20" ry="16" fill="#22c55e"/>
        <circle cx="276" cy="60" r="2.5" fill="#052e22"/>
        <line x1="30" y1="60" x2="140" y2="44" stroke="#fef3c7" stroke-width="1.5" stroke-dasharray="3 4"/>
        <path d="M140 44 l-9 -1 l5 7 Z" fill="#fef3c7"/>
        <path d="M30 60 Q100 32 150 64" fill="none" stroke="#34d399" stroke-width="1.5" class="cd-dash"/>
        <path d="M30 60 Q100 60 150 96" fill="none" stroke="#fb7185" stroke-width="1.5" class="cd-dash"/>
        ${ball('M30 60 Q100 60 150 96', '#fb7185', 2.4, 0)}
        ${ball('M30 60 Q100 32 150 64', '#34d399', 2.4, 1.2)}
        <text x="96" y="30" fill="#fef3c7" font-size="10" font-weight="700">mira aquí (izquierda)</text>
        <text x="156" y="104" fill="#fb7185" font-size="10" font-weight="700">tu falla: derecha</text>
      </svg>`,
    // Control de daños: sacar de lado en vez de arriesgar
    damage: () => `
      <svg viewBox="0 0 300 120" class="cd-scene" role="img" aria-label="Sacar la bola a lo seguro">
        <rect x="0" y="0" width="300" height="120" fill="#0a2019"/>
        <rect x="0" y="62" width="300" height="34" fill="#166534" opacity=".7"/>
        <g fill="#14532d">${[60, 85, 110, 135].map((x) => `<path d="M${x} 58 l10 -26 l10 26 Z"/>`).join('')}</g>
        <ellipse cx="262" cy="78" rx="26" ry="14" fill="#22c55e"/>
        <circle cx="40" cy="30" r="4" fill="#fbbf24"/>
        <path d="M40 30 Q90 0 130 40" fill="none" stroke="#fb7185" stroke-width="1.5" class="cd-dash"/>
        <path d="M40 30 Q50 52 70 78" fill="none" stroke="#34d399" stroke-width="1.5" class="cd-dash"/>
        ${ball('M40 30 Q90 0 130 40', '#fb7185', 2.4, 0)}
        ${ball('M40 30 Q50 52 70 78', '#34d399', 2.4, 1.2)}
        <text x="138" y="30" fill="#fb7185" font-size="10" font-weight="700">héroe: árbol y 8 golpes</text>
        <text x="80" y="112" fill="#34d399" font-size="10" font-weight="700">de lado al fairway: sigues vivo</text>
      </svg>`,
  };

  // Hoyo dibujado según par y largo
  function holeSvg(h, teeLabel) {
    const long = h.par >= 4;
    const greenX = long ? 262 : 70 + Math.min(190, (h.len || 80) * 1.6);
    const teeDist = Math.min(greenX - 30, 30 + (h.tee || 60) * (long ? 1.0 : 1.6));
    const shortfall = (h.len || 0) - (h.tee || 0);
    return `
      <svg viewBox="0 0 300 110" class="cd-scene cd-pop" role="img" aria-label="Hoyo ${h.n}, par ${h.par}, ${fmt0(h.len)} metros">
        <rect width="300" height="110" fill="#0a2019"/>
        <rect x="24" y="${long ? 38 : 46}" width="${greenX - 24}" height="${long ? 34 : 18}" rx="${long ? 17 : 9}" fill="#166534" opacity="${long ? .75 : .35}"/>
        <ellipse cx="${greenX}" cy="55" rx="${long ? 22 : 20}" ry="16" fill="#22c55e"/>
        <circle cx="${greenX + 3}" cy="55" r="2.5" fill="#052e22"/>
        <line x1="${greenX + 3}" y1="55" x2="${greenX + 3}" y2="30" stroke="#fef3c7" stroke-width="1.5"/>
        <path d="M${greenX + 3} 30 l13 5 l-13 5 Z" fill="#f59e0b"/>
        <rect x="14" y="50" width="14" height="10" rx="2" fill="#1f4d3d"/>
        <path d="M21 55 Q${(21 + teeDist) / 2} 8 ${teeDist} 55" fill="none" stroke="${shortfall > 12 && !long ? '#fb7185' : '#fbbf24'}" stroke-width="1.5" class="cd-dash"/>
        ${ball(`M21 55 Q${(21 + teeDist) / 2} 8 ${teeDist} 55`, shortfall > 12 && !long ? '#fb7185' : '#fbbf24', 2.2, 0)}
        <text x="${Math.max(24, teeDist - 40)}" y="80" fill="#cbd5e1" font-size="10" font-weight="700">${teeLabel || 'tu salida'} ${fmt0(h.tee)} m / ${yd(h.tee)} yd</text>
        <text x="${Math.min(greenX - 40, 236)}" y="98" fill="#34d399" font-size="10" font-weight="700">${fmt0(h.len)} m / ${yd(h.len)} yd</text>
      </svg>`;
  }

  // ---------- bolsa y palo sugerido ----------
  let bag = [];
  // Factor de distancia del campo: tus palos están medidos en Puebla (~2,100 m); al nivel
  // del mar la bola vuela menos, así que el plan descuenta ese porcentaje.
  let distScale = 1;
  function loadBag() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(BAG_KEY) || '{}') || {}; } catch (e) { saved = {}; }
    // El 52° se llamaba «Sand 52°»: si lo habías ajustado, el ajuste se queda
    if (saved['Sand 52°'] != null && saved['Wedge 52°'] == null) saved['Wedge 52°'] = saved['Sand 52°'];
    bag = (data.clubs || []).map((c) => ({ ...c, est: c.m, m: Number(saved[c.name]) || c.m, edited: saved[c.name] != null && Number(saved[c.name]) !== c.m }));
  }
  function saveBag() {
    const out = {};
    bag.forEach((c) => { if (c.m !== c.est) out[c.name] = c.m; });
    try { localStorage.setItem(BAG_KEY, JSON.stringify(out)); } catch (e) { /* sin almacenamiento: queda en memoria */ }
  }
  // Reloj de wedges de la guía de Paulo (22-nov), en yardas con el 56°. La guía trae las 7
  // en 30 y en 15 yd según la fuerza: Paulo eligió 30, y por eso no va la fila de las 8 (30).
  // El 52° va en proporción a su golpe completo contra el del 56°.
  const WEDGE_CLOCK = [[10, 60], [9, 45], [7, 30]];
  // Holgura en metros: la bolsa guarda metros redondeados, y sin esto 140 yd (128.02 m) ya
  // no «alcanzaría» con el hierro 7 de 128 m que la misma tabla muestra como 140 yd.
  const REACH = 0.5;
  function clockShots() {
    const base = bag.find((c) => c.name === 'Sand 56°');
    if (!base) return [];
    return ['Sand 56°', 'Wedge 52°'].flatMap((name) => {
      const c = bag.find((x) => x.name === name);
      if (!c) return [];
      const k = c.m / base.est;
      return WEDGE_CLOCK.map(([hour, y]) => ({ name: `${name} a las ${hour}`, club: name, hour, yd: Math.round(y * k), m: (y / 1.0936) * k }));
    });
  }
  const shotLadder = () => [...bag, ...clockShots()].sort((a, b) => a.m - b.m);
  // El tiro de reloj más corto que alcanza. Si falta bastante menos que el más corto de
  // todos, es ese mismo reloj con menos fuerza.
  function clockPick(dist) {
    const byLen = clockShots().sort((a, b) => a.m - b.m);
    const s = byLen.find((c) => c.m + REACH >= dist) || byLen[byLen.length - 1];
    if (!s) return null;
    return s === byLen[0] && dist + 3 < s.m ? { ...s, name: `${s.name}, con menos fuerza` } : s;
  }
  // Para un chip que hay que volar
  function clockFor(dist) {
    const s = clockPick(dist / distScale);
    return s ? s.name : null;
  }
  // Un palo más: el más corto que llega y luego el siguiente más largo, porque tu
  // fallo es quedarte corto. Tope en el Híbrido 4: las maderas no son para tirar a green.
  function clubFor(dist) {
    dist /= distScale;
    const byLen = shotLadder();
    const i = byLen.findIndex((c) => c.m + REACH >= dist);
    if (i < 0) return byLen[byLen.length - 1];
    const cap = byLen.findIndex((c) => c.name === CAP_CLUB);
    const up = Math.min(i + 1, byLen.length - 1);
    return byLen[cap >= 0 && i <= cap ? Math.min(up, cap) : i];
  }
  // El palo justo: el más corto que alcanza (para cuando ya mediste lo que te falta)
  function clubExact(dist) {
    dist /= distScale;
    const byLen = shotLadder();
    return byLen.find((c) => c.m + REACH >= dist) || byLen[byLen.length - 1];
  }
  // Palo más largo para tirar a green, salida segura en par 4 y chip alrededor del green
  const CAP_CLUB = 'Híbrido 4';
  const SAFE_TEE = 'Híbrido 5';
  const CHIP_SHOT = 'Chipper, rodado como putt';
  function safeTee() {
    const c = bag.find((x) => x.name === SAFE_TEE);
    return c ? { name: c.name, m: Math.round(c.m * distScale) } : null;
  }
  function steadyClub() {
    return bag.find((c) => c.name === 'Hierro 7') || bag[Math.floor(bag.length / 2)];
  }
  // Salida con el M4 a su distancia real (mediana de tus golpes). Si ajustaste el Driver en
  // «Tu bolsa» manda tu ajuste. La mediana no se escala por campo: ya viene casi toda de
  // nivel del mar. El Driver sigue fuera de clubFor: no es palo para tirar a green.
  function driverTee() {
    const c = bag.find((x) => x.name === 'Driver');
    if (!c) return null;
    const real = c.dictated && c.dictated.median;
    return { name: `${c.name}${c.model ? ` ${c.model}` : ''}`, m: Math.round(!c.edited && real ? real : c.m * distScale) };
  }
  // Par 4 y 5: salida con el M4 y de ahí al green. Si el hoyo es más corto que tu salida,
  // no hace falta el Driver y queda el plan con hierros. En los hoyos para cuidar del grupo
  // la salida es con el Híbrido 5: más fácil de pegar derecho que el M4.
  function longHoleSteps(len, labels, careful) {
    const d = (careful && safeTee()) || driverTee();
    if (!d || len <= d.m) return stepsFrom(len, labels, false);
    const left = len - d.m;
    return [{ label: labels[0], club: d.name, shot: d.m, left }, ...stepsFrom(left, labels.slice(1), true)];
  }
  // Pasos del hoyo: palo, distancia del golpe y lo que queda al hoyo
  function holeSteps(h) {
    const len = h.len || 0;
    if (!bag.length || !len) return [];
    if (h.par === 3) {
      const c = clubFor(len);
      return [{ label: (groupHole(h.n) || {}).mode === 'ataca' ? 'Salida a la bandera' : 'Salida al centro del green', club: c.name, shot: len, left: 0 }];
    }
    // Par 4: salida con el M4 (Paulo, 22-nov), o con el Híbrido 5 si el hoyo es para cuidar;
    // hierro 7 si todavía no alcanzas, y al green con un palo más (o chipper si quedan 30 m o menos).
    return longHoleSteps(len, ['Salida', 'Segundo', 'Tercero', 'Cuarto', 'Quinto', 'Sexto', 'Séptimo'], (groupHole(h.n) || {}).mode === 'cuida');
  }
  // Golpes desde una distancia: hierro 7 mientras no alcances, luego un palo más al
  // green, o el chipper con golpe de putt si quedan 30 m o menos.
  function stepsFrom(dist, labels, chipFirst, exact) {
    const st = steadyClub();
    const steps = [];
    let left = dist;
    while (left > 0 && steps.length < 6) {
      const label = labels[steps.length] || `Golpe ${steps.length + 1}`;
      if (left <= 30 && (chipFirst || steps.length)) {
        steps.push({ label: 'Al green', club: CHIP_SHOT, alt: clockFor(left), shot: left, left: 0 });
        left = 0;
      } else if (left > st.m * distScale + REACH) {
        const m = Math.round(st.m * distScale);
        left -= m;
        steps.push({ label, club: st.name, shot: m, left });
      } else {
        steps.push({ label: 'Al green', club: (exact ? clubExact(left) : clubFor(left)).name, shot: left, left: 0 });
        left = 0;
      }
    }
    return steps;
  }

  // ---------- tu juego en el grupo: HC del grupo en La Huerta ----------
  // /caddy-grupo.json lo llenas tú (caddy_sync.py no lo toca). Los golpes caen por la
  // dificultad de la tarjeta de La Huerta (plan[].index): con HC 16 en 9 hoyos te toca 1
  // en cada hoyo y un segundo golpe en los 7 más difíciles.
  let grupo = null;
  let gpCache = null;
  const MODES = {
    ataca: { icon: '🔥', label: 'Ataca' },
    centro: { icon: '🎯', label: 'Al centro' },
    cuida: { icon: '🛡️', label: 'Cuida' },
  };
  // Cuánto vale cada logro en Puntajes (lo que tengas guardado en ⚙️ Puntos)
  function pointRules() {
    const base = { holeWin: 2, par: 1, birdie: 3, oyes: 2 };
    try {
      const saved = window.GolfosScore && window.GolfosScore.rules ? window.GolfosScore.rules() : null;
      return { ...base, ...(saved || {}) };
    } catch (e) { return base; }
  }
  // Modo de cada hoyo, con reglas que salen de tus números:
  //   Cuida  → par 4, o promedias 2.5 o más sobre par (tarjeta del grupo o Garmin, la peor),
  //            o el hoyo es más largo que tu golpe completo del 90%.
  //   Ataca  → par 3 corto para ti (hasta la mitad entre tu golpe típico y el de tus mejores
  //            3 de 4) donde ya hiciste par.
  //   Al centro → todo lo demás.
  function groupPlan() {
    if (!grupo || !(grupo.hc > 0) || !data || !data.plan || data.plan.some((h) => h.index == null)) return null;
    if (gpCache) return gpCache;
    const n = data.plan.length;
    const order = [...data.plan].sort((a, b) => a.index - b.index).map((h) => h.n);
    const fs = data.fullShots || {};
    const shortMax = fs.p50 && fs.p75 ? (fs.p50 + fs.p75) / 2 : 90;
    const pars = new Set(grupo.parsOn || []);
    gpCache = data.plan.map((h) => {
      const rank = order.indexOf(h.n) + 1;
      const strokes = Math.floor(grupo.hc / n) + (rank <= grupo.hc % n ? 1 : 0);
      const gAvg = grupo.holeAvg && grupo.holeAvg[h.n] != null ? grupo.holeAvg[h.n] : null;
      const avgs = [h.avg, gAvg].filter((v) => v != null);
      const worst = avgs.length ? Math.max(...avgs) : null;
      const madePar = (h.best != null && h.best <= h.par) || pars.has(h.n);
      let mode = 'centro';
      let why;
      if (h.par >= 4) { mode = 'cuida'; why = `par ${h.par} de ${fmt0(h.len)} m, dificultad ${h.index} de 18`; }
      else if (worst != null && worst >= h.par + 2.5) { mode = 'cuida'; why = `aquí promedias ${fmt1(worst)} en un par ${h.par}`; }
      else if (fs.p90 && h.len > fs.p90) { mode = 'cuida'; why = `mide ${fmt0(h.len)} m, más que casi todos tus golpes completos`; }
      else if (h.par === 3 && h.len <= shortMax && madePar) { mode = 'ataca'; why = `mide ${fmt0(h.len)} m y aquí ya hiciste par`; }
      else why = h.len > shortMax ? `mide ${fmt0(h.len)} m, largo para tirarle a la bandera` : 'todavía no te sale el par aquí';
      return { n: h.n, par: h.par, len: h.len, index: h.index, rank, strokes, net: h.par + strokes, cap: h.par + 2 + strokes, gAvg, worst, madePar, mode, why };
    });
    return gpCache;
  }
  const groupHole = (n) => { const gp = groupPlan(); return gp ? gp.find((g) => g.n === n) : null; };
  // Tu meta en un hoyo de La Huerta: par neto del grupo si lo hay; si no, el par personal de Garmin
  const metaOf = (h) => { const g = groupHole(h.n); return g ? g.net : h.personalPar; };
  const overName = (k) => (k === 1 ? 'el bogey' : k === 2 ? 'el doble bogey' : `${k} sobre par`);
  // Una línea para la pantalla En vivo
  const cap1 = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  function groupLine(g) {
    if (g.mode === 'ataca') return `${cap1(g.why)}. Bandera con un palo más; el O'yes vale +${pointRules().oyes}.`;
    if (g.mode === 'cuida') return `${cap1(g.why)}. Bola en juego y al centro del green, sin números grandes. ${g.net} es par neto.`;
    return `Centro del green y dos putts. ${g.net} es par neto.`;
  }
  // El consejo completo del hoyo
  function groupTip(g) {
    const r = pointRules();
    const st = `Recibes ${g.strokes} golpe${g.strokes === 1 ? '' : 's'}, así que ${g.net} es tu par neto`;
    if (g.mode === 'ataca') return `Hoyo para atacar: ${g.why}. Tira a la bandera con un palo más. Si la salida queda en green peleas el O'yes (+${r.oyes}) y el par te da +${r.par}; si se queda en el collar, chipper para dejarla cerca. ${st} y ${g.par} sería birdie neto.`;
    if (g.mode === 'cuida') {
      const tee = g.par >= 4 && safeTee() ? `Sal con el ${safeTee().name}: es más fácil de pegar derecho que el M4. ` : 'Salida en juego, ';
      return `Hoyo para cuidar el número: ${g.why}. ${st} y ${g.net + 1} todavía es bogey neto. ${tee}${tee.endsWith(', ') ? 'al' : 'Al'} centro del green y nada de golpes de héroe; si quedas corto, chipper y dos putts. Tu tope es ${g.cap}: si ya vas en ${g.net} sin embocar, juega solo a terminar.`;
    }
    return `Al centro del green con un palo más y dos putts (${g.why}). ${st}: con eso cumples.`;
  }
  const andList = (t) => (t.length > 1 ? `${t.slice(0, -1).join(', ')} y ${t[t.length - 1]}` : t[0] || '');

  // Tarjeta «Tu juego en el grupo» de Mi plan
  function renderGroup() {
    const gp = groupPlan();
    if (!gp) return '';
    const r = pointRules();
    const n = gp.length;
    const sum = (k) => gp.reduce((a, g) => a + g[k], 0);
    const net9 = sum('net');
    const par9 = sum('par');
    const base = Math.floor(grupo.hc / n);
    const extra = grupo.hc % n;
    const last = (grupo.last || []).filter((x) => x > 0);
    const gap = last.length ? Math.min(...last) - net9 : null;
    const netIs = (arr) => {
      const ks = [...new Set(arr.map((g) => g.strokes))];
      return ks.length === 1 ? `Ahí ${overName(ks[0])} ya es par neto.` : 'Tu par neto de cada uno está en la tabla.';
    };
    const text = {
      ataca: () => `Cortos para ti y ahí ya hiciste par. Bandera con un palo más: de aquí salen el O'yes (+${r.oyes}) y el par (+${r.par}).`,
      cuida: (arr) => {
        const p4 = arr.filter((g) => g.par >= 4);
        const tee = p4.length && safeTee() ? ` En ${andList(p4.map((g) => `el H${g.n}`))} sal con el ${safeTee().name}.` : '';
        return `Aquí se te van los números grandes. ${netIs(arr)}${tee} Bola en juego, al centro del green y, si quedas corto, chipper y dos putts. Nunca pases del tope.`;
      },
      centro: (arr) => `Un palo más al centro del green y dos putts. ${netIs(arr)}`,
    };
    const tile = (v, label, cls) => `<div class="bg-[#0a2019] rounded-xl py-2"><div class="text-lg font-extrabold ${cls} cd-big leading-tight">${v}</div><div class="text-[10px] cd-muted leading-tight">${label}</div></div>`;
    const row = (label, cell, total) => `<tr class="border-t border-emerald-900/60"><th scope="row" class="text-left font-semibold cd-muted py-1.5 pl-2 pr-1 whitespace-nowrap">${label}</th>${gp.map(cell).join('')}<td class="font-extrabold text-white pr-2 pl-1">${total}</td></tr>`;
    const [y, m, d] = String(grupo.updated || '').split('-');
    const asOf = d ? `${Number(d)}-${MONTHS[Number(m) - 1]}-${y}` : '';
    return `
      <div class="cd-card cd-reveal">
        <div class="cd-kicker">🏆 Tu juego en el grupo${grupo.app ? ` · ${grupo.app}` : ''}</div>
        <h2 class="text-lg font-extrabold text-white leading-tight mt-1">Dónde atacar y dónde cuidar con tu HC ${grupo.hc}</h2>
        <div class="grid grid-cols-4 gap-2 mt-3 text-center">
          ${tile(grupo.hc, 'tu HC<br>del grupo', 'text-white')}
          ${grupo.rank ? tile(`${grupo.rank}<span class="text-[11px] cd-muted font-bold">/${grupo.players}</span>`, 'tu lugar<br>en el grupo', 'text-amber-300') : ''}
          ${grupo.avgGross ? tile(fmt1(grupo.avgGross), `promedio<br>neto ${fmt1(grupo.avgNet)}`, 'text-rose-300') : ''}
          ${tile(net9, 'meta: par<br>neto en 9', 'text-emerald-300')}
        </div>
        <div class="overflow-x-auto mt-3 rounded-xl bg-[#0a2019]">
          <table class="w-full text-[11px] text-center cd-big">
            <caption class="sr-only">Golpes, par neto, tope y plan de cada hoyo de La Huerta con tu HC del grupo</caption>
            <thead><tr><th scope="col" class="text-left font-semibold cd-muted py-1.5 pl-2">Hoyo</th>${gp.map((g) => `<th scope="col" class="font-extrabold text-white px-0.5">${g.n}</th>`).join('')}<th scope="col" class="font-semibold cd-muted pr-2 pl-1">Total</th></tr></thead>
            <tbody>
              ${row('Par', (g) => `<td class="text-slate-200">${g.par}</td>`, par9)}
              ${row('Recibes', (g) => `<td class="${g.strokes > base ? 'text-amber-300 font-bold' : 'text-slate-300'}">${g.strokes}</td>`, grupo.hc)}
              ${row('Par neto', (g) => `<td class="font-extrabold text-emerald-300">${g.net}</td>`, net9)}
              ${row('Tope', (g) => `<td class="text-rose-300">${g.cap}</td>`, '')}
              ${row('Plan', (g) => `<td class="cd-m-${g.mode} py-1" title="${MODES[g.mode].label}">${MODES[g.mode].icon}</td>`, '')}
            </tbody>
          </table>
        </div>
        <div class="space-y-2 mt-3">
          ${['ataca', 'cuida', 'centro'].map((k) => {
            const arr = gp.filter((g) => g.mode === k);
            return arr.length ? `<div class="cd-mode cd-mode-${k}"><b>${MODES[k].icon} ${MODES[k].label}: ${andList(arr.map((g) => `H${g.n}`))}.</b> ${text[k](arr)}</div>` : '';
          }).join('')}
        </div>
        ${gap != null ? `<p class="text-[12px] text-emerald-300 mt-3 leading-snug font-semibold">${gap > 0
          ? `Promedias ${fmt1(grupo.avgGross)} y tus últimas fueron ${andList(last.map(String))}: te falta${gap === 1 ? '' : 'n'} ${gap} golpe${gap === 1 ? '' : 's'} para tu meta de ${net9}.`
          : `Tus últimas fueron ${andList(last.map(String))}: ya estás en tu meta de ${net9}. Ahora el chiste es repetirla.`}</p>` : ''}
        <p class="text-[11px] cd-muted mt-2 leading-snug"><b class="text-slate-200">Cómo caen tus golpes</b>: con HC ${grupo.hc} en ${n} hoyos recibes ${base} en cada hoyo${extra ? ` y uno más en los ${extra} más difíciles según la tarjeta de La Huerta (dificultad 1 = el más difícil)` : ''}. <b class="text-slate-200">Par neto</b> = par + tus golpes; si lo haces en los ${n} tiras ${net9} (par ${par9} + ${grupo.hc}). <b class="text-slate-200">Tope</b> = par neto + 2: arriba de eso el hoyo ya no cuenta para tu handicap, pero en el torneo te sigue costando.</p>
        <p class="text-[10px] cd-muted mt-2">Datos del grupo${asOf ? ` al ${asOf}` : ''}${grupo.app ? ` (${grupo.app})` : ''}. La dificultad de cada hoyo es la de la tarjeta de La Huerta en Garmin; confírmala con la tarjeta del club.</p>
      </div>`;
  }

  // Recuadro del modo en el detalle de cada hoyo de Mi plan
  function renderGroupHole(g) {
    if (!g) return '';
    const m = MODES[g.mode];
    return `
      <div class="cd-mode cd-mode-${g.mode} mt-3">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <b class="text-sm">${m.icon} ${m.label}</b>
          <span class="text-[11px] font-bold cd-big">recibes ${g.strokes} · par neto ${g.net} · tope ${g.cap}</span>
        </div>
        <p class="mt-1">${groupTip(g)}</p>
      </div>`;
  }

  // ---------- consejos ----------
  function holeTip(h) {
    const right = data.fairway && data.fairway.percentFairwayRight;
    if (h.par === 4) {
      const s = holeSteps(h);
      const first = s[0] && /^(Driver|Híbrido)/.test(s[0].club) ? `Salida con ${/^Driver/.test(s[0].club) ? 'tu' : 'el'} ${s[0].club} a ${mYd(s[0].shot)}` : 'Salida recta';
      const last = s.length ? s[s.length - 1].club.replace(/^Chip/, 'chip') : 'un palo más';
      return `${first} y al green con ${last}. Apunta al lado izquierdo: ${pct(right)} de tus salidas se van a la derecha. Si haces ${metaOf(h)}, ganaste el hoyo contra tu handicap.`;
    }
    const short = (h.len || 0) - (h.tee || 0);
    // En los hoyos para atacar del grupo se tira a la bandera; en los demás, al centro
    const attack = (groupHole(h.n) || {}).mode === 'ataca';
    if (short >= 12) {
      return `Te quedas corto: tu salida promedia ${mYd(h.tee)} y el hoyo mide ${mYd(h.len)}. Toma un palo más y ${attack ? 'apunta a la bandera: con ese palo ya llegas' : 'apunta al centro del green, no a la bandera'}.`;
    }
    if ((h.inside || 0) >= 3.5) {
      return `Llegas cerca, pero gastas ${fmt1(h.inside)} golpes desde 30 m. Rueda la bola con el chipper, con golpe de putt, y busca dejar un putt corto.`;
    }
    return attack
      ? `Es de tus hoyos buenos y aquí se pelea el par. Un palo más a la bandera y dos putts. Tu meta aquí es ${metaOf(h)}.`
      : `Es de tus hoyos buenos. Repite la rutina: centro del green y dos putts. Tu meta aquí es ${metaOf(h)}.`;
  }

  // ---------- render ----------
  function render(root) {
    const d = data;
    const sv = d.savings;
    const plays = [
      { key: 'short', icon: '🎯', title: 'Dentro de 30 m: rueda, no vueles', save: sv.short,
        why: `Desde 30 m (33 yd) usas ${fmt1(d.par3.insideAvg)} golpes en los par 3. Un buen jugador de tu nivel usa 3. Chipper con golpe de putt y a embocar.` },
      { key: 'tee3', icon: '🏌️', title: 'Par 3: un palo más', save: sv.tee3,
        why: `Tus salidas promedian ${mYd(d.par3.teeDist)} en hoyos de ${mYd(d.par3.holeLen)}. Solo ${d.par3.teeOnGreen} de ${d.par3.n} cayeron en green; ${d.par3.teeRough} se fueron al rough.` },
      { key: 'par4', icon: '↖️', title: 'Par 4: salida en juego y wedge, apunta a la izquierda', save: sv.par4,
        why: `Promedias ${fmt1(d.par4.avgStrokes)} golpes en los par 4. ${pct(d.fairway.percentFairwayRight)} de tus salidas fallan a la derecha y ${pct(d.fairway.percentFairwayLeft)} a la izquierda.` },
      { key: 'damage', icon: '🛟', title: 'Control de daños: nada de golpes de héroe', save: sv.damage,
        why: `${d.blowups} de tus ${d.holesWithShots} hoyos terminaron en 4 o más sobre par. Desde problemas, saca de lado al fairway y olvida el árbol.` },
    ].filter((p) => p.save > 0);

    const sg = (d.strokesGained || []).filter((s) => s.you != null)
      .map((s) => ({ ...s, gap: s.you - s.group }))
      .sort((a, b) => a.gap - b.gap);
    const sgMax = Math.max(...sg.map((s) => Math.max(Math.abs(s.you), Math.abs(s.group))), 0.1);
    const noData = (d.strokesGained || []).filter((s) => s.you == null).map((s) => s.name);

    const updated = new Date(d.updated);
    // La mejor ronda de 9 hoyos que sí fue tu juego, en La Huerta
    const bestRound = d.rounds.filter((r) => r.holes === 9 && !r.excluded && !r.course)
      .reduce((b, r) => (!b || r.strokes < b.strokes ? r : b), null);
    const updatedTxt = `${updated.getDate()}-${MONTHS[updated.getMonth()]}-${updated.getFullYear()}`;

    root.innerHTML = `
      <!-- 1. Tu número -->
      <div class="cd-card cd-reveal relative overflow-hidden">
        <div class="absolute -right-16 -top-16 w-56 h-56 rounded-full bg-emerald-500/10 blur-2xl" aria-hidden="true"></div>
        <div class="flex flex-col sm:flex-row items-center gap-3 sm:gap-4 text-center sm:text-left">
          <svg viewBox="0 0 120 120" class="w-32 h-32 shrink-0" role="img" aria-label="Handicap ${fmt1(d.handicap)}">
            <defs><linearGradient id="cdRingGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs>
            <circle cx="60" cy="60" r="50" fill="none" stroke-width="10" class="cd-ring-track"/>
            <circle id="cdRing" cx="60" cy="60" r="50" fill="none" stroke-width="10" class="cd-ring-bar"
              stroke-dasharray="314.16" stroke-dashoffset="314.16" transform="rotate(-90 60 60)"/>
            <text x="60" y="62" text-anchor="middle" fill="#fff" font-size="28" font-weight="800" class="cd-big"><tspan id="cdHcp">0</tspan></text>
            <text x="60" y="80" text-anchor="middle" fill="#94a3b8" font-size="9" font-weight="600">HANDICAP</text>
          </svg>
          <div class="min-w-0 w-full">
            <div class="cd-kicker">🎯 Caddy PTC</div>
            <h2 class="text-xl font-extrabold text-white leading-tight mt-1">Tu plan para bajar el handicap</h2>
            <p class="text-xs cd-muted mt-1">Handicap que calcula Garmin con ${d.numRounds} rondas en ${d.course.name}.</p>
            <div class="grid grid-cols-3 gap-2 mt-3 text-center">
              <div class="bg-[#0a2019] rounded-xl py-2"><div class="text-lg font-extrabold text-rose-300 cd-big" id="cdAvg9">0</div><div class="text-[10px] cd-muted leading-tight">tu promedio<br>en 9 hoyos</div></div>
              <div class="bg-[#0a2019] rounded-xl py-2"><div class="text-lg font-extrabold text-amber-300 cd-big" id="cdGoal">0</div><div class="text-[10px] cd-muted leading-tight">meta del<br>Caddy</div></div>
              <div class="bg-[#0a2019] rounded-xl py-2"><div class="text-lg font-extrabold text-emerald-300 cd-big" id="cdPP">0</div><div class="text-[10px] cd-muted leading-tight">tu par<br>personal</div></div>
            </div>
          </div>
        </div>
        <p class="text-[11px] cd-muted mt-3 leading-snug"><b class="text-slate-200">Par personal</b>: lo que alguien con tu handicap debería tirar en 9 hoyos de ${d.course.name} (par ${d.par9} más los golpes que te da tu handicap). Cada vez que lo igualas, tu handicap baja.</p>
      </div>

      ${renderGroup()}

      <!-- 2. Simulador de jugadas -->
      <div class="cd-card cd-reveal">
        <div class="flex items-end justify-between gap-3">
          <div>
            <div class="cd-kicker">Las jugadas del Caddy</div>
            <p class="text-sm text-white font-semibold mt-1">Toca cada jugada y mira cuánto baja tu ronda de 9 hoyos</p>
          </div>
          <div class="text-right shrink-0">
            <div class="text-4xl font-black text-white cd-big leading-none" id="cdSim">${fmt0(d.avg9)}</div>
            <div class="text-[10px] cd-muted">golpes en 9 hoyos</div>
          </div>
        </div>
        <div class="relative h-3 rounded-full bg-[#0a2019] mt-3 overflow-hidden" aria-hidden="true">
          <div id="cdSimBar" class="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-rose-500 to-amber-400" style="width:100%;transition:width .8s cubic-bezier(.2,.8,.2,1)"></div>
          <div class="absolute inset-y-0 w-0.5 bg-emerald-300" style="left:${(d.personalPar9 / d.avg9) * 100}%"></div>
        </div>
        <div class="flex justify-between text-[10px] cd-muted mt-1"><span>0</span><span class="text-emerald-300">par personal ${d.personalPar9}</span><span>${fmt0(d.avg9)} hoy</span></div>
        <div class="grid sm:grid-cols-2 gap-3 mt-4">
          ${plays.map((p) => `
            <button type="button" class="cd-play text-left rounded-2xl border border-emerald-900/70 bg-[#0a2019] p-3" data-play="${p.key}" aria-pressed="false">
              <div class="flex items-start gap-2">
                <span class="cd-check mt-0.5 w-5 h-5 rounded-full border-2 border-emerald-400 flex items-center justify-center text-[11px] text-[#052e22] font-black shrink-0">✓</span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-bold text-white text-sm leading-tight">${p.icon} ${p.title}</span>
                    <span class="shrink-0 text-xs font-extrabold text-emerald-300 bg-emerald-500/15 rounded-full px-2 py-0.5">−${fmt1(p.save)}</span>
                  </div>
                  <p class="text-[11px] cd-muted mt-1 leading-snug">${p.why}</p>
                </div>
              </div>
              <div class="mt-2">${SCENES[p.key]()}</div>
            </button>`).join('')}
        </div>
        <p class="text-[10px] cd-muted mt-3">El −número es lo que el Caddy estima que ahorras por cada 9 hoyos con esa jugada, sacado de tus golpes en Garmin.</p>
      </div>

      <!-- 3. Dónde se te van los golpes -->
      <div class="cd-card cd-reveal">
        <div class="cd-kicker">¿Dónde se te van los golpes?</div>
        <p class="text-sm text-white font-semibold mt-1">Golpes que pierdes por ronda en cada tipo de tiro, contra golfistas de tu nivel</p>
        <div class="flex gap-3 text-[10px] cd-muted mt-2"><span class="flex items-center gap-1"><i class="w-3 h-2 rounded-full cd-bar-you inline-block"></i>tú</span><span class="flex items-center gap-1"><i class="w-3 h-2 rounded-full cd-bar-group inline-block"></i>tu nivel</span></div>
        <div class="space-y-3 mt-3">
          ${sg.map((s) => `
            <div>
              <div class="flex justify-between text-xs"><span class="font-bold text-white">${s.name}</span>
                <span class="${s.gap < 0 ? 'text-rose-300' : 'text-emerald-300'} font-semibold">${s.gap < 0 ? `pierdes ${fmt1(-s.gap)} más` : `tu fuerte: ${fmt1(s.gap)} mejor`}</span></div>
              <div class="flex items-center gap-2 mt-1"><div class="h-2.5 flex-1 bg-[#0a2019] rounded-full"><div class="cd-bar ${s.gap < 0 ? 'cd-bar-you' : 'cd-bar-good'}" data-w="${(Math.abs(s.you) / sgMax) * 100}"></div></div><span class="w-9 text-right text-[11px] font-bold text-slate-200 cd-big">${fmt1(Math.abs(s.you))}</span></div>
              <div class="flex items-center gap-2 mt-1"><div class="h-1.5 flex-1 bg-[#0a2019] rounded-full"><div class="cd-bar cd-bar-group" data-w="${(Math.abs(s.group) / sgMax) * 100}"></div></div><span class="w-9 text-right text-[10px] cd-muted cd-big">${fmt1(Math.abs(s.group))}</span></div>
            </div>`).join('')}
        </div>
        ${noData.length ? `<p class="text-[11px] text-amber-300/90 mt-3">Sin dato: ${noData.join(', ')}. Marca los putts en el reloj al terminar cada hoyo y el Caddy los medirá.</p>` : ''}
      </div>

      <!-- 4. Plan hoyo por hoyo -->
      <div class="cd-card cd-reveal">
        <div class="cd-kicker">Plan hoyo por hoyo · ${d.course.name}</div>
        <div class="flex gap-2 overflow-x-auto no-scrollbar py-2 mt-1" role="group" aria-label="Elige hoyo">
          ${d.plan.map((h) => `<button type="button" class="cd-hole-btn shrink-0" data-hole="${h.n}" aria-pressed="${h.n === selectedHole}">${h.n}</button>`).join('')}
        </div>
        <div id="cdHole"></div>
        <div class="mt-4">
          <p class="text-xs font-bold text-white">Tu promedio contra ${groupPlan() ? `tu par neto en el grupo (HC ${grupo.hc})` : 'tu par personal'}, por hoyo</p>
          <div class="flex items-end gap-1.5 h-36 mt-2" id="cdHoleBars">
            ${d.plan.map((h) => {
              const max = Math.max(...d.plan.map((x) => x.avg || 0), 1) + 0.5;
              const meta = metaOf(h);
              const g = groupHole(h.n);
              const over = (h.avg || 0) > meta;
              return `<button type="button" class="flex-1 flex flex-col items-center justify-end h-full relative" data-hole="${h.n}" aria-label="Hoyo ${h.n}: promedio ${fmt1(h.avg)}, ${g ? `par neto ${meta}, ${MODES[g.mode].label}` : `par personal ${meta}`}">
                <span class="text-[10px] font-bold ${over ? 'text-rose-300' : 'text-emerald-300'} cd-big">${h.avg != null ? fmt1(h.avg) : 's/d'}</span>
                <div class="w-full relative flex items-end" style="height:78%">
                  <div class="absolute left-0 right-0 z-10 border-t-2 border-dashed border-emerald-200" style="bottom:${(meta / max) * 100}%"></div>
                  <div class="cd-col w-full rounded-t-md ${over ? 'bg-gradient-to-t from-rose-600 to-rose-400' : 'bg-gradient-to-t from-emerald-600 to-emerald-400'}" data-h="${((h.avg || 0) / max) * 100}"></div>
                </div>
                <span class="text-[10px] cd-muted mt-1">${h.n}</span>
                ${g ? `<span class="text-[11px] leading-none" aria-hidden="true">${MODES[g.mode].icon}</span>` : ''}
              </button>`;
            }).join('')}
          </div>
          <p class="text-[10px] cd-muted mt-1">${groupPlan() ? 'Línea punteada verde = tu par neto en el grupo. Barra roja = ahí estás arriba de tu meta. 🔥 ataca · 🎯 al centro · 🛡️ cuida.' : 'Línea punteada verde = tu par personal en ese hoyo. Barra roja = ahí estás arriba de tu meta.'}</p>
        </div>
      </div>

      <!-- 4b. Tu bolsa -->
      <div class="cd-card cd-reveal">
        <div class="flex items-center justify-between gap-2">
          <div class="cd-kicker">Tu bolsa · cuánto mandas cada palo</div>
          <button type="button" id="cdBagReset" class="text-[11px] text-emerald-300 underline">Volver a la tabla</button>
        </div>
        <div id="cdBag" class="space-y-1.5 mt-3"></div>
        ${(data.clubs || []).filter((c) => c.dictated).map((c) => {
          const r = c.dictated;
          const donde = Object.entries(r.byCourse).map(([w, n]) => `${n} en ${w}`).join(', ');
          return r.n >= 3
            ? `<p class="text-[11px] text-emerald-300 mt-3 leading-snug"><b>${c.name}${c.model ? ` ${c.model}` : ''}, tus golpes reales:</b> ${r.n} ${c.name === 'Driver' ? 'salidas' : 'golpes'} (${donde}). La mediana es ${r.median} m / ${yd(r.median)} yd y la mejor ${r.best} m / ${yd(r.best)} yd. ${c.name === 'Driver' ? 'Tu plan de salida usa esa mediana; si ajustas el Driver con − y +, usa tu ajuste.' : 'Es lo que anotaste; el plan de este palo sigue con la distancia de la guía.'}</p>`
            : `<p class="text-[11px] text-emerald-300 mt-1 leading-snug"><b>${c.name}:</b> ${r.n} golpe${r.n === 1 ? '' : 's'} anotado${r.n === 1 ? '' : 's'} (${donde}), ${r.range || `${r.median} m`} según lo que anotaste. Con 3 o más ya sale su distancia.</p>`;
        }).join('')}
        <p class="text-[11px] cd-muted mt-3 leading-snug">${(data.clubs || []).some((c) => c.source === 'estimado')
          ? `Distancias de la guía que mandaste (columna de hombres). La guía no trae el AW ni el 52°: quedan repartidos parejo entre el PW y el 56°. Los híbridos 4 y 5 toman la fila del hierro que reemplazan hasta que marques 3 golpes con cada uno. El plan ya te da un palo más del que alcanza, porque tu fallo es quedarte corto. Si un palo no te cuadra, ajústalo con − y + (se guarda en tu teléfono) y el plan de cada hoyo se recalcula. Si marcas el palo en el reloj después de cada golpe, el Caddy usará tus distancias reales.`
          : 'Distancias reales: la mediana de tus golpes con cada palo marcado en el reloj.'} PW = pitching wedge y AW = approach wedge; el 52° también es de aproximación y el 56° es el de arena. El chipper es para rodar la bola desde fuera del green con golpe de putt.</p>
      </div>

      <!-- 5. Progreso -->
      <div class="cd-card cd-reveal">
        <div class="cd-kicker">Tu progreso</div>
        <p class="text-sm text-white font-semibold mt-1">Golpes sobre par por hoyo en cada ronda (más bajo es mejor)</p>
        <div id="cdProgress" class="overflow-x-auto overflow-y-hidden mt-3">
        <div class="flex items-end gap-2 h-36" style="min-width:${d.rounds.length * 38}px">
          ${d.rounds.map((r) => {
            const max = Math.max(...d.rounds.map((x) => x.overPerHole || 0), 1);
            const off = r.excluded || r.course;
            const isBest = r === bestRound;
            return `<div class="flex-1 min-w-0 flex flex-col items-center justify-end h-full" title="${off ? (r.excluded || r.course) : ''}">
              <span class="text-[10px] font-bold ${r.excluded ? 'text-slate-500 line-through' : 'text-slate-100'} cd-big">+${fmt1(r.overPerHole)}</span>
              ${isBest ? '<span class="text-[11px] cd-pop" aria-label="Tu mejor ronda de 9 hoyos">🏆</span>' : ''}
              <div class="cd-col w-full rounded-t-md ${r.excluded ? 'bg-slate-600/60 border border-dashed border-slate-400' : isBest ? 'bg-gradient-to-t from-emerald-600 to-emerald-300' : r.course ? 'bg-gradient-to-t from-sky-700 to-sky-400' : 'bg-gradient-to-t from-amber-600 to-amber-300'}" data-h="${(r.overPerHole / max) * 78}"></div>
              <span class="text-[9px] cd-muted mt-1 text-center leading-tight">${shortDate(r.date)}<br>${r.excluded ? 'no fue tu juego' : isBest ? `<b class="text-emerald-300">${r.strokes} golpes</b>` : `${r.holes} h`}</span>
            </div>`;
          }).join('')}
        </div>
        </div>
        ${bestRound ? `<p class="text-[11px] text-emerald-300 mt-2">🏆 Tu mejor ronda de 9 hoyos: ${bestRound.strokes} golpes el ${shortDate(bestRound.date)} (par ${bestRound.par}).</p>` : ''}
        ${d.rounds.some((r) => r.excluded) ? `<p class="text-[11px] text-slate-400 mt-2">Barra gris punteada: ${d.rounds.filter((r) => r.excluded).map((r) => `${shortDate(r.date)} · ${r.excluded}`).join('; ')}. Garmin sí la contó en tu handicap; el Caddy la deja fuera de tus promedios y distancias.</p>` : ''}
        ${d.rounds.some((r) => r.course) ? '<p class="text-[11px] text-sky-300/80 mt-1">Barra azul: ronda en otro campo.</p>' : ''}
        <p class="text-[11px] cd-muted mt-2">Para bajar tu handicap, esta barra tiene que llegar a +${fmt1((d.personalPar9 - d.par9) / 9)} por hoyo (tu par personal).</p>
      </div>

      <p class="text-[10px] cd-muted text-center pb-2">Datos de Garmin Golf · actualizado ${updatedTxt} · ${d.holesWithShots} hoyos con golpe por golpe. Con más rondas el Caddy afina sus números.</p>
    `;

    // Simulador
    root.querySelectorAll('.cd-play').forEach((btn) => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.play;
        if (active.has(k)) active.delete(k); else active.add(k);
        btn.setAttribute('aria-pressed', active.has(k));
        updateSim();
      });
    });
    // Hoyos
    root.querySelectorAll('[data-hole]').forEach((btn) => {
      btn.addEventListener('click', () => { selectedHole = Number(btn.dataset.hole); renderHole(); });
    });
    const reset = document.getElementById('cdBagReset');
    if (reset) reset.addEventListener('click', () => {
      try { localStorage.removeItem(BAG_KEY); } catch (e) { /* nada */ }
      loadBag(); renderBag(); renderHole();
    });
    renderBag();
    renderHole();
  }

  function updateSim() {
    const saved = [...active].reduce((acc, k) => acc + (data.savings[k] || 0), 0);
    const score = Math.max(data.personalPar9, data.avg9 - saved);
    countUp(document.getElementById('cdSim'), Math.round(score), 0, 700);
    const bar = document.getElementById('cdSimBar');
    if (bar) bar.style.width = `${(score / data.avg9) * 100}%`;
  }

  function renderHole() {
    const h = data.plan.find((x) => x.n === selectedHole) || data.plan[0];
    document.querySelectorAll('.cd-hole-btn').forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.hole) === h.n));
    const box = document.getElementById('cdHole');
    if (!box) return;
    box.innerHTML = `
      <div class="grid sm:grid-cols-2 gap-3 items-center">
        <div>${holeSvg(h)}</div>
        <div>
          <div class="grid grid-cols-4 gap-1.5 text-center">
            ${[['Par', h.par, 'text-white'], [groupHole(h.n) ? 'Par neto' : 'Tu meta', metaOf(h), 'text-emerald-300'], ['Promedio', h.avg != null ? fmt1(h.avg) : 's/d', 'text-rose-300'], ['Mejor', h.best ?? 's/d', 'text-amber-300']]
              .map(([k, v, c]) => `<div class="bg-[#0a2019] rounded-xl py-1.5"><div class="text-lg font-extrabold ${c} cd-big">${v}</div><div class="text-[10px] cd-muted">${k}</div></div>`).join('')}
          </div>
          <div class="flex items-center justify-between bg-[#0a2019] rounded-xl px-3 py-2 mt-2">
            <span class="text-[11px] cd-muted">Largo del hoyo</span>
            <span class="font-extrabold text-white cd-big">${fmt0(h.len)} m <span class="text-emerald-300">· ${yd(h.len)} yd</span></span>
          </div>
          <p class="text-[11px] cd-muted mt-2">Dificultad ${h.index} de 18 (1 es el más difícil) · jugado ${h.times} veces</p>
          <p class="text-sm text-slate-100 mt-2 leading-snug">💬 ${holeTip(h)}</p>
        </div>
      </div>
      ${renderGroupHole(groupHole(h.n))}
      ${renderSteps(h)}
      ${renderLeftBox()}`;
    bindLeftBox(h);
  }

  // ---------- en la cancha: ¿cuánto te falta? ----------
  const UNIT_KEY = 'caddy_ptc_unidad';
  let unit = 'yd';
  try { unit = localStorage.getItem(UNIT_KEY) === 'm' ? 'm' : 'yd'; } catch (e) { /* sin almacenamiento */ }
  function renderLeftBox() {
    const ub = (u) => `<button type="button" class="px-3 h-9 text-xs font-bold rounded-lg ${unit === u ? 'bg-emerald-500 text-[#052e22]' : 'bg-[#0a2019] text-slate-300 border border-emerald-900'}" data-unit="${u}" aria-pressed="${unit === u}">${u === 'm' ? 'metros' : 'yardas'}</button>`;
    return `
      <div class="mt-3 rounded-2xl border border-amber-500/40 bg-[#1a1a0d]/40 p-3">
        <label for="cdLeftIn" class="text-xs font-bold text-white">📍 ¿Cuánto te falta al green?</label>
        <p class="text-[10px] cd-muted mt-0.5">Lee la distancia en el reloj y el plan se ajusta desde ahí.</p>
        <div class="flex items-center gap-2 mt-2">
          <input id="cdLeftIn" type="number" inputmode="numeric" min="1" max="400" placeholder="ej. 106" class="w-24 h-9 rounded-lg bg-[#0a2019] border border-emerald-900 text-white font-extrabold text-center cd-big focus:outline-none focus:border-emerald-400" />
          ${ub('yd')}${ub('m')}
        </div>
        <div id="cdLeftPlan" class="mt-2" aria-live="polite"></div>
      </div>`;
  }
  function renderLeftPlan() {
    const out = document.getElementById('cdLeftPlan');
    const inp = document.getElementById('cdLeftIn');
    if (!out || !inp) return;
    const v = Number(inp.value);
    if (!v || v <= 0) { out.innerHTML = ''; return; }
    const m = unit === 'yd' ? v / 1.0936 : v;
    const steps = stepsFrom(m, ['Siguiente', 'Después', 'Luego'], true, true);
    out.innerHTML = `
      <ol class="space-y-2">
        ${steps.map((s, i) => `
          <li class="flex items-center gap-3 cd-pop" style="animation-delay:${i * 100}ms">
            <span class="w-7 h-7 rounded-full bg-amber-400/20 text-amber-300 font-black text-xs flex items-center justify-center shrink-0">${i + 1}</span>
            <div class="min-w-0 flex-1">
              <div class="text-[11px] cd-muted">${s.label}</div>
              <div class="text-sm font-extrabold text-white">🏌️ ${s.club}</div>
              ${s.alt ? `<div class="text-[10px] text-emerald-300">Si tienes que volarla: ${s.alt}</div>` : ''}
            </div>
            <div class="text-right shrink-0">
              <div class="text-sm font-bold text-white cd-big">${fmt0(s.shot)} m · ${yd(s.shot)} yd</div>
              <div class="text-[10px] ${s.left ? 'text-amber-300' : 'text-emerald-300'}">${s.left ? `quedan ${fmt0(s.left)} m · ${yd(s.left)} yd` : 'al green'}</div>
            </div>
          </li>`).join('')}
      </ol>
      <p class="text-[10px] cd-muted mt-2">Es el palo justo que alcanza esa distancia según la tabla. Si vienes pegando corto, súmale uno.</p>`;
  }
  function bindLeftBox() {
    const inp = document.getElementById('cdLeftIn');
    if (inp) inp.addEventListener('input', renderLeftPlan);
    document.querySelectorAll('[data-unit]').forEach((b) => b.addEventListener('click', () => {
      const next = b.dataset.unit;
      let prev = inp ? Number(inp.value) : 0;
      if (prev && next !== unit) prev = Math.round(next === 'm' ? prev / 1.0936 : prev * 1.0936);
      unit = next;
      try { localStorage.setItem(UNIT_KEY, unit); } catch (e) { /* sin almacenamiento */ }
      const box = b.closest('.rounded-2xl');
      box.outerHTML = renderLeftBox();
      bindLeftBox();
      const ni = document.getElementById('cdLeftIn');
      if (ni && prev) { ni.value = prev; renderLeftPlan(); }
    }));
  }

  function renderSteps(h) {
    const steps = h.steps || holeSteps(h);
    if (!steps.length) return '';
    return `
      <div class="mt-3 rounded-2xl border border-emerald-900/70 bg-[#0a2019] p-3">
        <p class="text-xs font-bold text-white">🧭 Tu plan en este hoyo</p>
        <div class="relative h-2 rounded-full bg-[#13352a] mt-3 mb-1" aria-hidden="true">
          ${steps.map((s, i) => {
            const done = steps.slice(0, i + 1).reduce((a, x) => a + x.shot, 0);
            return `<span class="absolute -top-1 w-4 h-4 rounded-full border-2 border-[#0a2019] ${s.left ? 'bg-amber-300' : 'bg-emerald-400'} cd-pop" style="left:calc(${(done / h.len) * 100}% - 8px);animation-delay:${i * 120}ms"></span>`;
          }).join('')}
          <span class="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-400 to-emerald-400 cd-bar" data-w="100" style="width:100%"></span>
        </div>
        <div class="flex justify-between text-[10px] cd-muted"><span>salida</span><span>green</span></div>
        <ol class="mt-2 space-y-2">
          ${steps.map((s, i) => `
            <li class="flex items-center gap-3 cd-pop" style="animation-delay:${i * 120}ms">
              <span class="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-300 font-black text-xs flex items-center justify-center shrink-0">${i + 1}</span>
              <div class="min-w-0 flex-1">
                <div class="text-[11px] cd-muted">${s.label}</div>
                <div class="text-sm font-extrabold text-white">🏌️ ${s.club}</div>
                ${s.alt ? `<div class="text-[10px] text-emerald-300">Si tienes que volarla: ${s.alt}</div>` : ''}
              </div>
              <div class="text-right shrink-0">
                <div class="text-sm font-bold text-white cd-big">${fmt0(s.shot)} m · ${yd(s.shot)} yd</div>
                <div class="text-[10px] ${s.left ? 'text-amber-300' : 'text-emerald-300'}">${s.left ? `quedan ${fmt0(s.left)} m · ${yd(s.left)} yd` : 'al green'}</div>
              </div>
            </li>`).join('')}
        </ol>
        <p class="text-[10px] cd-muted mt-2">${/^Driver/.test(steps[0].club) ? 'Salida con el M4 a tu distancia real y al green con un palo más del que te alcanza.' : steps.length > 1 ? 'Golpes rectos con el hierro 7 y al green con un palo más del que te alcanza.' : 'Ya es un palo más del que te alcanza, porque tu fallo es quedarte corto.'} Las distancias de cada palo están en «Tu bolsa».</p>
      </div>`;
  }

  // Tabla del reloj en «Tu bolsa»: se recalcula si ajustas el 52° o el 56° con − y +
  function clockTable() {
    const shots = clockShots();
    if (!shots.length) return '';
    const cell = (y, m) => `<td class="py-1 text-right font-extrabold text-white cd-big">${y} yd <span class="cd-muted font-semibold">· ${fmt0(m)} m</span></td>`;
    const at = (name, hour) => shots.find((s) => s.club === name && s.hour === hour);
    const full = (name) => bag.find((c) => c.name === name);
    const rows = WEDGE_CLOCK.map(([hour]) => {
      const a = at('Sand 56°', hour);
      const b = at('Wedge 52°', hour);
      return `<tr class="border-t border-emerald-900/60"><th scope="row" class="py-1 text-left font-bold text-amber-300">A las ${hour}</th>${cell(a.yd, a.m)}${b ? cell(b.yd, b.m) : '<td></td>'}</tr>`;
    }).join('');
    const f56 = full('Sand 56°');
    const f52 = full('Wedge 52°');
    return `
      <div class="rounded-xl bg-[#0a2019] p-3" style="margin-top:.75rem">
        <p class="text-xs font-bold text-white">🕙 Reloj de wedges</p>
        <p class="text-[10px] cd-muted mt-0.5 leading-snug">La hora es hasta dónde subes los brazos en el backswing (la subida del palo), como si fueran la manecilla.</p>
        <table class="w-full text-[11px] mt-2">
          <thead><tr class="cd-muted"><th scope="col" class="text-left font-semibold pb-1">Subida</th><th scope="col" class="text-right font-semibold pb-1">56°</th><th scope="col" class="text-right font-semibold pb-1">52°</th></tr></thead>
          <tbody>
            ${rows}
            <tr class="border-t border-emerald-900/60"><th scope="row" class="py-1 text-left font-bold text-emerald-300">Completo</th>${cell(yd(f56.m), f56.m)}${f52 ? cell(yd(f52.m), f52.m) : '<td></td>'}</tr>
          </tbody>
        </table>
        <p class="text-[10px] cd-muted mt-1 leading-snug">El 56° viene de tu guía. El 52° se calcula en proporción a su golpe completo. Para menos de 30 yd, sube a las 7 con menos fuerza.</p>
      </div>`;
  }

  let onBag = null;
  function renderBag(cb) {
    if (cb) onBag = cb; else if (cb === undefined && courseKey === 'huerta') onBag = null;
    const box = document.getElementById('cdBag');
    if (!box) return;
    const max = Math.max(...bag.map((c) => c.m), 1);
    box.innerHTML = bag.map((c, i) => `
      <div class="flex items-center gap-2">
        <span class="w-20 text-xs font-bold text-white shrink-0 leading-tight">${c.name}${c.model ? `<span class="block text-[10px] font-semibold cd-muted">${c.model}</span>` : ''}</span>
        <div class="flex-1 h-6 bg-[#0a2019] rounded-lg relative overflow-hidden">
          <div class="h-full rounded-lg bg-gradient-to-r from-emerald-700 to-emerald-400" style="width:${(c.m / max) * 100}%;transition:width .4s"></div>
          <span class="absolute inset-0 flex items-center pl-2 text-[11px] font-extrabold text-white cd-big">${c.m} m · ${yd(c.m)} yd${c.edited ? ' ✎' : ''}</span>
        </div>
        <button type="button" class="w-8 h-8 rounded-lg bg-[#0a2019] border border-emerald-900 text-white font-bold" data-bag="${i}" data-step="-1" aria-label="Restar 1 metro a ${c.name}">−</button>
        <button type="button" class="w-8 h-8 rounded-lg bg-[#0a2019] border border-emerald-900 text-white font-bold" data-bag="${i}" data-step="1" aria-label="Sumar 1 metro a ${c.name}">+</button>
      </div>`).join('') + `
      <div class="flex items-center gap-2">
        <span class="w-20 text-xs font-bold text-white shrink-0">Chipper</span>
        <div class="flex-1 h-6 bg-[#0a2019] rounded-lg flex items-center pl-2 text-[11px] font-bold cd-muted">fuera del green, hasta 30 m · golpe de putt</div>
      </div>
      <div class="flex items-center gap-2">
        <span class="w-20 text-xs font-bold text-white shrink-0">Putter</span>
        <div class="flex-1 h-6 bg-[#0a2019] rounded-lg flex items-center pl-2 text-[11px] font-bold cd-muted">en el green</div>
      </div>${clockTable()}`;
    box.querySelectorAll('[data-bag]').forEach((b) => {
      b.addEventListener('click', () => {
        const c = bag[Number(b.dataset.bag)];
        c.m = Math.max(10, c.m + Number(b.dataset.step));
        c.edited = c.m !== c.est;
        saveBag();
        if (onBag) { onBag(); return; }
        renderBag();
        renderHole();
      });
    });
  }

  function animateIn(root) {
    // Con muchas rondas la gráfica se desliza de lado: abre en las más recientes
    const progress = document.getElementById('cdProgress');
    if (progress) progress.scrollLeft = progress.scrollWidth;
    const ring = document.getElementById('cdRing');
    if (ring) ring.style.strokeDashoffset = String(314.16 * (1 - Math.min(1, data.handicap / 54)));
    countUp(document.getElementById('cdHcp'), data.handicap, 1, 1600);
    countUp(document.getElementById('cdAvg9'), data.avg9, 0, 1200);
    const goal = Math.max(data.personalPar9, Math.round(data.avg9 - Object.values(data.savings).reduce((a, b) => a + b, 0)));
    countUp(document.getElementById('cdGoal'), goal, 0, 1400);
    countUp(document.getElementById('cdPP'), data.personalPar9, 0, 1200);
    const items = root.querySelectorAll('.cd-reveal');
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('cd-in');
        e.target.querySelectorAll('.cd-bar').forEach((b) => { b.style.width = `${b.dataset.w}%`; });
        e.target.querySelectorAll('.cd-col').forEach((b) => { b.style.height = `${b.dataset.h}%`; });
        io.unobserve(e.target);
      });
    }, { threshold: 0.15 }) : null;
    items.forEach((el, i) => {
      el.style.transitionDelay = `${Math.min(i, 3) * 90}ms`;
      if (io) io.observe(el); else el.classList.add('cd-in');
    });
    if (!io) root.querySelectorAll('.cd-bar, .cd-col').forEach((b) => { b.style.width = b.dataset.w ? `${b.dataset.w}%` : ''; b.style.height = b.dataset.h ? `${b.dataset.h}%` : ''; });
  }


  // ---------- otros campos: plan de 18 hoyos con la tarjeta oficial ----------
  const YD2M = 0.9144;
  // Handicap de cancha (WHS) con el handicap index de Garmin y el slope/rating de esa salida
  function courseHcp(tee) {
    return Math.round(data.handicap * tee.slope / 113 + (tee.rating - 72));
  }
  function strokesOn(index, ch) {
    return Math.floor(ch / 18) + (index <= ch % 18 ? 1 : 0);
  }
  const shortGame = () => (data.par3 && data.par3.insideAvg) || 3;
  function pickTee(c) {
    let name = null;
    try { name = localStorage.getItem(TEE_KEY + c.key); } catch (e) { /* nada */ }
    // Por defecto la salida más corta de caballeros: con tu handicap es la que da menos golpes.
    return c.tees.find((t) => t.name === name) || c.tees[0];
  }
  function coursePlan(c, tee) {
    const ch = courseHcp(tee);
    return c.pars.map((par, i) => {
      const h = { n: i + 1, par, index: c.index[i], personalPar: par + strokesOn(c.index[i], ch), len: Math.round(tee.yd[i] * YD2M) };
      h.steps = courseSteps(h);
      h.tee = h.steps.length ? h.steps[0].shot : h.len;
      // Golpes completos hasta tener el green a 30 m o menos + lo que de verdad gastas desde
      // ahí según Garmin (chip y putts), no los dos putts de manual.
      h.full = h.steps.filter((x) => !/^Chip/.test(x.club)).length;
      h.caddy = Math.round((h.full + shortGame()) * 10) / 10;
      return h;
    });
  }
  // Menor número de golpes: par 3 al green si te alcanza un hierro; si no, golpes rectos con
  // el hierro 7. En par 4 y 5, salida con el M4, hierro 7 si falta y al green con un palo más.
  function courseSteps(h) {
    if (!bag.length) return [];
    const labels = ['Salida', 'Segundo', 'Tercero', 'Cuarto', 'Quinto', 'Sexto', 'Séptimo'];
    const cap = bag.find((c) => c.name === CAP_CLUB);
    if (h.par === 3 && (!cap || h.len <= cap.m * distScale)) return [{ label: 'Salida al centro del green', club: clubFor(h.len).name, shot: h.len, left: 0 }];
    if (h.par === 3) return stepsFrom(h.len, labels, false);
    return longHoleSteps(h.len, labels);
  }
  function courseTip(h, ch) {
    const right = data.fairway && data.fairway.percentFairwayRight;
    const extra = h.personalPar - h.par;
    const hard = h.index <= 3 ? `Es de los más difíciles (ventaja ${h.index}): aquí el handicap te da ${extra} golpes, así que ${h.personalPar} es un buen hoyo. ` : '';
    const steps = h.steps.length;
    const sg = `desde 30 m gastas ${fmt1(shortGame())} golpes (tu promedio en Garmin)`;
    if (h.par === 3 && steps === 1) return `${hard}Un solo golpe al centro del green, no a la bandera; ${sg}: ${fmt1(h.caddy)} golpes. Si fallas, que sea corto y al frente, donde el chip es fácil.`;
    if (h.par === 3) return `${hard}Par 3 largo para tu bolsa: no lo fuerces con madera. Deja la bola al frente del green y entra rodando; ${sg}: ${fmt1(h.caddy)}.`;
    return `${hard}${h.full} golpe${h.full === 1 ? '' : 's'} completo${h.full === 1 ? '' : 's'} hasta el green y ${sg}: ${fmt1(h.caddy)}. ${h.steps[0] && /^Driver/.test(h.steps[0].club) ? 'Sal con el M4' : 'Sal recto'} y apunta al lado izquierdo del fairway: ${pct(right || 0)} de tus salidas se van a la derecha. Tu meta con handicap es ${h.personalPar}.`;
  }

  function renderSwitch(box) {
    const all = [{ key: 'huerta', name: data.course.name, short: 'La Huerta' }]
      .concat(campos.map((c) => ({ key: c.key, name: c.name, short: c.name.split(' · ')[0].replace('Club ', '').replace(' Golf & Country Club', '') })));
    all.sort((a, b) => (a.key === 'huerta' ? -1 : b.key === 'huerta' ? 1 : 0));
    if (!all.some((c) => c.key === courseKey)) courseKey = 'huerta';
    box.innerHTML = `
      <div class="flex gap-2 overflow-x-auto no-scrollbar" role="group" aria-label="Elige campo">
        ${all.map((c) => `<button type="button" class="cd-hole-btn shrink-0 px-3 text-xs whitespace-nowrap" data-course="${c.key}" aria-pressed="${c.key === courseKey}" title="${c.name}">⛳ ${c.short}</button>`).join('')}
      </div>`;
    box.querySelectorAll('[data-course]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.course === courseKey) return;
      courseKey = b.dataset.course;
      try { localStorage.setItem(COURSE_KEY, courseKey); } catch (e) { /* nada */ }
      selectedHole = 1;
      paint();
    }));
  }

  // Tus rondas de Garmin en este campo (la tarjeta liga por su nombre en Garmin)
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function roundsOn(c) {
    if (!c.garmin) return [];
    return data.rounds.filter((r) => r.course && !r.excluded && Array.isArray(r.perHole) && norm(r.course).includes(norm(c.garmin)));
  }
  function renderMyRound(r, plan) {
    const max = Math.max(...plan.map((h, i) => Math.max(r.perHole[i] || 0, h.personalPar))) + 0.5;
    const pp = plan.reduce((a, h, i) => a + (r.perHole[i] ? h.personalPar : 0), 0);
    const hits = plan.filter((h, i) => r.perHole[i] && r.perHole[i] <= h.personalPar).length;
    const half = (a, b) => r.perHole.slice(a, b).reduce((s, v) => s + (v || 0), 0);
    return `
      <div class="cd-card cd-reveal cd-in">
        <div class="cd-kicker">Tu ronda real · ${shortDate(r.date)}</div>
        <p class="text-sm text-white font-semibold mt-1">${r.strokes} golpes en ${r.holes} hoyos (par ${r.par}) contra tu par personal de ${pp}</p>
        <div class="grid grid-cols-3 gap-2 mt-3 text-center">
          <div class="bg-[#0a2019] rounded-xl py-2"><div class="text-lg font-extrabold text-rose-300 cd-big">${r.strokes}</div><div class="text-[10px] cd-muted leading-tight">tus golpes<br>ese día</div></div>
          <div class="bg-[#0a2019] rounded-xl py-2"><div class="text-lg font-extrabold text-emerald-300 cd-big">${hits}</div><div class="text-[10px] cd-muted leading-tight">hoyos en tu par<br>personal o mejor</div></div>
          <div class="bg-[#0a2019] rounded-xl py-2"><div class="text-lg font-extrabold text-white cd-big">${half(0, 9)} · ${half(9, 18)}</div><div class="text-[10px] cd-muted leading-tight">ida · vuelta</div></div>
        </div>
        <p class="text-xs font-bold text-white mt-4">Tus golpes contra tu par personal, por hoyo</p>
        <div class="flex items-end gap-0.5 sm:gap-1 h-32 mt-2">
          ${plan.map((h, i) => {
            const v = r.perHole[i];
            const over = v > h.personalPar;
            return `<button type="button" class="flex-1 min-w-0 flex flex-col items-center justify-end h-full" data-chole="${h.n}" aria-label="Hoyo ${h.n}: ${v || 'sin dato'} golpes, par personal ${h.personalPar}">
              <span class="text-[9px] font-bold ${over ? 'text-rose-300' : 'text-emerald-300'} cd-big">${v || 's/d'}</span>
              <div class="w-full relative flex items-end" style="height:78%">
                <div class="absolute left-0 right-0 z-10 border-t-2 border-dashed border-emerald-200" style="bottom:${(h.personalPar / max) * 100}%"></div>
                <div class="w-full rounded-t-sm ${over ? 'bg-gradient-to-t from-rose-600 to-rose-400' : 'bg-gradient-to-t from-emerald-600 to-emerald-400'}" style="height:${((v || 0) / max) * 100}%"></div>
              </div>
              <span class="text-[9px] cd-muted mt-1">${h.n}</span>
            </button>`;
          }).join('')}
        </div>
        <p class="text-[10px] cd-muted mt-1">Golpes de Garmin${r.tee ? ` (salida ${({ Mens: 'de caballeros', Ladies: 'de damas' })[r.tee] || r.tee})` : ''}. Línea punteada = tu par personal desde la salida elegida arriba. Barra roja = ahí te pasaste de tu meta.</p>
      </div>`;
  }

  let current = null; // { c, tee, plan, ch, mine }
  function renderCourse(root, c) {
    distScale = c.distFactor || 1;
    const tee = pickTee(c);
    const ch = courseHcp(tee);
    const plan = coursePlan(c, tee);
    const mine = roundsOn(c);
    const last = mine[mine.length - 1] || null;
    current = { c, tee, plan, ch, last };
    const sum = (arr, k) => Math.round(arr.reduce((a, h) => a + h[k], 0));
    const front = plan.slice(0, 9);
    const back = plan.slice(9);
    root.innerHTML = `
      <div class="cd-card cd-reveal cd-in relative overflow-hidden">
        <div class="absolute -right-16 -top-16 w-56 h-56 rounded-full bg-sky-500/10 blur-2xl" aria-hidden="true"></div>
        <div class="cd-kicker">🎯 Caddy PTC · plan de campo</div>
        <h2 class="text-xl font-extrabold text-white leading-tight mt-1">${c.name}</h2>
        <p class="text-xs cd-muted mt-0.5">${c.city} · par 72 · ${last ? `${mine.length === 1 ? 'tu ronda' : `${mine.length} rondas tuyas; la última`} del ${shortDate(last.date)}: <b class="text-rose-300">${last.strokes} golpes</b>` : 'aún sin rondas tuyas en Garmin aquí'}</p>
        ${c.distNote ? `<p class="text-[11px] text-sky-300 mt-1">🌊 ${c.distNote}</p>` : ''}
        <div class="flex gap-2 overflow-x-auto no-scrollbar mt-3" role="group" aria-label="Salida">
          ${c.tees.map((t) => `<button type="button" class="cd-hole-btn shrink-0 px-3 text-xs whitespace-nowrap" data-tee="${t.name}" aria-pressed="${t.name === tee.name}">${t.es} · ${fmt0(t.yd.reduce((a, b) => a + b, 0))} yd</button>`).join('')}
        </div>
        <div class="grid grid-cols-3 gap-2 mt-3 text-center">
          <div class="bg-[#0a2019] rounded-xl py-2"><div class="text-lg font-extrabold text-amber-300 cd-big">${sum(front, 'caddy') + sum(back, 'caddy')}</div><div class="text-[10px] cd-muted leading-tight">ronda del<br>Caddy (18)</div></div>
          <div class="bg-[#0a2019] rounded-xl py-2"><div class="text-lg font-extrabold text-emerald-300 cd-big">${sum(plan, 'personalPar')}</div><div class="text-[10px] cd-muted leading-tight">tu par<br>personal</div></div>
          <div class="bg-[#0a2019] rounded-xl py-2"><div class="text-lg font-extrabold text-white cd-big">${ch}</div><div class="text-[10px] cd-muted leading-tight">golpes que<br>te da el campo</div></div>
        </div>
        <div class="grid grid-cols-2 gap-2 mt-2 text-[11px] text-center">
          <div class="bg-[#0a2019] rounded-xl py-1.5"><span class="cd-muted">Ida (1-9):</span> <b class="text-amber-300">${sum(front, 'caddy')}</b> <span class="cd-muted">plan ·</span> <b class="text-emerald-300">${sum(front, 'personalPar')}</b> <span class="cd-muted">meta</span></div>
          <div class="bg-[#0a2019] rounded-xl py-1.5"><span class="cd-muted">Vuelta (10-18):</span> <b class="text-amber-300">${sum(back, 'caddy')}</b> <span class="cd-muted">plan ·</span> <b class="text-emerald-300">${sum(back, 'personalPar')}</b> <span class="cd-muted">meta</span></div>
        </div>
        <p class="text-[11px] cd-muted mt-3 leading-snug"><b class="text-slate-200">Ronda del Caddy</b>: los golpes completos del plan (siempre recto, sin golpes de héroe) más lo que hoy gastas desde 30 m según Garmin (${fmt1(shortGame())} por hoyo). Asume que cada palo llega a lo que dice «Tu bolsa»: si no, ajústala y el número se recalcula. <b class="text-slate-200">Par personal</b>: par 72 más los ${ch} golpes que tu handicap ${fmt1(data.handicap)} recibe desde las ${tee.es.toLowerCase()} (rating ${tee.rating}, slope ${tee.slope}). Si la ronda del Caddy sale arriba del par personal, ese hoyo es para cuidar el número, no para atacar.</p>
      </div>

      <div class="cd-card cd-reveal cd-in">
        <div class="cd-kicker">Plan hoyo por hoyo · ${c.name.split(' · ')[0]}</div>
        <div class="flex gap-2 overflow-x-auto no-scrollbar py-2 mt-1" role="group" aria-label="Elige hoyo">
          ${plan.map((h) => `<button type="button" class="cd-hole-btn shrink-0" data-chole="${h.n}" aria-pressed="${h.n === selectedHole}">${h.n}</button>`).join('')}
        </div>
        <div id="cdHole"></div>
        <div class="mt-4">
          <p class="text-xs font-bold text-white">Golpes del plan contra tu par personal, por hoyo</p>
          <div class="flex items-end gap-0.5 sm:gap-1 h-32 mt-2">
            ${plan.map((h) => {
              const max = Math.max(...plan.map((x) => Math.max(x.caddy, x.personalPar))) + 0.5;
              const over = h.caddy > h.personalPar;
              return `<button type="button" class="flex-1 min-w-0 flex flex-col items-center justify-end h-full" data-chole="${h.n}" aria-label="Hoyo ${h.n}: plan ${fmt1(h.caddy)}, par personal ${h.personalPar}">
                <span class="text-[9px] font-bold ${over ? 'text-rose-300' : 'text-emerald-300'} cd-big">${Math.round(h.caddy)}</span>
                <div class="w-full relative flex items-end" style="height:78%">
                  <div class="absolute left-0 right-0 z-10 border-t-2 border-dashed border-emerald-200" style="bottom:${(h.personalPar / max) * 100}%"></div>
                  <div class="w-full rounded-t-sm ${over ? 'bg-gradient-to-t from-rose-600 to-rose-400' : 'bg-gradient-to-t from-sky-700 to-sky-400'}" style="height:${(h.caddy / max) * 100}%"></div>
                </div>
                <span class="text-[9px] cd-muted mt-1">${h.n}</span>
              </button>`;
            }).join('')}
          </div>
          <p class="text-[10px] cd-muted mt-1">Línea punteada = tu par personal. Barra azul = el plan te deja en tu meta o mejor.</p>
        </div>
      </div>

      ${last ? renderMyRound(last, plan) : ''}

      <div class="cd-card cd-reveal cd-in">
        <div class="flex items-center justify-between gap-2">
          <div class="cd-kicker">Tu bolsa · la misma de La Huerta</div>
          <button type="button" id="cdBagReset" class="text-[11px] text-emerald-300 underline">Volver a la tabla</button>
        </div>
        <div id="cdBag" class="space-y-1.5 mt-3"></div>
        <p class="text-[11px] cd-muted mt-3 leading-snug">Distancias medidas en Puebla.${c.distFactor && c.distFactor !== 1 ? ` En este campo el plan las toma al ${Math.round(c.distFactor * 100)}%: tu hierro 7 de ${(bag.find((b) => b.name === 'Hierro 7') || {}).m || 137} m aquí es de ${Math.round(((bag.find((b) => b.name === 'Hierro 7') || {}).m || 137) * c.distFactor)} m.` : ''} Si ajustas un palo, el plan de todos los campos se recalcula.</p>
      </div>

      <p class="text-[10px] cd-muted text-center pb-2">Tarjeta oficial de ${c.name} (par, ventaja y yardas por salida, fuente ${c.source}). ${last ? 'Tus golpes reales salen de Garmin Golf.' : 'Cuando juegues aquí con el reloj, el Caddy sumará tus golpes reales.'}</p>`;

    root.querySelectorAll('[data-tee]').forEach((b) => b.addEventListener('click', () => {
      try { localStorage.setItem(TEE_KEY + c.key, b.dataset.tee); } catch (e) { /* nada */ }
      renderCourse(root, c);
    }));
    root.querySelectorAll('[data-chole]').forEach((b) => b.addEventListener('click', () => { selectedHole = Number(b.dataset.chole); renderCourseHole(); }));
    const reset = document.getElementById('cdBagReset');
    if (reset) reset.addEventListener('click', () => {
      try { localStorage.removeItem(BAG_KEY); } catch (e) { /* nada */ }
      loadBag(); renderCourse(root, c);
    });
    renderBag(() => renderCourse(root, c));
    renderCourseHole();
  }

  function renderCourseHole() {
    const { plan, ch } = current;
    const h = plan.find((x) => x.n === selectedHole) || plan[0];
    document.querySelectorAll('[data-chole].cd-hole-btn').forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.chole) === h.n));
    const box = document.getElementById('cdHole');
    if (!box) return;
    box.innerHTML = `
      <div class="grid sm:grid-cols-2 gap-3 items-center">
        <div>${holeSvg(h, 'salida del plan')}</div>
        <div>
          <div class="grid grid-cols-3 gap-1.5 text-center">
            ${[['Par', h.par, 'text-white'], ['Plan Caddy', fmt1(h.caddy), 'text-amber-300'], ['Tu meta', h.personalPar, 'text-emerald-300']]
              .map(([k, v, cl]) => `<div class="bg-[#0a2019] rounded-xl py-1.5"><div class="text-lg font-extrabold ${cl} cd-big">${v}</div><div class="text-[10px] cd-muted">${k}</div></div>`).join('')}
          </div>
          <div class="flex items-center justify-between bg-[#0a2019] rounded-xl px-3 py-2 mt-2">
            <span class="text-[11px] cd-muted">Largo del hoyo</span>
            <span class="font-extrabold text-white cd-big">${fmt0(h.len)} m <span class="text-emerald-300">· ${yd(h.len)} yd</span></span>
          </div>
          <p class="text-[11px] cd-muted mt-2">Dificultad ${h.index} de 18 (1 es el más difícil) · te da ${h.personalPar - h.par} golpe${h.personalPar - h.par === 1 ? '' : 's'}</p>
          ${current.last && current.last.perHole[h.n - 1] ? `<p class="text-[11px] mt-1 ${current.last.perHole[h.n - 1] > h.personalPar ? 'text-rose-300' : 'text-emerald-300'}">Tu ronda del ${shortDate(current.last.date)}: ${current.last.perHole[h.n - 1]} golpes en este hoyo</p>` : ''}
          <p class="text-sm text-slate-100 mt-2 leading-snug">💬 ${courseTip(h, ch)}</p>
        </div>
      </div>
      ${renderSteps(h)}
      ${renderLeftBox()}`;
    bindLeftBox();
  }

  function paint() {
    const root = document.getElementById('tab-caddy');
    if (!root) return;
    active.clear();
    root.innerHTML = '<div id="cdSwitch"></div><div id="cdBody" class="space-y-4"></div>';
    renderSwitch(document.getElementById('cdSwitch'));
    const body = document.getElementById('cdBody');
    const c = campos.find((x) => x.key === courseKey);
    if (c) { renderCourse(body, c); return; }
    distScale = 1;
    render(body);
    requestAnimationFrame(() => animateIn(body));
  }

  // Una sola carga de datos para «Mi plan» y «En vivo»
  let loading = null;
  function ensureData() {
    if (data) return Promise.resolve(data);
    if (!loading) {
      loading = (async () => {
        const [r, rc, rg] = await Promise.all([
          fetch('/caddy-data.json', { cache: 'no-store' }),
          fetch('/caddy-campos.json', { cache: 'no-store' }).catch(() => null),
          fetch('/caddy-grupo.json', { cache: 'no-store' }).catch(() => null),
        ]);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (rc && rc.ok) { try { campos = (await rc.json()).courses || []; } catch (e) { campos = []; } }
        // Sin el archivo del grupo el Caddy sigue igual que antes, con tu par personal de Garmin
        if (rg && rg.ok) { try { grupo = await rg.json(); } catch (e) { grupo = null; } }
        gpCache = null;
        data = d;
        loadBag();
        return data;
      })().catch((e) => { loading = null; throw e; });
    }
    return loading;
  }

  async function show() {
    const root = document.getElementById('tab-caddy');
    if (!root) return;
    if (!data) root.innerHTML = '<div class="cd-card text-center text-sm cd-muted">⛳ El Caddy está leyendo tus datos de Garmin…</div>';
    try {
      await ensureData();
    } catch (err) {
      root.innerHTML = `<div class="cd-card text-center text-sm text-rose-300">No pude cargar los datos del Caddy (${String(err.message || err)}). Revisa la conexión y vuelve a entrar.</div>`;
      return;
    }
    // Se repinta siempre: En vivo pudo cambiar el campo y la bolsa se comparte
    paint();
    rendered = true;
  }

  // ---------- lo que usa la pantalla «En vivo» (caddy-vivo.js) ----------
  const withScale = (f, fn) => {
    const prev = distScale;
    distScale = f || 1;
    try { return fn(); } finally { distScale = prev; }
  };
  const scaled = (c, f) => (c ? { name: c.name, m: c.m * (f || 1) } : null);
  const shortName = (name) => name.split(' · ')[0].replace('Club ', '').replace(' Golf & Country Club', '');
  const vivo = {
    ready: ensureData,
    courseKey: () => courseKey,
    setCourse(key) {
      courseKey = key;
      selectedHole = 1;
      try { localStorage.setItem(COURSE_KEY, key); } catch (e) { /* nada */ }
    },
    summary() {
      const best = data.rounds.filter((r) => r.holes === 9 && !r.excluded && !r.course)
        .reduce((b, r) => (!b || r.strokes < b.strokes ? r : b), null);
      return { handicap: fmt1(data.handicap), best9: best ? best.strokes : null, right: (data.fairway && data.fairway.percentFairwayRight) || 0 };
    },
    courses() {
      const huerta = { key: 'huerta', name: data.course.name, short: 'La Huerta', factor: 1,
        holes: data.plan.map((h) => ({ n: h.n, par: h.par, len: h.len, index: h.index, personalPar: h.personalPar, avg: h.avg, group: groupHole(h.n) })) };
      return [huerta].concat(campos.map((c) => ({
        key: c.key, name: c.name, short: shortName(c.name), factor: c.distFactor || 1,
        holes: withScale(c.distFactor, () => coursePlan(c, pickTee(c))).map((h) => ({ n: h.n, par: h.par, len: h.len, index: h.index, personalPar: h.personalPar, avg: null })),
      })));
    },
    driver: () => withScale(1, driverTee),
    club(name, f) {
      const c = bag.find((x) => x.name === name);
      if (!c) return null;
      return { ...scaled(c, f), range: c.dictated && c.dictated.range };
    },
    exact: (d, f) => withScale(f, () => scaled(clubExact(d), f)),
    plusOne: (d, f) => withScale(f, () => scaled(clubFor(d), f)),
    clock: (d, f) => scaled(clockPick(d / (f || 1)), f),
    shots: (f) => shotLadder().slice().reverse().map((c) => scaled(c, f)),
    // Juego del grupo: puntos de cada logro y la línea corta del modo de cada hoyo
    rules: pointRules,
    modes: MODES,
    groupLine,
    groupHc: () => (groupPlan() ? grupo.hc : null),
  };

  window.CaddyPTC = { show, vivo };
})();
