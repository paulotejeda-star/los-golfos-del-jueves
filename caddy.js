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
  const BAG_KEY = 'caddy_ptc_bolsa_v1';

  let data = null;
  let rendered = false;
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
  function holeSvg(h) {
    const long = h.par === 4;
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
        <text x="${Math.max(24, teeDist - 40)}" y="80" fill="#cbd5e1" font-size="10" font-weight="700">tu salida ${fmt0(h.tee)} m / ${yd(h.tee)} yd</text>
        <text x="${Math.min(greenX - 40, 236)}" y="98" fill="#34d399" font-size="10" font-weight="700">${fmt0(h.len)} m / ${yd(h.len)} yd</text>
      </svg>`;
  }

  // ---------- bolsa y palo sugerido ----------
  let bag = [];
  function loadBag() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(BAG_KEY) || '{}') || {}; } catch (e) { saved = {}; }
    bag = (data.clubs || []).map((c) => ({ ...c, est: c.m, m: Number(saved[c.name]) || c.m, edited: saved[c.name] != null && Number(saved[c.name]) !== c.m }));
  }
  function saveBag() {
    const out = {};
    bag.forEach((c) => { if (c.m !== c.est) out[c.name] = c.m; });
    try { localStorage.setItem(BAG_KEY, JSON.stringify(out)); } catch (e) { /* sin almacenamiento: queda en memoria */ }
  }
  // Un palo más: el más corto que llega y luego el siguiente más largo, porque tu
  // fallo es quedarte corto. Tope en el Hierro 4: las maderas no son para tirar a green.
  function clubFor(dist) {
    const byLen = [...bag].sort((a, b) => a.m - b.m);
    const i = byLen.findIndex((c) => c.m >= dist);
    if (i < 0) return byLen[byLen.length - 1];
    const cap = byLen.findIndex((c) => c.name === 'Hierro 4');
    const up = Math.min(i + 1, byLen.length - 1);
    return byLen[cap >= 0 && i <= cap ? Math.min(up, cap) : i];
  }
  // El palo justo: el más corto que alcanza (para cuando ya mediste lo que te falta)
  function clubExact(dist) {
    const byLen = [...bag].sort((a, b) => a.m - b.m);
    return byLen.find((c) => c.m >= dist) || byLen[byLen.length - 1];
  }
  function steadyClub() {
    return bag.find((c) => c.name === 'Hierro 7') || bag[Math.floor(bag.length / 2)];
  }
  // Pasos del hoyo: palo, distancia del golpe y lo que queda al hoyo
  function holeSteps(h) {
    const len = h.len || 0;
    if (!bag.length || !len) return [];
    if (h.par === 3) {
      const c = clubFor(len);
      return [{ label: 'Salida al centro del green', club: c.name, shot: len, left: 0 }];
    }
    // Par 4: salida recta con el hierro 7; otro hierro 7 si todavía no alcanzas, y al
    // green con un palo más (o chip rodado si quedan 30 m o menos).
    return stepsFrom(len, ['Salida', 'Segundo', 'Tercero'], false);
  }
  // Golpes desde una distancia: hierro 7 mientras no alcances, luego un palo más al
  // green, o chip rodado con hierro 8 si quedan 30 m o menos.
  function stepsFrom(dist, labels, chipFirst, exact) {
    const st = steadyClub();
    const steps = [];
    let left = dist;
    while (left > 0 && steps.length < 3) {
      const label = labels[steps.length];
      if (left <= 30 && (chipFirst || steps.length)) {
        steps.push({ label: 'Al green', club: 'Chip rodado con Hierro 8', shot: left, left: 0 });
        left = 0;
      } else if (left > st.m) {
        left -= st.m;
        steps.push({ label, club: st.name, shot: st.m, left });
      } else {
        steps.push({ label: 'Al green', club: (exact ? clubExact(left) : clubFor(left)).name, shot: left, left: 0 });
        left = 0;
      }
    }
    return steps;
  }

  // ---------- consejos ----------
  function holeTip(h) {
    const right = data.fairway && data.fairway.percentFairwayRight;
    if (h.par === 4) {
      return `Salida recta con el hierro 7, no con el driver, y al green con un palo más. Apunta al lado izquierdo: ${pct(right)} de tus salidas se van a la derecha. Si haces ${h.personalPar}, ganaste el hoyo contra tu handicap.`;
    }
    const short = (h.len || 0) - (h.tee || 0);
    if (short >= 12) {
      return `Te quedas corto: tu salida promedia ${mYd(h.tee)} y el hoyo mide ${mYd(h.len)}. Toma un palo más y apunta al centro del green, no a la bandera.`;
    }
    if ((h.inside || 0) >= 3.5) {
      return `Llegas cerca, pero gastas ${fmt1(h.inside)} golpes desde 30 m. Rueda la bola con hierro 8 hasta el green y busca dejar un putt corto.`;
    }
    return `Es de tus hoyos buenos. Repite la rutina: centro del green y dos putts. Tu meta aquí es ${h.personalPar}.`;
  }

  // ---------- render ----------
  function render(root) {
    const d = data;
    const sv = d.savings;
    const plays = [
      { key: 'short', icon: '🎯', title: 'Dentro de 30 m: rueda, no vueles', save: sv.short,
        why: `Desde 30 m (33 yd) usas ${fmt1(d.par3.insideAvg)} golpes en los par 3. Un buen jugador de tu nivel usa 3. Chip rodado con hierro 8 y putt.` },
      { key: 'tee3', icon: '🏌️', title: 'Par 3: un palo más', save: sv.tee3,
        why: `Tus salidas promedian ${mYd(d.par3.teeDist)} en hoyos de ${mYd(d.par3.holeLen)}. Solo ${d.par3.teeOnGreen} de ${d.par3.n} cayeron en green; ${d.par3.teeRough} se fueron al rough.` },
      { key: 'par4', icon: '↖️', title: 'Par 4: tres golpes rectos, apunta a la izquierda', save: sv.par4,
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
          <p class="text-xs font-bold text-white">Tu promedio contra tu par personal, por hoyo</p>
          <div class="flex items-end gap-1.5 h-36 mt-2" id="cdHoleBars">
            ${d.plan.map((h) => {
              const max = Math.max(...d.plan.map((x) => x.avg || 0), 1) + 0.5;
              const over = (h.avg || 0) > h.personalPar;
              return `<button type="button" class="flex-1 flex flex-col items-center justify-end h-full relative" data-hole="${h.n}" aria-label="Hoyo ${h.n}: promedio ${fmt1(h.avg)}, par personal ${h.personalPar}">
                <span class="text-[10px] font-bold ${over ? 'text-rose-300' : 'text-emerald-300'} cd-big">${h.avg != null ? fmt1(h.avg) : 's/d'}</span>
                <div class="w-full relative flex items-end" style="height:78%">
                  <div class="absolute left-0 right-0 z-10 border-t-2 border-dashed border-emerald-200" style="bottom:${(h.personalPar / max) * 100}%"></div>
                  <div class="cd-col w-full rounded-t-md ${over ? 'bg-gradient-to-t from-rose-600 to-rose-400' : 'bg-gradient-to-t from-emerald-600 to-emerald-400'}" data-h="${((h.avg || 0) / max) * 100}"></div>
                </div>
                <span class="text-[10px] cd-muted mt-1">${h.n}</span>
              </button>`;
            }).join('')}
          </div>
          <p class="text-[10px] cd-muted mt-1">Línea punteada verde = tu par personal en ese hoyo. Barra roja = ahí estás arriba de tu meta.</p>
        </div>
      </div>

      <!-- 4b. Tu bolsa -->
      <div class="cd-card cd-reveal">
        <div class="flex items-center justify-between gap-2">
          <div class="cd-kicker">Tu bolsa · cuánto mandas cada palo</div>
          <button type="button" id="cdBagReset" class="text-[11px] text-emerald-300 underline">Volver a la tabla</button>
        </div>
        <div id="cdBag" class="space-y-1.5 mt-3"></div>
        <p class="text-[11px] cd-muted mt-3 leading-snug">${(data.clubs || []).some((c) => c.source === 'estimado')
          ? `Distancias de la tabla de referencia por palo que mandaste: hierro 9 a 119 m y entre un hierro y otro hay de 9 a 10 m. La tabla no trae maderas: la madera 3 (180 m) y el driver (200 m) son la medida típica de ese mismo jugador. El plan ya te da un palo más del que alcanza, porque tu fallo es quedarte corto. Si un palo no te cuadra, ajústalo con − y + (se guarda en tu teléfono) y el plan de cada hoyo se recalcula. Si marcas el palo en el reloj después de cada golpe, el Caddy usará tus distancias reales.`
          : 'Distancias reales: la mediana de tus golpes con cada palo marcado en el reloj.'} PW = pitching wedge y AW = approach wedge (el de aproximación); los sand de 52° y 56° son los de arena.</p>
      </div>

      <!-- 5. Progreso -->
      <div class="cd-card cd-reveal">
        <div class="cd-kicker">Tu progreso</div>
        <p class="text-sm text-white font-semibold mt-1">Golpes sobre par por hoyo en cada ronda (más bajo es mejor)</p>
        <div class="flex items-end gap-2 h-36 mt-3">
          ${d.rounds.map((r) => {
            const max = Math.max(...d.rounds.map((x) => x.overPerHole || 0), 1);
            return `<div class="flex-1 flex flex-col items-center justify-end h-full">
              <span class="text-[10px] font-bold text-slate-100 cd-big">+${fmt1(r.overPerHole)}</span>
              <div class="cd-col w-full rounded-t-md bg-gradient-to-t from-amber-600 to-amber-300" data-h="${(r.overPerHole / max) * 78}"></div>
              <span class="text-[9px] cd-muted mt-1 text-center leading-tight">${shortDate(r.date)}<br>${r.holes} h</span>
            </div>`;
          }).join('')}
        </div>
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
            ${[['Par', h.par, 'text-white'], ['Tu meta', h.personalPar, 'text-emerald-300'], ['Promedio', h.avg != null ? fmt1(h.avg) : 's/d', 'text-rose-300'], ['Mejor', h.best ?? 's/d', 'text-amber-300']]
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
    const steps = holeSteps(h);
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
              </div>
              <div class="text-right shrink-0">
                <div class="text-sm font-bold text-white cd-big">${fmt0(s.shot)} m · ${yd(s.shot)} yd</div>
                <div class="text-[10px] ${s.left ? 'text-amber-300' : 'text-emerald-300'}">${s.left ? `quedan ${fmt0(s.left)} m · ${yd(s.left)} yd` : 'al green'}</div>
              </div>
            </li>`).join('')}
        </ol>
        <p class="text-[10px] cd-muted mt-2">${h.par === 4 ? 'Salida recta con el hierro 7 y al green con un palo más del que te alcanza.' : 'Ya es un palo más del que te alcanza, porque tu fallo es quedarte corto.'} Las distancias de cada palo están en «Tu bolsa».</p>
      </div>`;
  }

  function renderBag() {
    const box = document.getElementById('cdBag');
    if (!box) return;
    const max = Math.max(...bag.map((c) => c.m), 1);
    box.innerHTML = bag.map((c, i) => `
      <div class="flex items-center gap-2">
        <span class="w-20 text-xs font-bold text-white shrink-0">${c.name}</span>
        <div class="flex-1 h-6 bg-[#0a2019] rounded-lg relative overflow-hidden">
          <div class="h-full rounded-lg bg-gradient-to-r from-emerald-700 to-emerald-400" style="width:${(c.m / max) * 100}%;transition:width .4s"></div>
          <span class="absolute inset-0 flex items-center pl-2 text-[11px] font-extrabold text-white cd-big">${c.m} m · ${yd(c.m)} yd${c.edited ? ' ✎' : ''}</span>
        </div>
        <button type="button" class="w-8 h-8 rounded-lg bg-[#0a2019] border border-emerald-900 text-white font-bold" data-bag="${i}" data-step="-1" aria-label="Restar 1 metro a ${c.name}">−</button>
        <button type="button" class="w-8 h-8 rounded-lg bg-[#0a2019] border border-emerald-900 text-white font-bold" data-bag="${i}" data-step="1" aria-label="Sumar 1 metro a ${c.name}">+</button>
      </div>`).join('');
    box.querySelectorAll('[data-bag]').forEach((b) => {
      b.addEventListener('click', () => {
        const c = bag[Number(b.dataset.bag)];
        c.m = Math.max(10, c.m + Number(b.dataset.step));
        c.edited = c.m !== c.est;
        saveBag();
        renderBag();
        renderHole();
      });
    });
  }

  function animateIn(root) {
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

  async function show() {
    const root = document.getElementById('tab-caddy');
    if (!root) return;
    if (!data) {
      root.innerHTML = '<div class="cd-card text-center text-sm cd-muted">⛳ El Caddy está leyendo tus datos de Garmin…</div>';
      try {
        const r = await fetch('/caddy-data.json', { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        data = await r.json();
      } catch (err) {
        root.innerHTML = `<div class="cd-card text-center text-sm text-rose-300">No pude cargar los datos del Caddy (${String(err.message || err)}). Revisa la conexión y vuelve a entrar.</div>`;
        return;
      }
    }
    if (!rendered) { loadBag(); render(root); rendered = true; }
    requestAnimationFrame(() => animateIn(root));
  }

  window.CaddyPTC = { show };
})();
