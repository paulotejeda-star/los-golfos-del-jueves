/* Caddy en vivo: la pantalla principal. Metes dónde está la bola y las condiciones, te
   recomienda el tiro y lleva tu ronda golpe por golpe. Todo se guarda en el teléfono.
   Las distancias y los palos salen de la bolsa de caddy.js (window.CaddyPTC.vivo). */
(function () {
  'use strict';

  const LIVE_KEY = 'caddy_ptc_vivo_v1';
  const LOG_KEY = 'caddy_ptc_golpes_v1';
  const UNIT_KEY = 'caddy_ptc_unidad';
  const YD = 1.0936;
  const REACH = 0.5;
  const CHIP = 'Chip rodado con Hierro 8';

  // Reglas generales de cuánto más o menos juega un tiro. Son estimaciones del Caddy.
  const WIND = { none: 0, contra: 0.10, favor: -0.05, cruz: 0 };
  const SLOPE = { plano: 0, sube: 0.08, baja: -0.08 };
  const LIE = { tee: 0, fairway: 0, rough: 0.05, arena: 0.10, arboles: 0 };

  const GROUPS = [
    { key: 'lie', title: '¿Dónde está la bola?', items: [['tee', 'Salida'], ['fairway', 'Fairway'], ['rough', 'Rough'], ['arena', 'Arena'], ['arboles', 'Árboles']] },
    { key: 'wind', title: 'Viento', items: [['none', 'Sin viento'], ['contra', 'En contra'], ['favor', 'A favor'], ['cruz', 'Cruzado']] },
    { key: 'slope', title: 'Terreno al green', items: [['plano', 'Plano'], ['sube', 'Sube'], ['baja', 'Baja']] },
    { key: 'danger', title: 'Peligro (agua, arena, fuera)', items: [['none', 'Nada'], ['front', 'Enfrente'], ['right', 'Derecha'], ['left', 'Izquierda']] },
  ];
  const KIND = { best: 'La mejor', safe: 'Más segura', bold: 'Más agresiva', other: 'Tu elección' };
  const ORDER = { best: 0, safe: 1, bold: 2 };

  const $ = (id) => document.getElementById(id);
  const yd = (m) => Math.round(m * YD);
  let unit = 'yd';
  try { unit = localStorage.getItem(UNIT_KEY) === 'm' ? 'm' : 'yd'; } catch (e) { /* sin almacenamiento */ }
  const both = (m) => (unit === 'yd' ? `${yd(m)} yd · ${Math.round(m)} m` : `${Math.round(m)} m · ${yd(m)} yd`);
  const toUnit = (m) => (unit === 'yd' ? yd(m) : Math.round(m));
  const fromUnit = (v) => (unit === 'yd' ? v / YD : v);

  let api = null;
  let live = null;
  let log = [];
  let bound = false;
  const ui = { chosen: null };

  // ---------- estado guardado ----------
  function freshRound(course) {
    return { v: 1, startedAt: new Date().toISOString(), course, vuelta: 1, hole: 1, wind: 'none', holes: {} };
  }
  function loadLive() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LIVE_KEY) || 'null'); } catch (e) { saved = null; }
    try { log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]') || []; } catch (e) { log = []; }
    const keys = api.courses().map((c) => c.key);
    live = saved && saved.v === 1 && keys.includes(saved.course) ? saved : freshRound(keys.includes(api.courseKey()) ? api.courseKey() : keys[0]);
  }
  function save() {
    try { localStorage.setItem(LIVE_KEY, JSON.stringify(live)); } catch (e) { /* queda en memoria */ }
  }
  function saveLog() {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-600))); } catch (e) { /* queda en memoria */ }
  }

  const course = () => api.courses().find((c) => c.key === live.course);
  const curInfo = () => { const c = course(); return c.holes.find((x) => x.n === live.hole) || c.holes[0]; };
  const holeKey = (v, n) => `${v}-${n}`;
  function holeState() {
    const k = holeKey(live.vuelta, live.hole);
    if (!live.holes[k]) {
      live.holes[k] = { shots: [], penalties: 0, putts: 0, onGreen: false, done: false, total: null, dist: curInfo().len, lie: 'tee', slope: 'plano', danger: 'none', touched: false, pick: 'best', other: '' };
    }
    return live.holes[k];
  }
  const strokesOf = (h) => (h.total != null ? h.total : h.shots.length + h.penalties + h.putts);
  const hasData = () => Object.values(live.holes).some((h) => h.done || h.shots.length || h.putts || h.penalties);

  // ---------- tus distancias reales de lo que vas anotando ----------
  function realFor(club) {
    const v = log.filter((x) => x.club === club).map((x) => x.m).sort((a, b) => a - b);
    if (v.length < 3) return null;
    const mid = Math.floor(v.length / 2);
    return { n: v.length, med: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2 };
  }
  // Cierra el golpe anterior solo si corregiste la distancia: así no se guardan estimados
  function closeLastShot(h) {
    const last = h.shots[h.shots.length - 1];
    if (!last || last.to != null || !h.touched) return;
    last.to = h.dist;
    const m = Math.round(last.from - last.to);
    if (m > 10 && !/^(Chip|Putter)|,/.test(last.club)) {
      log.push({ id: last.id, club: last.club, m, date: new Date().toISOString().slice(0, 10), course: live.course });
      saveLog();
    }
  }

  // ---------- la decisión ----------
  function decide(h, info, c) {
    const f = c.factor || 1;
    const pctAdj = WIND[live.wind] + SLOPE[h.slope] + LIE[h.lie];
    const adj = 1 + pctAdj;
    const dist = h.dist;
    const plays = dist * adj;
    const isTee = !h.shots.length && h.lie === 'tee';
    const options = [];
    const add = (kind, club, m, why) => {
      if (!club || options.some((o) => o.club === club)) return;
      const go = m / adj;
      const left = go + REACH >= dist ? 0 : Math.round(dist - go);
      options.push({ kind, club, m, shot: left ? go : dist, left, why });
    };
    const H7 = api.club('Hierro 7', f);
    const H4 = api.club('Hierro 4', f);
    const S56 = api.club('Sand 56°', f);
    const PW = api.club('PW', f);
    const W3 = api.club('Madera 3', f);
    const drv = api.driver();

    if (h.lie === 'arboles') {
      add('best', 'Hierro 8, bajito y de lado', Math.min(45, dist) * adj, 'Regresa al fairway. Cuesta un golpe; el tiro de héroe puede costar tres.');
      const e = api.exact(plays, f);
      add('bold', e.name, e.m, 'Solo si ves un hueco claro hacia el green.');
    } else if (h.lie === 'arena') {
      if (plays <= 45) {
        add('best', 'Sand 56°, cara abierta', plays, 'Pega dos dedos atrás de la bola y termina el swing. Primero salir.');
      } else {
        const e = plays <= PW.m + REACH ? api.exact(plays, f) : PW;
        add('best', e.name, e.m, 'Con altura para librar el borde del bunker.');
        add('safe', 'Sand 56°, cara abierta', Math.min(plays, 40), 'Si el borde está alto: sal al fairway aunque avances poco.');
      }
    } else if (isTee && info.par >= 4 && drv && dist > drv.m) {
      add('best', drv.name, drv.m, 'Tu salida real en par 4 y par 5.');
      add('safe', H7.name, H7.m, 'Si el fairway está angosto o hay problema donde cae el M4.');
    } else if (plays <= 30) {
      const cl = api.clock(plays, f);
      if (h.danger === 'front') {
        add('best', cl.name, cl.m, 'Hay que volar el peligro: pega con el reloj y deja caer la bola en green.');
      } else if (h.lie === 'rough') {
        add('best', cl.name, cl.m, 'En rough la bola no rueda pareja: vuélala al green.');
        add('safe', CHIP, plays, 'Si la bola quedó arriba del pasto.');
      } else {
        add('best', CHIP, plays, 'Rueda la bola: es tu tiro más seguro desde aquí.');
        if (dist <= 12) add('safe', 'Putter', plays, 'Si el pasto está parejo hasta el green.');
        add('bold', cl.name, cl.m, 'Si tienes que volarla.');
      }
    } else if (plays <= H7.m + REACH) {
      const e = api.exact(plays, f);
      const up = api.plusOne(plays, f);
      if (h.danger === 'front' || (isTee && info.par === 3)) {
        add('best', up.name, up.m, h.danger === 'front' ? 'Hay peligro enfrente: mejor pasar que quedar corto.' : 'Un palo más, porque tu fallo es quedarte corto.');
        add('bold', e.name, e.m, 'El palo justo, si vienes pegando bien.');
      } else {
        add('best', e.name, e.m, 'El palo justo para esa distancia.');
        add('safe', up.name, up.m, 'Un palo más si vienes pegando corto.');
      }
    } else {
      add('best', H7.name, H7.m, 'Tu golpe recto: avanza seguro y deja un tiro corto.');
      const target = plays - S56.m;
      if (target > 30 && target < H7.m) {
        const x = api.exact(target, f);
        add('safe', x.name, x.m, 'Dos tiros cortos y controlados en vez de forzar uno largo.');
      }
      if (plays <= H4.m + REACH) {
        const e = api.exact(plays, f);
        add('bold', e.name, e.m, 'Directo al green si la conectas bien.');
      } else if (h.lie !== 'rough') {
        add('bold', W3.name, W3.m, `Para mucha distancia.${W3.range ? ` Tu golpe anotado fue ${W3.range}.` : ''}`);
      }
    }
    options.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);

    const tips = [];
    const right = api.summary().right;
    if (h.danger === 'right') tips.push(`Peligro a la derecha y ${Math.round(right)}% de tus salidas se van para allá. Apunta al lado izquierdo.`);
    else if (h.danger === 'left') tips.push('Peligro a la izquierda: apunta al centro.');
    else if (isTee && info.par >= 4) tips.push(`Apunta al lado izquierdo: ${Math.round(right)}% de tus salidas se van a la derecha.`);
    if (live.wind === 'cruz') tips.push('Viento cruzado: apunta un poco hacia donde viene el viento.');

    const why = [];
    if (WIND[live.wind]) why.push('viento');
    if (SLOPE[h.slope]) why.push('terreno');
    if (LIE[h.lie]) why.push(h.lie === 'arena' ? 'arena' : 'rough');
    return { dist, plays, pctAdj, adj, why, options, tips };
  }

  // ---------- pintado ----------
  const chipBtn = (k, v, label, on) => `<button type="button" class="vv-chip" data-a="set" data-k="${k}" data-v="${v}" aria-pressed="${on}">${label}</button>`;
  function renderTop(c, info, h) {
    const nine = c.holes.length === 9;
    const strip = c.holes.map((x) => {
      const s = live.holes[holeKey(live.vuelta, x.n)];
      const st = s && s.done ? (strokesOf(s) <= x.personalPar ? 'good' : 'bad') : '';
      return `<button type="button" class="vv-dot ${st}" data-a="go" data-v="${x.n}" aria-pressed="${x.n === live.hole}" aria-label="Hoyo ${x.n}${s && s.done ? `, ${strokesOf(s)} golpes` : ''}">${s && s.done ? strokesOf(s) : x.n}</button>`;
    }).join('');
    return `
      <div class="vv-card">
        <div class="vv-row">
          <label class="vv-field"><span class="vv-label">Campo</span>
            <select class="vv-select" data-role="course">${api.courses().map((x) => `<option value="${x.key}"${x.key === c.key ? ' selected' : ''}>${x.short}</option>`).join('')}</select>
          </label>
          ${nine ? `<div class="vv-field vv-narrow"><span class="vv-label">Vuelta</span><div class="vv-seg">${[1, 2].map((v) => `<button type="button" data-a="vuelta" data-v="${v}" aria-pressed="${live.vuelta === v}">${v}</button>`).join('')}</div></div>` : ''}
        </div>
        <div class="vv-holehead">
          <button type="button" class="vv-nav" data-a="prev" aria-label="Hoyo anterior">‹</button>
          <div class="vv-holetitle">
            <div class="vv-h">Hoyo ${info.n}</div>
            <div class="vv-sub">Par ${info.par} · ${both(info.len)}</div>
          </div>
          <button type="button" class="vv-nav" data-a="next" aria-label="Hoyo siguiente">›</button>
        </div>
        <div class="vv-strip" role="group" aria-label="Elige hoyo">${strip}</div>
        <div class="vv-stats">
          <div><b class="vv-good">${info.personalPar}</b><span>tu meta</span></div>
          <div><b>${strokesOf(h)}</b><span>golpes aquí</span></div>
          <div><b class="vv-gold">${info.avg != null ? Number(info.avg).toLocaleString('es-MX', { maximumFractionDigits: 1 }) : info.index}</b><span>${info.avg != null ? 'tu promedio' : 'dificultad'}</span></div>
        </div>
      </div>`;
  }

  function renderDistance(info, h) {
    const after = h.shots.length > 0 && !h.touched;
    const max = Math.max(toUnit(info.len), toUnit(h.dist), 30);
    return `
      <div class="vv-card ${after ? 'vv-attn' : ''}">
        <div class="vv-row vv-between">
          <label class="vv-kicker" for="vvDist">${after ? '¿Cuánto te falta ahora?' : '¿Cuánto te falta al green?'}</label>
          <div class="vv-seg">${['yd', 'm'].map((u) => `<button type="button" data-a="unit" data-v="${u}" aria-pressed="${unit === u}">${u === 'yd' ? 'yardas' : 'metros'}</button>`).join('')}</div>
        </div>
        ${after ? '<p class="vv-hint">Corrígelo con lo que marque tu reloj. Así el Caddy aprende cuánto mandas cada palo.</p>' : ''}
        <div class="vv-distrow">
          <button type="button" class="vv-step" data-a="bump" data-v="-10">−10</button>
          <button type="button" class="vv-step" data-a="bump" data-v="-1">−1</button>
          <input id="vvDist" class="vv-distin" type="number" inputmode="numeric" min="1" max="700" value="${toUnit(h.dist) || ''}" aria-label="Distancia al green en ${unit === 'yd' ? 'yardas' : 'metros'}" />
          <button type="button" class="vv-step" data-a="bump" data-v="1">+1</button>
          <button type="button" class="vv-step" data-a="bump" data-v="10">+10</button>
        </div>
        <input id="vvRange" class="vv-range" type="range" min="1" max="${max}" value="${Math.min(toUnit(h.dist) || 1, max)}" aria-label="Deslizar distancia" />
      </div>`;
  }

  function renderConditions(h) {
    const val = (k) => (k === 'wind' ? live.wind : h[k]);
    return `
      <div class="vv-card">
        ${GROUPS.map((g) => `
          <div class="vv-group">
            <div class="vv-label">${g.title}</div>
            <div class="vv-chips" role="group" aria-label="${g.title}">${g.items.map(([v, label]) => chipBtn(g.key, v, label, val(g.key) === v)).join('')}</div>
          </div>`).join('')}
      </div>`;
  }

  function renderDecision() {
    const box = $('vvDecision');
    if (!box) return;
    const h = holeState();
    const c = course();
    const info = curInfo();
    if (!(h.dist > 0)) {
      ui.chosen = null;
      const empty = $('vvAnswer');
      if (empty) empty.innerHTML = '<span class="vv-ansclub">Escribe cuánto te falta</span>';
      box.innerHTML = '<div class="vv-card vv-empty">Escribe cuánto te falta y el Caddy te dice qué tiro hacer.</div>';
      return;
    }
    const d = decide(h, info, c);
    let chosen = d.options.find((o) => o.kind === h.pick) || d.options[0];
    if (h.other) {
      const o = api.shots(c.factor).find((x) => x.name === h.other);
      if (o) {
        const go = o.m / d.adj;
        const left = go + REACH >= d.dist ? 0 : Math.round(d.dist - go);
        chosen = { kind: 'other', club: o.name, m: o.m, shot: left ? go : d.dist, left, why: 'El palo que tú elegiste.' };
      }
    }
    ui.chosen = chosen;
    const bar = $('vvAnswer');
    if (bar) bar.innerHTML = `<span class="vv-ansclub">🏌️ ${chosen.club}</span><span class="vv-ansleft">${chosen.left ? `quedan ${both(chosen.left)}` : 'al green'} ›</span>`;
    const real = realFor(chosen.club);
    const realTip = real && real.med < chosen.shot - 5
      ? `Tus últimos ${real.n} golpes con ${chosen.club} van a ${both(real.med)}. Considera un palo más.`
      : real ? `Tus últimos ${real.n} golpes con ${chosen.club} van a ${both(real.med)}.` : '';
    const pctTxt = d.pctAdj ? ` (${d.pctAdj > 0 ? '+' : '−'}${Math.round(Math.abs(d.pctAdj) * 100)}% por ${d.why.join(', ')})` : '';
    const w = Math.max(4, Math.min(100, (chosen.shot / d.dist) * 100));
    const all = api.shots(c.factor);
    box.innerHTML = `
      <div class="vv-card vv-decide">
        <div class="vv-kicker">Juega como ${both(d.plays)}${pctTxt}</div>
        <div class="vv-options" role="radiogroup" aria-label="Opciones de tiro">
          ${d.options.map((o) => `
            <button type="button" class="vv-opt vv-${o.kind}" role="radio" data-a="pick" data-v="${o.kind}" aria-checked="${!h.other && chosen.kind === o.kind}">
              <span class="vv-optkind">${KIND[o.kind]}</span>
              <span class="vv-optclub">${o.club}</span>
              <span class="vv-optwhy">${o.why}</span>
              <span class="vv-optleft">${o.left ? `Quedan ${both(o.left)}` : 'Al green'}</span>
            </button>`).join('')}
        </div>
        <div class="vv-track" aria-hidden="true"><i style="width:${w}%"></i></div>
        <div class="vv-trackl"><span>Golpe ${both(chosen.shot)}</span><span>${chosen.left ? `quedan ${both(chosen.left)}` : 'al green'}</span></div>
        ${d.tips.concat(realTip ? [realTip] : []).map((t) => `<p class="vv-tip">💡 ${t}</p>`).join('')}
        <label class="vv-field vv-other"><span class="vv-label">¿Prefieres otro palo?</span>
          <select class="vv-select" data-role="other">
            <option value="">Usar la opción de arriba</option>
            ${all.map((o) => `<option value="${o.name}"${o.name === h.other ? ' selected' : ''}>${o.name} · ${both(o.m)}</option>`).join('')}
          </select>
        </label>
        <button type="button" class="vv-primary" data-a="shot">Ya le pegué con ${chosen.club}</button>
        <div class="vv-actions">
          <button type="button" data-a="green">⛳ Ya estoy en el green</button>
          <button type="button" data-a="pen">+1 castigo${h.penalties ? ` (${h.penalties})` : ''}</button>
          ${h.shots.length ? '<button type="button" data-a="undo">↩ Deshacer golpe</button>' : ''}
          <button type="button" data-a="quick">Solo anotar el total</button>
        </div>
      </div>`;
  }

  function renderGreen(h) {
    return `
      <div class="vv-card vv-decide">
        <div class="vv-kicker">En el green</div>
        <p class="vv-hint">Lee la caída, apunta y pega con ritmo. Anota cada putt.</p>
        <div class="vv-counter">
          <button type="button" class="vv-step" data-a="putt" data-v="-1" aria-label="Quitar putt">−</button>
          <div><b>${h.putts}</b><span>putts</span></div>
          <button type="button" class="vv-step" data-a="putt" data-v="1" aria-label="Sumar putt">+</button>
        </div>
        <button type="button" class="vv-primary" data-a="finish">Emboqué · terminar hoyo (${strokesOf(h)} golpes)</button>
        <div class="vv-actions">
          <button type="button" data-a="ungreen">No llegó al green</button>
          <button type="button" data-a="pen">+1 castigo${h.penalties ? ` (${h.penalties})` : ''}</button>
          ${h.shots.length ? '<button type="button" data-a="undo">↩ Deshacer golpe</button>' : ''}
        </div>
      </div>`;
  }

  function renderDone(h, info, c) {
    const s = strokesOf(h);
    const vsMeta = s - info.personalPar;
    const msg = vsMeta < 0 ? `¡${-vsMeta} mejor que tu meta!` : vsMeta === 0 ? 'Igualaste tu meta.' : `${vsMeta} arriba de tu meta. Al siguiente.`;
    const last = live.hole === c.holes.length && !(c.holes.length === 9 && live.vuelta === 1);
    return `
      <div class="vv-card vv-decide">
        <div class="vv-kicker">Hoyo ${info.n} terminado</div>
        <div class="vv-counter">
          <button type="button" class="vv-step" data-a="total" data-v="-1" aria-label="Restar golpe">−</button>
          <div><b class="${vsMeta <= 0 ? 'vv-good' : 'vv-bad'}">${s}</b><span>golpes · par ${info.par}</span></div>
          <button type="button" class="vv-step" data-a="total" data-v="1" aria-label="Sumar golpe">+</button>
        </div>
        <p class="vv-result">${msg}</p>
        ${last ? '' : '<button type="button" class="vv-primary" data-a="nexthole">Siguiente hoyo ›</button>'}
        <div class="vv-actions"><button type="button" data-a="reopen">Seguir editando este hoyo</button></div>
      </div>`;
  }

  function renderRound(c) {
    const nine = c.holes.length === 9;
    let total = 0; let meta = 0; let par = 0; let count = 0;
    let vTotal = 0; let vCount = 0;
    Object.entries(live.holes).forEach(([k, h]) => {
      if (!h.done) return;
      const [v, n] = k.split('-').map(Number);
      const info = c.holes.find((x) => x.n === n);
      if (!info) return;
      const s = strokesOf(h);
      total += s; meta += info.personalPar; par += info.par; count += 1;
      if (v === live.vuelta) { vTotal += s; vCount += 1; }
    });
    const diff = total - meta;
    let goal = '';
    const best = api.summary().best9;
    if (nine && best && vCount > 0 && vCount < 9) {
      const need = best - 1 - vTotal;
      const left = 9 - vCount;
      if (need >= left * 3) goal = `Para romper tu mejor ronda de ${best} necesitas ${need} golpes o menos en los ${left} hoyos que faltan de esta vuelta.`;
    } else if (nine && best && vCount === 9) {
      goal = vTotal < best ? `¡Nueva mejor ronda: ${vTotal}! La anterior era ${best}.` : `Esta vuelta: ${vTotal}. Tu mejor ronda es ${best}.`;
    }
    return `
      <div class="vv-card">
        <div class="vv-row vv-between"><div class="vv-kicker">Tu ronda</div><button type="button" class="vv-link" data-a="newround">Ronda nueva</button></div>
        <div class="vv-stats">
          <div><b>${total}</b><span>golpes</span></div>
          <div><b>${count}</b><span>hoyos</span></div>
          <div><b class="${diff <= 0 ? 'vv-good' : 'vv-bad'}">${count ? (diff > 0 ? `+${diff}` : diff === 0 ? '0' : `−${-diff}`) : '0'}</b><span>contra tu meta</span></div>
          <div><b>${count ? (total - par > 0 ? `+${total - par}` : total - par === 0 ? '0' : `−${par - total}`) : '0'}</b><span>contra par</span></div>
        </div>
        ${goal ? `<p class="vv-tip">🏆 ${goal}</p>` : ''}
        ${count ? '<button type="button" class="vv-secondary" data-a="toscore">Pasar mis golpes a Puntajes</button>' : ''}
      </div>`;
  }

  function render() {
    const root = $('view-vivo');
    if (!root) return;
    const c = course();
    const info = curInfo();
    const h = holeState();
    const play = !h.done && !h.onGreen;
    root.innerHTML = `
      ${renderTop(c, info, h)}
      <div class="vv-grid">
        ${play ? `<div class="vv-col">${renderDistance(info, h)}${renderConditions(h)}</div>` : ''}
        <div class="vv-col">${h.done ? renderDone(h, info, c) : h.onGreen ? renderGreen(h) : '<div id="vvDecision"></div>'}</div>
      </div>
      ${renderRound(c)}
      ${play ? '<button type="button" id="vvAnswer" class="vv-answer" data-a="toanswer" aria-label="Ver la recomendación completa"></button>' : ''}`;
    if (play) renderDecision();
    watchAnswer();
  }

  // En teléfono la recomendación queda abajo: esta barra la mantiene a la vista mientras
  // cambias distancia y condiciones, y se esconde cuando ya se ve la tarjeta completa.
  let answerObs = null;
  function watchAnswer() {
    if (answerObs) answerObs.disconnect();
    const target = $('vvDecision');
    const bar = $('vvAnswer');
    if (!target || !bar || !('IntersectionObserver' in window)) return;
    answerObs = new IntersectionObserver(([e]) => {
      const current = $('vvAnswer');
      if (current) current.classList.toggle('on', !e.isIntersecting);
    }, { rootMargin: '0px 0px -130px 0px' });
    answerObs.observe(target);
  }

  function toast(text) {
    let t = $('vvToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'vvToast';
      t.className = 'vv-toast';
      t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('on'), 2600);
  }

  // ---------- acciones ----------
  function setDist(h, m, from) {
    h.dist = Math.max(0, m);
    h.touched = true;
    const inp = $('vvDist');
    const rng = $('vvRange');
    const v = toUnit(h.dist);
    if (inp && from !== 'input') inp.value = v || '';
    if (rng) {
      if (v > Number(rng.max)) rng.max = v;
      if (from !== 'range') rng.value = v || 1;
    }
    save();
    renderDecision();
  }
  function goHole(n) { live.hole = n; save(); render(); window.scrollTo({ top: 0 }); }
  function nextHole() {
    const c = course();
    if (live.hole < c.holes.length) goHole(live.hole + 1);
    else if (c.holes.length === 9 && live.vuelta === 1) { live.vuelta = 2; goHole(1); }
  }
  function prevHole() {
    const c = course();
    if (live.hole > 1) goHole(live.hole - 1);
    else if (c.holes.length === 9 && live.vuelta === 2) { live.vuelta = 1; goHole(9); }
  }

  function toScore() {
    const g = window.GolfosScore;
    if (!g) return;
    const c = course();
    const items = [];
    Object.entries(live.holes).forEach(([k, h]) => {
      if (!h.done) return;
      const [v, n] = k.split('-').map(Number);
      const info = c.holes.find((x) => x.n === n);
      if (info) items.push({ hole: c.holes.length === 9 ? (v - 1) * 9 + n : n, strokes: strokesOf(h), par: info.par });
    });
    if (!items.length) return;
    if (!confirm(`¿Pasar ${items.length} hoyo${items.length === 1 ? '' : 's'} a Puntajes para ${g.playerName()}? Reemplaza lo que tenga en esos hoyos.`)) return;
    items.forEach((x) => g.setStrokes(x.hole, x.strokes, x.par));
    toast(`Listo: ${items.length} hoyo${items.length === 1 ? '' : 's'} en Puntajes`);
  }

  function onClick(ev) {
    const b = ev.target.closest('[data-a]');
    if (!b || !$('view-vivo').contains(b)) return;
    const a = b.dataset.a;
    const v = b.dataset.v;
    const h = holeState();
    switch (a) {
      case 'prev': prevHole(); break;
      case 'next': case 'nexthole': nextHole(); break;
      case 'go': goHole(Number(v)); break;
      case 'vuelta': live.vuelta = Number(v); live.hole = 1; save(); render(); break;
      case 'unit':
        unit = v;
        try { localStorage.setItem(UNIT_KEY, unit); } catch (e) { /* nada */ }
        render();
        break;
      case 'bump': setDist(h, fromUnit(Math.max(0, toUnit(h.dist) + Number(v)))); break;
      case 'set':
        if (b.dataset.k === 'wind') live.wind = v; else h[b.dataset.k] = v;
        b.parentElement.querySelectorAll('.vv-chip').forEach((x) => x.setAttribute('aria-pressed', x === b));
        h.pick = 'best';
        h.other = '';
        save();
        renderDecision();
        break;
      case 'pick': h.pick = v; h.other = ''; save(); renderDecision(); break;
      case 'shot': {
        if (!ui.chosen) return;
        const o = ui.chosen;
        closeLastShot(h);
        h.shots.push({ id: `${Date.now()}`, club: o.club, from: h.dist, to: null, lie: h.lie });
        h.pick = 'best';
        h.other = '';
        h.touched = false;
        if (o.left > 0) {
          h.dist = o.left;
          h.lie = 'fairway';
        } else {
          h.onGreen = true;
        }
        save();
        render();
        break;
      }
      case 'undo': {
        const s = h.shots.pop();
        if (s) {
          log = log.filter((x) => x.id !== s.id);
          saveLog();
          h.dist = s.from;
          h.lie = s.lie;
          h.onGreen = false;
          h.touched = false;
        }
        save();
        render();
        break;
      }
      case 'pen': h.penalties += 1; save(); render(); break;
      case 'green': closeLastShot(h); h.onGreen = true; save(); render(); break;
      case 'ungreen': h.onGreen = false; h.dist = h.dist > 0 && h.dist <= 40 ? h.dist : 20; h.lie = 'fairway'; h.touched = false; save(); render(); break;
      case 'putt': h.putts = Math.max(0, h.putts + Number(v)); save(); render(); break;
      case 'finish': h.done = true; h.total = null; save(); render(); break;
      case 'quick': h.done = true; h.total = Math.max(strokesOf(h), curInfo().par); save(); render(); break;
      case 'total': h.total = Math.max(1, strokesOf(h) + Number(v)); save(); render(); break;
      case 'reopen': h.done = false; h.total = null; save(); render(); break;
      case 'toscore': toScore(); break;
      case 'toanswer': {
        const t = $('vvDecision');
        if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 72, behavior: 'smooth' });
        break;
      }
      case 'newround':
        if (!hasData() || confirm('¿Empezar una ronda nueva? Se borra la ronda en curso del modo En vivo. Tus Puntajes no se tocan.')) {
          live = freshRound(live.course);
          save();
          render();
          window.scrollTo({ top: 0 });
        }
        break;
      default:
    }
  }
  function onInput(ev) {
    const h = holeState();
    if (ev.target.id === 'vvDist') setDist(h, fromUnit(Number(ev.target.value) || 0), 'input');
    if (ev.target.id === 'vvRange') {
      const inp = $('vvDist');
      if (inp) inp.value = ev.target.value;
      setDist(h, fromUnit(Number(ev.target.value)), 'range');
    }
  }
  function onChange(ev) {
    const role = ev.target.dataset && ev.target.dataset.role;
    if (role === 'other') {
      const h = holeState();
      h.other = ev.target.value;
      save();
      renderDecision();
    }
    if (role === 'course') {
      const key = ev.target.value;
      if (hasData() && !confirm('Cambiar de campo empieza una ronda nueva en En vivo. Tus Puntajes no se tocan. ¿Seguimos?')) {
        ev.target.value = live.course;
        return;
      }
      live = freshRound(key);
      api.setCourse(key);
      save();
      render();
    }
  }

  async function show() {
    const root = $('view-vivo');
    if (!root) return;
    if (!api) {
      if (!window.CaddyPTC || !window.CaddyPTC.vivo) return;
      api = window.CaddyPTC.vivo;
    }
    if (!live) {
      root.innerHTML = '<div class="vv-card vv-empty">⛳ Preparando tu Caddy…</div>';
      try {
        await api.ready();
      } catch (err) {
        root.innerHTML = `<div class="vv-card vv-empty">No pude cargar tus datos (${String(err.message || err)}). Revisa la conexión y vuelve a abrir la app.</div>`;
        return;
      }
      loadLive();
      const hc = $('cxHcp');
      if (hc) hc.textContent = api.summary().handicap;
    }
    if (!bound) {
      root.addEventListener('click', onClick);
      root.addEventListener('input', onInput);
      root.addEventListener('change', onChange);
      bound = true;
    }
    render();
  }

  window.CaddyVivo = { show };
  const view = $('view-vivo');
  if (view && !view.classList.contains('hidden')) show();
})();
