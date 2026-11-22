// Lectura óptica básica de partituras sobre una imagen en escala de grises.
// gray: Uint8Array (0 = negro, 255 = blanco), w, h en píxeles.
(function (root) {
  const TH = 185;

  // ───────── Pentagramas ─────────
  function detectStaves(gray, w, h) {
    const dark = (x, y) => gray[y * w + x] < 190;
    const minRun = Math.max(40, Math.floor(w * 0.18));
    const maxGap = 3;
    const rows = [];
    for (let y = 0; y < h; y++) {
      let best = 0, bestStart = 0, bestEnd = 0, run = 0, gap = 0, start = -1;
      for (let x = 0; x < w; x++) {
        if (dark(x, y)) {
          if (start < 0) start = x;
          run += gap + 1; gap = 0;
          if (run > best) { best = run; bestStart = start; bestEnd = x; }
        } else if (start >= 0) {
          gap++;
          if (gap > maxGap) { run = 0; gap = 0; start = -1; }
        }
      }
      if (best >= minRun) rows.push({ y, x0: bestStart, x1: bestEnd, len: best });
    }
    const groups = [];
    for (const r of rows) {
      const last = groups[groups.length - 1];
      if (last && r.y - last[last.length - 1].y <= 1) last.push(r); else groups.push([r]);
    }
    // una línea puede quedar pegada a una ligadura larga: quedarse con las filas más largas
    const lines = groups.map(gr => {
      const mx = Math.max(...gr.map(r => r.len));
      const core = gr.filter(r => r.len >= mx * 0.85);
      return { yStart: core[0].y, yEnd: core[core.length - 1].y, x0: Math.min(...core.map(r => r.x0)), x1: Math.max(...core.map(r => r.x1)) };
    });
    for (const l of lines) l.y = (l.yStart + l.yEnd) / 2;
    const staves = [];
    let i = 0;
    const evalGroup = j => {
      if (j + 4 >= lines.length) return null;
      const g = lines.slice(j, j + 5);
      const gaps = [];
      for (let k = 1; k < 5; k++) gaps.push(g[k].y - g[k - 1].y);
      const mean = gaps.reduce((a, b) => a + b, 0) / 4;
      const dev = Math.max(...gaps.map(d => Math.abs(d - mean)));
      const ok = mean >= 4 && dev <= Math.max(1.5, mean * 0.2);
      const overlap = g.map(l => l.x1).sort((a, b) => a - b)[2] - g.map(l => l.x0).sort((a, b) => a - b)[2];
      return ok && overlap > minRun * 0.8 ? { g, mean, dev } : null;
    };
    while (i + 4 < lines.length) {
      let r = evalGroup(i);
      // una ligadura larga puede parecer una línea más: probar el grupo corrido una línea
      if (r) { const r2 = evalGroup(i + 1); if (r2 && r2.dev + 0.5 < r.dev && lines[i + 5].y - lines[i + 4].y < r.mean * 1.3) { i++; r = r2; } }
      const g = r && r.g, mean = r && r.mean;
      if (r) {
        staves.push({
          lines: g.map(l => l.y),
          lineRows: g.map(l => [l.yStart, l.yEnd]),
          top: g[0].y, bottom: g[4].y, space: mean,
          x0: Math.round(g.map(l => l.x0).sort((a, b) => a - b)[2]),
          x1: Math.round(g.map(l => l.x1).sort((a, b) => a - b)[2])
        });
        i += 5;
      } else i++;
    }
    let sys = 0, pos = 0;
    staves.forEach((s, idx) => {
      if (idx > 0) {
        const p = staves[idx - 1];
        if (!verticallyConnected(gray, w, p, s)) { sys++; pos = 0; } else pos++;
      }
      s.system = sys; s.pos = pos;
      s.clef = guessClef(gray, w, h, s);
    });
    const sizes = {};
    staves.forEach(s => { sizes[s.system] = (sizes[s.system] || 0) + 1; });
    staves.forEach(s => { s.systemSize = sizes[s.system]; });
    staves.forEach(s => { try { const k = detectKey(gray, w, h, s); s.key = k.key; s.keyEnd = k.endX; s.contentX = k.contentX || k.endX; } catch (e) { s.key = 0; s.keyEnd = s.x0 + s.space * 4; } });
    // Armadura por sistema: la más votada (los errores aislados se corrigen)
    const bySys = {};
    staves.forEach(s => { (bySys[s.system] = bySys[s.system] || []).push(s.key); });
    staves.forEach(s => {
      const votes = {}; bySys[s.system].forEach(k => votes[k] = (votes[k] || 0) + 1);
      let best = s.key, n = 0;
      for (const [k, c] of Object.entries(votes)) if (c > n || (c === n && Math.abs(+k) > Math.abs(best))) { n = c; best = +k; }
      s.sysKey = best;
    });
    return staves;
  }

  function verticallyConnected(gray, w, a, b) {
    const y0 = Math.ceil(a.bottom + 2), y1 = Math.floor(b.top - 2);
    if (y1 <= y0) return true;
    const xl = Math.min(a.x0, b.x0);
    for (let x = xl - Math.round(a.space * 1.2); x <= xl + 3; x++) {
      if (x < 0 || x >= w) continue;
      let darkCount = 0;
      for (let y = y0; y <= y1; y++) if (gray[y * w + x] < 140) darkCount++;
      if (darkCount >= (y1 - y0 + 1) * 0.9) return true;
    }
    return false;
  }

  function guessClef(gray, w, h, s) {
    const sp = s.space;
    const xa = Math.round(s.x0 + sp * 0.4), xb = Math.round(s.x0 + sp * 3.6);
    // columnas de corchete o barra de sistema (líneas verticales largas): no cuentan
    const skip = new Set();
    const fa = Math.max(0, Math.round(s.top - sp * 3)), fb = Math.min(h - 1, Math.round(s.bottom + sp * 3));
    for (let x = Math.max(0, xa); x <= Math.min(w - 1, xb); x++) {
      let c = 0; for (let y = fa; y <= fb; y++) if (gray[y * w + x] < 140) c++;
      if (c > (fb - fa + 1) * 0.96) skip.add(x);
    }
    const count = (ya, yb) => {
      let c = 0;
      ya = Math.max(0, Math.round(ya)); yb = Math.min(h - 1, Math.round(yb));
      for (let y = ya; y <= yb; y++)
        for (let x = Math.max(0, xa); x <= Math.min(w - 1, xb); x++)
          if (!skip.has(x) && gray[y * w + x] < 140) c++;
      return c;
    };
    const area = (sp * 0.9) * (xb - xa);
    const above = count(s.top - sp * 1.5, s.top - sp * 0.6) / area;
    const below = count(s.bottom + sp * 0.6, s.bottom + sp * 1.4) / area;
    const deep = count(s.bottom + sp * 1.7, s.bottom + sp * 2.8) / ((sp * 1.1) * (xb - xa));
    if (above > 0.02 && below > 0.02) return deep > 0.03 ? 'treble8' : 'treble';
    return 'bass';
  }

  // ───────── Máscara sin líneas del pentagrama ─────────
  function makeInk(gray, w, h, s) {
    const lineRow = new Map();
    const th = Math.max(1, Math.round(s.space * 0.12));
    s.lineRows.forEach(([a, b]) => { for (let y = a - 1; y <= b + 1; y++) lineRow.set(y, [a - 1 - th, b + 1 + th]); });
    // líneas adicionales (de ledger) no se quitan: son cortas
    return (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      if (gray[y * w + x] >= TH) return false;
      const lr = lineRow.get(y);
      if (!lr) return true;
      // en una fila de línea: queda solo si hay tinta arriba o abajo de la línea
      const up = lr[0], dn = lr[1];
      return (up >= 0 && gray[up * w + x] < TH) || (dn < h && gray[dn * w + x] < TH);
    };
  }

  // Componentes conexas en una región (con la máscara de tinta)
  function components(ink, x0, y0, x1, y1, maxComps = 400) {
    const W = x1 - x0 + 1, H = y1 - y0 + 1;
    if (W <= 0 || H <= 0) return [];
    const seen = new Uint8Array(W * H);
    const out = [];
    const stack = [];
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
      const idx = yy * W + xx;
      if (seen[idx]) continue;
      seen[idx] = 1;
      if (!ink(x0 + xx, y0 + yy)) continue;
      const c = { minX: xx, maxX: xx, minY: yy, maxY: yy, n: 0, pts: [] };
      stack.push(idx);
      while (stack.length) {
        const k = stack.pop();
        const cx = k % W, cy = (k - cx) / W;
        c.n++; c.pts.push(k);
        if (cx < c.minX) c.minX = cx; if (cx > c.maxX) c.maxX = cx;
        if (cy < c.minY) c.minY = cy; if (cy > c.maxY) c.maxY = cy;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (seen[ni]) continue;
          seen[ni] = 1;
          if (ink(x0 + nx, y0 + ny)) stack.push(ni);
        }
      }
      c.x0 = x0 + c.minX; c.x1 = x0 + c.maxX; c.y0 = y0 + c.minY; c.y1 = y0 + c.maxY;
      c.W = W; c.ox = x0; c.oy = y0;
      out.push(c);
      if (out.length >= maxComps) return out;
    }
    return out;
  }

  // Une componentes muy próximos (un signo partido por el antialias o por quitar líneas)
  function mergeClose(comps, gap) {
    // solo se unen trozos chicos (partes de un mismo signo), nunca grupos grandes
    const lim = gap / 0.15 * 1.5;
    comps = comps.slice().sort((a, b) => a.x0 - b.x0);
    comps.forEach(c => c.spLimit = lim);
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < comps.length && !changed; i++) for (let j = i + 1; j < comps.length; j++) {
        const a = comps[i], b = comps[j];
        if (b.x0 - a.x1 > gap) break;
        if ((a.x1 - a.x0) > a.spLimit || (b.x1 - b.x0) > b.spLimit) continue;
        const hov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) >= -gap;
        const vov = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0;
        if (hov && vov) {
          const m = { x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1), n: a.n + b.n, pts: a.pts.concat(b.pts), W: a.W, ox: a.ox, oy: a.oy, spLimit: lim };
          comps.splice(j, 1); comps[i] = m; changed = true; break;
        }
      }
    }
    return comps;
  }

  function subComp(c, xa, xb) {
    const pts = [];
    let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
    for (const k of c.pts) {
      const x = (k % c.W) + c.ox, y = Math.floor(k / c.W) + c.oy;
      if (x < xa || x > xb) continue;
      pts.push(k); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    if (!pts.length) return null;
    return { x0, x1, y0, y1, n: pts.length, pts, W: c.W, ox: c.ox, oy: c.oy };
  }

  // Une la plica de un bemol con su panza cuando quedaron separadas (antialias)
  function joinFlatParts(comps, sp) {
    comps = comps.slice().sort((a, b) => a.x0 - b.x0);
    for (let i = 0; i < comps.length; i++) {
      const a = comps[i];
      if (!a) continue;
      const aw = a.x1 - a.x0 + 1, ah = a.y1 - a.y0 + 1;
      if (aw > sp * 0.32 || ah < sp * 1.5 || ah > sp * 3.2) continue;      // plica fina
      for (let j = i + 1; j < comps.length; j++) {
        const b = comps[j];
        if (!b) continue;
        if (b.x0 - a.x1 > sp * 0.4) break;
        const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
        if (b.x0 < a.x1 - 1 || bw > sp * 0.95 || bh > sp * 1.4) continue;
        // la panza está en la mitad inferior de la plica
        if (b.y0 < a.y0 + ah * 0.4 || b.y1 > a.y1 + sp * 0.2) continue;
        comps[i] = { x0: a.x0, x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1), n: a.n + b.n, pts: a.pts.concat(b.pts), W: a.W, ox: a.ox, oy: a.oy };
        comps[j] = null;
        break;
      }
    }
    return comps.filter(Boolean);
  }

  // Clasifica un signo de alteración: 'sharp' | 'flat' | 'natural' | null
  // y devuelve la posición vertical (y) que indica.
  function classifyAccidental(c, sp) {
    const w = c.x1 - c.x0 + 1, hgt = c.y1 - c.y0 + 1;
    if (w < sp * 0.35 || w > sp * 1.45 || hgt < sp * 1.6 || hgt > sp * 3.3) return null;
    if (c.n / (w * hgt) > 0.62) return null; // demasiado macizo: no es un signo
    // trazos verticales: columnas con una corrida vertical larga
    const colRun = new Array(w).fill(0), colTop = new Array(w).fill(Infinity), colBot = new Array(w).fill(-1);
    const grid = new Uint8Array(w * hgt);
    for (const k of c.pts) {
      const x = (k % c.W) + c.ox - c.x0, y = Math.floor(k / c.W) + c.oy - c.y0;
      grid[y * w + x] = 1;
    }
    for (let x = 0; x < w; x++) {
      let run = 0, best = 0, bs = 0, be = 0, st = 0;
      for (let y = 0; y < hgt; y++) {
        if (grid[y * w + x]) { if (!run) st = y; run++; if (run > best) { best = run; bs = st; be = y; } } else run = 0;
      }
      colRun[x] = best; colTop[x] = bs; colBot[x] = be;
    }
    const strokes = [];
    let cur = null;
    for (let x = 0; x < w; x++) {
      if (colRun[x] >= sp * 1.3) {
        if (!cur) { cur = { a: x, b: x, top: colTop[x], bot: colBot[x] }; strokes.push(cur); }
        else { cur.b = x; cur.top = Math.min(cur.top, colTop[x]); cur.bot = Math.max(cur.bot, colBot[x]); }
      } else cur = null;
    }
    if (strokes.length === 1) {
      const s = strokes[0];
      // bemol: el trazo está a la izquierda y el cuerpo abajo
      if (s.a > w * 0.45) return null;
      // densidad: mitad inferior con más tinta que la superior
      let topInk = 0, botInk = 0;
      for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) if (grid[y * w + x]) (y < hgt / 2 ? topInk++ : botInk++);
      if (botInk < topInk * 1.15) return null;
      return { type: 'flat', y: c.y1 - sp * 0.6 };
    }
    if (strokes.length === 2) {
      const [l, r] = strokes;
      const dTop = (r.top - l.top), dBot = (r.bot - l.bot);
      if (dTop > sp * 0.5 && dBot > sp * 0.5) return { type: 'natural', y: (c.y0 + c.y1) / 2 };
      return { type: 'sharp', y: (c.y0 + c.y1) / 2 };
    }
    return null;
  }

  // ───────── Armadura ─────────
  // pasos sobre la línea inferior, clave de sol
  const SHARP_STEPS = [8, 5, 9, 6, 3, 7, 4];
  const FLAT_STEPS = [4, 7, 3, 6, 2, 5, 1];
  const CLEF_SHIFT = { treble: 0, treble8: 0, bass: -2 };

  function detectKey(gray, w, h, s) {
    const sp = s.space;
    const ink = makeInk(gray, w, h, s);
    const xa = Math.round(s.x0 + sp * 0.3), xb = Math.min(w - 1, Math.round(s.x0 + sp * 14));
    const ya = Math.max(0, Math.round(s.top - sp * 2.5)), yb = Math.min(h - 1, Math.round(s.bottom + sp * 2));
    let comps = components(ink, xa, ya, xb, yb).filter(c => c.n > 4);
    comps = joinFlatParts(mergeClose(comps, Math.max(2, sp * 0.15)), sp).filter(c => (c.y1 - c.y0) > sp * 0.25).sort((a, b) => a.x0 - b.x0);
    if (!comps.length) return { key: 0, endX: xa };
    // clave: el primer componente grande
    let ci = comps.findIndex(c => (c.y1 - c.y0) >= sp * 2.4 && (c.x1 - c.x0) >= sp * 1.4);
    if (ci < 0) return { key: 0, endX: xa };
    let afterClef = comps[ci].x1;
    let i = ci + 1;
    // puntos de la clave de fa / el 8 de la clave octavada
    while (i < comps.length && comps[i].x0 < afterClef + sp * 0.6 && (comps[i].y1 - comps[i].y0) < sp * 1.2) { afterClef = Math.max(afterClef, comps[i].x1); i++; }
    const accs = [];
    let lastX = afterClef;
    for (; i < comps.length && accs.length < 7; i++) {
      const c = comps[i];
      if (c.x0 - lastX > sp * (accs.length ? 1.6 : 2.8)) break;
      if (c.x0 < lastX - sp * 0.2) continue; // superpuesto
      const a = classifyAccidental(c, sp);
      if (!a || a.type === 'natural') break;
      if (accs.length && accs[0].type !== a.type) break;
      accs.push(a); lastX = c.x1;
    }
    // barras de repetición / doble barra y sus puntos justo después de la armadura
    const skipBars = endX => {
      let e = endX, moved = true;
      while (moved) {
        moved = false;
        for (const c of comps) {
          if (c.x0 < e - 1 || c.x0 > e + sp * 1.6) continue;
          const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1;
          let full = 0;
          if (cw < sp * 2.2 && ch >= sp * 3.7 && c.y0 <= s.top + 2 && c.y1 >= s.bottom - 2) {
            for (let x = c.x0; x <= c.x1; x++) { let k = 0, n = 0; for (let y = Math.round(s.top); y <= Math.round(s.bottom); y++) { n++; if (gray[y * w + x] < TH) k++; } if (k >= n * 0.97) full++; }
          }
          const bar = (cw < sp * 0.8 && full >= 1) || full >= sp * 0.3;
          const dot = cw < sp * 0.7 && ch < sp * 0.7 && c.y0 > s.top && c.y1 < s.bottom;
          if ((bar || dot) && c.x1 > e) { e = c.x1; moved = true; }
        }
      }
      return e;
    };
    const timeSig0 = endX => {
      // cifra de compás: dos cifras apiladas dentro del pentagrama justo después
      const cand = comps.filter(c => c.x0 >= endX - sp * 0.2 && c.x0 <= endX + sp * 2.2 && c.y0 >= s.top - sp * 0.4 && c.y1 <= s.bottom + sp * 0.4 && (c.y1 - c.y0) >= sp * 0.9 && (c.y1 - c.y0) <= sp * 2.4);
      for (const a of cand) for (const b of cand) if (a !== b && b.y0 > a.y1 - 2 && Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > sp * 0.3)
        return Math.max(endX, ...cand.filter(c => c.x0 <= Math.max(a.x1, b.x1) - sp * 0.3 && c.x1 >= Math.min(a.x0, b.x0)).map(c => c.x1));
      // 4/4 pegados en un solo trazo, o C / C barrada
      const mid = (s.top + s.bottom) / 2;
      for (const c of cand.concat(comps.filter(c => c.x0 >= endX - sp * 0.2 && c.x0 <= endX + sp * 2.2 && c.y0 >= s.top - sp * 0.4 && c.y1 <= s.bottom + sp * 0.4))) {
        const hh = (c.y1 - c.y0) / sp, ww = (c.x1 - c.x0) / sp;
        if (hh >= 3.3 && ww >= 0.9 && ww <= 2.6) return c.x1;
        if (hh >= 1.6 && hh <= 2.4 && ww >= 0.9 && ww <= 1.7 && Math.abs((c.y0 + c.y1) / 2 - mid) < sp * 0.45) return c.x1;
      }
      return endX;
    };
    const timeSig = endX => timeSig0(skipBars(endX));
    if (!accs.length) { const e = timeSig(afterClef); return { key: 0, endX: afterClef, contentX: e + sp * 0.3 }; }
    const shift = CLEF_SHIFT[s.clef] || 0;
    const pattern = (accs[0].type === 'sharp' ? SHARP_STEPS : FLAT_STEPS).map(v => v + shift);
    let n = 0;
    for (let k = 0; k < accs.length; k++) {
      const step = (s.bottom - accs[k].y) / (sp / 2);
      if (Math.abs(step - pattern[k]) <= 1.2) n++; else break;
    }
    return { key: accs[0].type === 'sharp' ? n : -n, endX: lastX, contentX: timeSig(lastX) + sp * 0.3 };
  }

  // ───────── Cabezas de nota ─────────
  function ellipseStats(ink, cx, cy, a, b) {
    let tot = 0, dk = 0;
    const ax = Math.ceil(a), by = Math.ceil(b);
    for (let dy = -by; dy <= by; dy++) for (let dx = -ax; dx <= ax; dx++) {
      if ((dx * dx) / (a * a) + (dy * dy) / (b * b) > 1) continue;
      tot++; if (ink(Math.round(cx + dx), Math.round(cy + dy))) dk++;
    }
    return tot ? dk / tot : 0;
  }
  function ringStats(ink, cx, cy, a1, b1, a2, b2) {
    let tot = 0, dk = 0;
    const ax = Math.ceil(a1), by = Math.ceil(b1);
    for (let dy = -by; dy <= by; dy++) for (let dx = -ax; dx <= ax; dx++) {
      const o = (dx * dx) / (a1 * a1) + (dy * dy) / (b1 * b1);
      const n = (dx * dx) / (a2 * a2) + (dy * dy) / (b2 * b2);
      if (o > 1 || n <= 1) continue;
      tot++; if (ink(Math.round(cx + dx), Math.round(cy + dy))) dk++;
    }
    return tot ? dk / tot : 0;
  }

  // Busca la cabeza de nota más cercana al toque. Devuelve {x, y, step, filled} o null.
  function findNotehead(gray, w, h, s, x, y, nested) {
    const sp = s.space;
    const raw = (px, py) => px >= 0 && py >= 0 && px < w && py < h && gray[py * w + px] < TH;
    const ink = makeInk(gray, w, h, s);
    // celdas candidatas: pasos (líneas y espacios) cerca del toque
    const stepAt = yy => Math.round((s.bottom - yy) / (sp / 2));
    const st0 = stepAt(y);
    let best = null;
    const cands = [];
    const rx = sp * 1.5;
    for (let st = st0 - 3; st <= st0 + 3; st++) {
      const cy = s.bottom - st * sp / 2;
      if (Math.abs(cy - y) > sp * 1.4) continue;
      for (let cx = Math.round(x - rx); cx <= Math.round(x + rx); cx++) {
        // usamos la imagen cruda (las líneas forman parte de la cabeza si la atraviesan)
        const fill = ellipseStats(raw, cx, cy, sp * 0.48, sp * 0.32);
        let kind = null, score = 0;
        if (fill > 0.86) { kind = 'filled'; score = fill; }
        else {
          // blanca (ancho 1) o redonda (más ancha y achatada)
          // filas de una línea fina que cruza el hueco (no una barra gruesa de corcheas)
          const t2 = Math.max(3, Math.round(sp * 0.25));
          const thinAt = (px, yy) => raw(px, yy) && !(raw(px, yy - t2) && raw(px, yy + t2)) && !(raw(px, yy - t2 + 1) && raw(px, yy + t2 - 1));
          let probeX = 0.75;
          const lineRowAt = yy => thinAt(Math.round(cx - sp * probeX), yy) && thinAt(Math.round(cx + sp * probeX), yy);
          const lineNear = py => s.lines.some(l => Math.abs(l - py) < Math.max(2, sp * 0.1));
          const holeInk = (px, py) => !lineRowAt(py) && !lineNear(py) && raw(px, py);
          const near = (px, py) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (raw(Math.round(px) + dx, Math.round(py) + dy)) return true; return false; };
          for (const [wx, ox1, oy1, ix, iy, thr] of [[1, 0.6, 0.47, 0.36, 0.22, 0.55], [1.5, 0.92, 0.46, 0.5, 0.2, 0.45]]) {
            probeX = 0.62 * wx + 0.2;
            const ring = ringStats(raw, cx, cy, sp * ox1, sp * oy1, sp * ix, sp * iy);
            const inner = ellipseStats(holeInk, cx, cy, sp * 0.22 * wx, sp * 0.13, 0);
            if (!(ring > thr && inner < 0.35)) continue;
            // en el centro del hueco solo puede haber blanco o una línea fina
            let centerRun = Infinity;
            for (const dx of [-0.12, 0, 0.12]) {
              const px = Math.round(cx + dx * sp);
              let r = 0;
              if (raw(px, Math.round(cy))) { r = 1; for (let yy = Math.round(cy) - 1; raw(px, yy) && r < sp; yy--) r++; for (let yy = Math.round(cy) + 1; raw(px, yy) && r < sp; yy++) r++; }
              centerRun = Math.min(centerRun, r);
            }
            if (centerRun > sp * 0.24) continue;
            // contorno cerrado en las 8 direcciones
            let sides = 0;
            for (let k = 0; k < 8; k++) {
              const ang = k * Math.PI / 4;
              let hit = false;
              for (let r = 0.18; r <= 0.62 && !hit; r += 0.04) hit = near(cx + Math.cos(ang) * sp * r * 1.25 * wx, cy + Math.sin(ang) * sp * r * 0.85);
              if (hit) sides++;
            }
            if (sides < 8) continue;
            // un becuadro o un sostenido también encierran un hueco, pero tienen trazos que salen arriba y abajo
            let arms = 0;
            const armHits = [];
            for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
              let hit = false;
              for (const dyf of [0.9, 1.05]) {
                const py = Math.round(cy + sy * dyf * sp);
                if (onLine(s, py)) continue;
                for (let xx = Math.round(sp * 0.04); xx <= Math.round(sp * 0.42) && !hit; xx++) hit = raw(Math.round(cx + sx * xx), py);
              }
              armHits.push(hit);
              if (hit) arms++;
            }
            if (arms >= 3 && wx === 1) continue;
            if (wx > 1 && ((armHits[0] && armHits[3]) || (armHits[1] && armHits[2]))) continue;   // trazos en diagonal: ♮
            // paredes laterales del óvalo a la altura del centro
            let wl = false, wr = false;
            for (const dyf of [-0.32, -0.2, 0, 0.2, 0.32]) {
              const py = Math.round(cy + dyf * sp);
              if (onLine(s, py)) continue;
              for (let xx = Math.round(sp * 0.25); xx <= Math.round(sp * (0.55 * wx + 0.15)); xx++) { if (raw(Math.round(cx - xx), py)) wl = true; if (raw(Math.round(cx + xx), py)) wr = true; }
            }
            if (!(wl && wr)) continue;
            // las paredes de arriba y abajo de una cabeza hueca son finas (una barra de corcheas no)
            let thick = false;
            for (const dir of [-1, 1]) {
              let yy = Math.round(cy), guard = 0;
              while (!raw(Math.round(cx), yy) && guard++ < sp) yy += dir;       // atravesar el hueco
              let run = 0;
              while (raw(Math.round(cx), yy) && run < sp) { run++; yy += dir; }
              if (run > sp * 0.42) thick = true;
            }
            if (thick) continue;
            if (wx > 1) {
              // una redonda no tiene plica: si hay un trazo vertical largo pegado, es otra cosa
              let stem = false;
              for (const sgn of [-1, 1]) for (let xx = Math.round(sp * 0.45); xx <= Math.round(sp * 0.9) && !stem; xx++) {
                const px = Math.round(cx + sgn * xx);
                let up = 0, dn = 0;
                for (let yy = Math.round(cy); yy > cy - sp * 2.2 && raw(px, yy); yy--) up++;
                for (let yy = Math.round(cy); yy < cy + sp * 2.2 && raw(px, yy); yy++) dn++;
                if (up + dn >= sp * 1.7) stem = true;
              }
              if (stem) continue;
            }
            // alrededor de una cabeza hay blanco (salvo plica, líneas y ligaduras finas)
            const outer = ringStats((px, py) => !onLine(s, py) && raw(px, py), cx, cy, sp * (0.62 * wx + 0.45), sp * 0.78, sp * (0.62 * wx + 0.15), sp * 0.55);
            if (outer > 0.3) continue;
            if (wx > 1 && outer > 0.18) continue;
            // ¿es en realidad un signo (♮ ♯ ♭)? se mira la mancha que contiene el hueco
            const comps = components(ink, Math.round(cx - sp * 1.3), Math.round(cy - sp * 1.9), Math.round(cx + sp * 1.3), Math.round(cy + sp * 1.9)).filter(c => c.n > 3);
            const isSign = comps.some(c => c.x0 <= cx && c.x1 >= cx && c.y0 < cy && c.y1 > cy && c.x0 > cx - sp * 1.25 && c.x1 < cx + sp * 1.25 && c.y0 > cy - sp * 1.85 && c.y1 < cy + sp * 1.85 && classifyAccidental(c, sp));
            if (isSign) continue;
            kind = wx > 1 ? 'whole' : 'hollow'; score = ring * 0.85 * (wx > 1 ? 1.1 : 1); break;
          }
        }
        if (!kind) continue;
        // barra de compás atravesando el centro: no es una nota
        {
          let bar = false;
          for (let xx = Math.round(cx - sp * 0.2); xx <= Math.round(cx + sp * 0.2) && !bar; xx++) {
            let c = 0, n = 0;
            for (let yy = Math.round(s.top); yy <= Math.round(s.bottom); yy++) { n++; if (raw(xx, yy)) c++; }
            if (c >= n * 0.97) bar = true;
          }
          if (bar) continue;
        }
        // no es una barra de corchea / texto: a los costados no debe seguir la tinta
        const side = sp * 1.15;
        const l = raw(Math.round(cx - side), Math.round(cy)) && raw(Math.round(cx - side), Math.round(cy - sp * 0.2)) && !onLine(s, cy);
        const r = raw(Math.round(cx + side), Math.round(cy)) && raw(Math.round(cx + side), Math.round(cy - sp * 0.2)) && !onLine(s, cy);
        if (l && r) continue;
        // ancho horizontal de la mancha: una cabeza mide ~1.2 espacios; una barra de corcheas, mucho más
        const ext = yy => {
          const gapMax = Math.max(1, Math.round(sp * 0.1));
          let a = cx, b = cx, g = 0;
          for (let xx = cx - 1; xx > cx - sp * 3; xx--) { if (raw(xx, yy)) { a = xx; g = 0; } else if (++g > gapMax) break; }
          g = 0;
          for (let xx = cx + 1; xx < cx + sp * 3; xx++) { if (raw(xx, yy)) { b = xx; g = 0; } else if (++g > gapMax) break; }
          return (b - a) / sp;
        };
        const e1 = ext(Math.round(cy - sp * 0.2)), e2 = ext(Math.round(cy + sp * 0.2));
        if (Math.min(e1, e2) > 2.1 || Math.max(e1, e2) > 2.4) continue;
        if (cx < (s.contentX || s.x0)) continue;
        if (!ledgersOk(raw, s, cx, st)) continue;
        // arriba y abajo de la cabeza (salvo plica) debe haber blanco en algún lado
        const above = ellipseStats(ink, cx, cy - sp * 0.9, sp * 0.45, sp * 0.18);
        const below = ellipseStats(ink, cx, cy + sp * 0.9, sp * 0.45, sp * 0.18);
        if (above > 0.7 && below > 0.7) continue;
        const d = Math.hypot((cx - x) / sp, (cy - y) / sp);
        const val = score - d * 0.12 + (kind === 'filled' ? 0.1 : 0);
        cands.push({ x: cx, y: cy, step: st, kind, val, d });
        if (!best || val > best.val) best = cands[cands.length - 1];
      }
    }
    if (!best || best.d > 1.6) return null;
    // una "cabeza hueca" pegada a una cabeza llena es un fantasma del borde de la llena
    if (best.kind === 'filled') {
      // entre dos cabezas de un acorde (a distancia de tercera) aparece una "cabeza" fantasma
      const fillAt = st => { let m = 0; const cy = s.bottom - st * sp / 2; for (let dx = -3; dx <= 3; dx++) m = Math.max(m, ellipseStats(raw, best.x + dx, cy, sp * 0.48, sp * 0.32)); return m; };
      const up = fillAt(best.step + 1), dn = fillAt(best.step - 1);
      if (up > 0.86 && dn > 0.86) {
        const st = Math.abs((s.bottom - (best.step + 1) * sp / 2) - y) < Math.abs((s.bottom - (best.step - 1) * sp / 2) - y) ? best.step + 1 : best.step - 1;
        best = { x: best.x, y: s.bottom - st * sp / 2, step: st, kind: 'filled', d: best.d };
      }
    }
    if (best.kind === 'hollow' || best.kind === 'whole') {
      // fantasma de una cabeza llena vecina: usar la llena (solo candidatas ya validadas)
      const span = best.kind === 'whole' ? 1.4 : 0.8;
      const f = cands.filter(c => c.kind === 'filled' && Math.abs(c.x - best.x) <= sp * span && Math.abs(c.step - best.step) <= 1)
        .sort((p, q) => q.val - p.val)[0];
      if (f) best = f;
      else if (!nested) {
        // buscar también alrededor del fantasma (la cabeza llena puede quedar fuera de la ventana del toque)
        const g2 = findNotehead(gray, w, h, s, best.x, best.y, true);
        if (g2 && g2.kind === 'filled' && Math.abs(g2.x - best.x) <= sp * (span + 0.3) && Math.abs(g2.step - best.step) <= 1) best = { ...g2, d: best.d };
      }
    }
    // refinar centro horizontal: promedio de las x válidas en esa fila de paso
    return best;
  }
  // Una nota fuera del pentagrama necesita sus líneas adicionales (descarta letras de la letra)
  function ledgersOk(raw, s, cx, step) {
    const sp = s.space;
    const need = [];
    for (let k = -2; k >= step; k -= 2) need.push(k);
    for (let k = 10; k <= step; k += 2) need.push(k);
    for (const k of need) {
      const ly = s.bottom - k * sp / 2;
      let ok = false;
      for (let dy = -Math.ceil(sp * 0.12); dy <= Math.ceil(sp * 0.12) && !ok; dy++) {
        const yy = Math.round(ly + dy);
        let run = 0, best = 0;
        for (let xx = Math.round(cx - sp * 1.3); xx <= Math.round(cx + sp * 1.3); xx++) { if (raw(xx, yy)) { run++; best = Math.max(best, run); } else run = 0; }
        if (best >= sp * 1.45) ok = true;
      }
      if (!ok) return false;
    }
    return true;
  }
  function onLine(s, y) { return s.lines.some(l => Math.abs(l - y) < s.space * 0.2); }

  // ───────── Alteraciones dentro del compás ─────────
  function isBarline(gray, w, h, s, x) {
    let c = 0, n = 0;
    for (let y = Math.round(s.top); y <= Math.round(s.bottom); y++) { n++; if (gray[y * w + x] < TH) c++; }
    if (c < n * 0.97) return false;
    // fino: a 0.35 espacios a cada lado no hay tinta en el centro del pentagrama
    const off = Math.max(2, Math.round(s.space * 0.35));
    const mid = Math.round((s.top + s.bottom) / 2);
    const quarter = Math.round(s.top + s.space * 1.5);
    const free = xx => gray[mid * w + xx] >= TH || gray[quarter * w + xx] >= TH;
    return x - off >= 0 && x + off < w && free(x - off) && free(x + off) || (x - off >= 0 && x + off < w && free(x - off - 1) && free(x + off + 1));
  }

  // Busca hacia la izquierda, hasta la barra de compás o la armadura, una alteración
  // aplicada al mismo paso. Devuelve +1, 0 (becuadro), -1 o null.
  function accidentalFor(gray, w, h, s, head) {
    const sp = s.space;
    const ink = makeInk(gray, w, h, s);
    let left = Math.max(s.keyEnd || s.x0, s.x0);
    for (let x = Math.round(head.x - sp * 0.9); x > left; x--) {
      if (isBarline(gray, w, h, s, x)) { left = x + 1; break; }
    }
    const xa = Math.round(left), xb = Math.round(head.x - sp * 0.66);
    if (xb - xa < sp * 0.4) return null;
    const ya = Math.round(head.y - sp * 2.4), yb = Math.round(head.y + sp * 1.9);
    const comps = joinFlatParts(mergeClose(components(ink, xa, Math.max(0, ya), xb, Math.min(h - 1, yb)).filter(c => c.n > 3), Math.max(2, sp * 0.15)), sp);
    let found = null;
    for (const c0 of comps) {
      let c = c0;
      let a = null;
      if (!(c.y0 <= ya + 1 || c.y1 >= yb - 1)) a = classifyAccidental(c, sp);
      // signo pegado a una ligadura u otro trazo: probar solo la parte más cercana a la nota
      if (!a && (c.x1 - c.x0) > sp * 1.3 && c.x1 >= xb - sp * 0.5) {
        const sub = subComp(c, c.x1 - sp * 1.25, c.x1);
        if (sub && !(sub.y0 <= ya + 1 || sub.y1 >= yb - 1)) { a = classifyAccidental(sub, sp); if (a) c = sub; }
      }
      if (!a) continue;
      const step = Math.round((s.bottom - a.y) / (sp / 2));
      if (Math.abs(step - head.step) > 0) continue;
      if (!found || c.x0 > found.x) found = { x: c.x0, type: a.type };
    }
    if (!found) return null;
    return found.type === 'sharp' ? 1 : found.type === 'flat' ? -1 : 0;
  }

  const CLEF_BOTTOM = { treble: [2, 4], treble8: [2, 3], bass: [4, 2], alto: [3, 3] };
  function pitchAt(staff, y, clef, stepOverride) {
    const step = stepOverride != null ? stepOverride : Math.round((staff.bottom - y) / (staff.space / 2));
    const [l0, o0] = CLEF_BOTTOM[clef] || CLEF_BOTTOM.treble;
    const abs = l0 + o0 * 7 + step;
    return { letter: ((abs % 7) + 7) % 7, octave: Math.floor(abs / 7), step };
  }

  const api = { components, makeInk, classifyAccidental, mergeClose, detectStaves, detectKey, findNotehead, accidentalFor, pitchAt };
  if (typeof module !== 'undefined') module.exports = api; else root.StaffDetect = api;
})(typeof window !== 'undefined' ? window : globalThis);
