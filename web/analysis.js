const MA = ((VOCAB) => {
  const SHARP = ['C','C#','D','Eb','E','F','F#','G','G#','A','Bb','B'];
  const FLAT = SHARP;
  const TSR = 22050, N = 4096, HOP = 1024, N2 = 8192, HOP2 = 2048;
  const P = VOCAB.params, QS = VOCAB.qualities, NQ = QS.length, NS = 12 * NQ + 1;
  const QI = Object.fromEntries(QS.map((x, i) => [x.q, i]));

  const midiOf = f => 69 + 12 * Math.log2(f / 440);
  const freqOf = m => 440 * Math.pow(2, (m - 69) / 12);
  const mod12 = v => ((v % 12) + 12) % 12;

  function makeFFT(n) {
    const lv = Math.log2(n), rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) { let r = 0, x = i; for (let j = 0; j < lv; j++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
    const cs = new Float64Array(n / 2), sn = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cs[i] = Math.cos(2 * Math.PI * i / n); sn[i] = -Math.sin(2 * Math.PI * i / n); }
    return (re, im) => {
      for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let i = 0; i < n; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half;
          const tr = re[b] * cs[k] - im[b] * sn[k], ti = re[b] * sn[k] + im[b] * cs[k];
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    };
  }

  function resample(x, sr) {
    if (sr === TSR) return x;
    const r = sr / TSR, n = Math.floor(x.length / r), out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * r), b = Math.max(a + 1, Math.floor((i + 1) * r));
      let s = 0; for (let j = a; j < b && j < x.length; j++) s += x[j];
      out[i] = s / (b - a);
    }
    return out;
  }

  // ---------- pitch-class profiles with harmonic suppression ----------
  const SEMI_LO = 28, SEMI_HI = 96;
  const CFG = { veryExact: true, keyAware: true, barAware: true, repeatVote: false, repeat: { block: 4, thr: 0.9, lam: 1.0 }, halfTempo: 145, harm: [[19, 0.4], [28, 0.25], [31, 0.2]], pow: 0.5, pcLo: 43, tune: true, tuneMin: 0.15, tuneSpread: 0.12, tuneGain: 0.02, octUp: 0.6, conf: 0.09, melLo: 60 };
  const semiCache = {};
  // tun = tuning offset in semitones (e.g. +0.4 when a recording is 40 cents sharp)
  function semiMap(n, sr, tun = 0) {
    const key = n + ':' + sr + ':' + tun.toFixed(2); if (semiCache[key]) return semiCache[key];
    const map = [];
    for (let m = SEMI_LO; m <= SEMI_HI; m++) {
      const lo = Math.ceil(freqOf(m + tun - 0.5) * n / sr), hi = Math.floor(freqOf(m + tun + 0.5) * n / sr);
      map.push(hi >= lo ? [lo, hi] : [Math.round(freqOf(m + tun) * n / sr), Math.round(freqOf(m + tun) * n / sr)]);
    }
    return (semiCache[key] = map);
  }
  function profiles(mag, n, sr, tun = 0) { return pcFromSemis(semis(mag, n, sr, tun)); }
  // estimate how far the recording is from A440: magnitude-weighted circular mean of peak offsets
  function estimateTuning(x, fft2, win2) {
    const nH = Math.floor((x.length - N2) / HOP2) + 1; if (nH < 4) return 0;
    const step = Math.max(1, Math.floor(nH / 120)), re = new Float64Array(N2), im = new Float64Array(N2), mag = new Float64Array(N2 / 2);
    const kLo = Math.ceil(80 * N2 / TSR), kHi = Math.floor(2000 * N2 / TSR), seg = [[0, 0], [0, 0], [0, 0]];
    for (let f = 0; f < nH; f += step) {
      const o = f * HOP2; for (let i = 0; i < N2; i++) { re[i] = (x[o + i] || 0) * win2[i]; im[i] = 0; }
      fft2(re, im); let mx = 0;
      for (let k = 0; k < N2 / 2; k++) { mag[k] = Math.hypot(re[k], im[k]); if (k >= kLo && k <= kHi && mag[k] > mx) mx = mag[k]; }
      for (let k = kLo; k <= kHi; k++) {
        const a = mag[k - 1], b = mag[k], c = mag[k + 1];
        if (b < 0.1 * mx || b < a || b < c) continue;
        const den = a - 2 * b + c, kk = k + (den ? 0.5 * (a - c) / den : 0), m = midiOf(kk * TSR / N2), dev = m - Math.round(m);
        const g = seg[Math.min(2, Math.floor(3 * f / nH))]; g[0] += b * Math.cos(2 * Math.PI * dev); g[1] += b * Math.sin(2 * Math.PI * dev);
      }
    }
    // whole-song offset, and how far the start / middle / end disagree with it
    const cx = seg.reduce((a, g) => a + g[0], 0), cy = seg.reduce((a, g) => a + g[1], 0), t = Math.atan2(cy, cx) / (2 * Math.PI);
    const spread = Math.max(...seg.filter(g => g[0] || g[1]).map(g => { const d = Math.atan2(g[1], g[0]) / (2 * Math.PI) - t; return Math.abs(((d + 0.5) % 1 + 1) % 1 - 0.5); }), 0);
    return { t, spread };
  }
  function semis(mag, n, sr, tun = 0) {
    const map = semiMap(n, sr, tun), S = new Float64Array(SEMI_HI + 1);
    map.forEach(([a, b], i) => { let v = 0; for (let k = a; k <= b; k++) v = Math.max(v, mag[k] || 0); S[SEMI_LO + i] = v; });
    const S0 = Float64Array.from(S);
    for (let m = SEMI_LO; m <= SEMI_HI; m++) {
      const a = S0[m]; if (a <= 0) continue;
      for (const [d, f] of CFG.harm) if (m + d <= SEMI_HI) S[m + d] = Math.max(0, S[m + d] - a * f);
    }
    return S;
  }
  function pcFromSemis(S) {
    const pc = new Float64Array(12), bs = new Float64Array(12);
    for (let m = CFG.pcLo; m <= 84; m++) pc[m % 12] += Math.pow(S[m], CFG.pow);
    for (let m = SEMI_LO; m <= 54; m++) bs[m % 12] += Math.pow(S[m], CFG.pow) * (m < 48 ? 1 : 0.4);
    return { pc, bs };
  }

  // ---------- chord vocabulary scoring (mirrors backend/app/chords.py) ----------
  const norm = a => { const mx = Math.max(...a); return mx > 0 ? Array.from(a, v => v / mx) : Array.from(a, () => 0); };
  function scoreAll(pc, bs) {
    const p = norm(pc), b = norm(bs), out = new Float64Array(12 * NQ);
    for (let r = 0; r < 12; r++) for (let qi = 0; qi < NQ; qi++) {
      const ivs = QS[qi].ivs, inT = new Array(12).fill(false); let s = 0;
      for (const [iv, w] of ivs) { const k = (r + iv) % 12; s += w * (p[k] - P.tau); inT[k] = true; }
      for (let j = 0; j < 12; j++) if (!inT[j]) s -= P.beta * p[j];
      s -= P.gamma * (ivs.length - 3);
      s += P.bassBonus * b[r];
      // the bass should be the root, third or fifth (same rule as the server): penalise other bass notes
      const bo = P.bassOutBrowser ?? P.bassOut; // the browser's bass comes from a plain spectrum: weaker weight (measured)
      if (bo) { const core = new Set(ivs.slice(0, 3).map(([iv]) => (r + iv) % 12)); for (let j = 0; j < 12; j++) if (!core.has(j)) s -= bo * b[j] * b[j]; }
      out[r * NQ + qi] = s;
    }
    return out;
  }
  // chg[i]: extra cost of a chord change landing on beat i (harmonic rhythm: changes prefer the downbeat)
  function viterbi(emis, chg) {
    let dp = Float64Array.from(emis[0]); const bk = [];
    for (let i = 1; i < emis.length; i++) {
      const ex = chg ? chg[i] : 0;
      let mx = -Infinity, am = 0; const rmx = new Float64Array(13).fill(-Infinity), ram = new Int32Array(13);
      for (let s = 0; s < NS; s++) {
        if (dp[s] > mx) { mx = dp[s]; am = s; }
        const r = s === NS - 1 ? 12 : Math.floor(s / NQ);
        if (dp[s] > rmx[r]) { rmx[r] = dp[s]; ram[r] = s; }
      }
      const nd = new Float64Array(NS), nb = new Int32Array(NS);
      for (let s = 0; s < NS; s++) {
        const r = s === NS - 1 ? 12 : Math.floor(s / NQ);
        let v = dp[s], from = s;
        if (rmx[r] - P.penSame - ex > v) { v = rmx[r] - P.penSame - ex; from = ram[r]; }
        if (mx - P.penRoot - ex > v) { v = mx - P.penRoot - ex; from = am; }
        nd[s] = v + emis[i][s]; nb[s] = from;
      }
      dp = nd; bk.push(nb);
    }
    const st = new Array(emis.length); let best = 0; for (let s = 1; s < NS; s++) if (dp[s] > dp[best]) best = s;
    st[emis.length - 1] = best;
    for (let i = emis.length - 2; i >= 0; i--) st[i] = bk[i][st[i + 1]];
    return st;
  }
  // beatProfiles: [{pc, bs, low}] -> [{root, q, bass}]
  // cost of a chord change on each beat: free on beat 1, small at mid-bar, larger elsewhere (same as the server)
  function changeCosts(T, bpb, phase) {
    const w = P.chgWeak ?? 2, half = (P.chgHalf ?? 0.5) * w, out = new Float64Array(T);
    for (let i = 0; i < T; i++) { const pos = (((i - phase) % bpb) + bpb) % bpb; out[i] = pos === 0 ? 0 : (bpb % 2 === 0 && pos === bpb / 2) ? half : w; }
    return out;
  }
  // repeated passages vote on their notes (same rule as the server's repeat_vote)
  function repeatVote(pcs, bpb, phase) {
    const T = pcs.length, L = CFG.repeat.block, thr = CFG.repeat.thr, lam = CFG.repeat.lam;
    if (T < bpb * 8) return pcs;
    const nrm = pcs.map(p => { const m = Math.max(...p) || 1e-9; return Array.from(p, v => v / m); });
    const starts = []; for (let b = ((phase % bpb) + bpb) % bpb; b <= T - bpb; b += bpb) starts.push(b);
    const nb = starts.length, h = Math.max(1, Math.floor(bpb / 2));
    const feat = starts.map(b => { const f = new Float64Array(24); for (let j = 0; j < bpb; j++) for (let c = 0; c < 12; c++) f[(j < h ? 0 : 12) + c] += nrm[b + j][c]; const n = Math.hypot(...f) || 1e-9; return f.map(v => v / n); });
    const ok = (k, l) => { let d = 0; for (let c = 0; c < 24; c++) d += feat[k][c] * feat[l][c]; return d >= thr; };
    const okM = feat.map((_, k) => feat.map((_, l) => ok(k, l)));
    const partner = feat.map(() => new Uint8Array(nb));
    for (let s = 0; s + L <= nb; s++) for (let t = 0; t + L <= nb; t++) {
      if (s === t) continue; let all = true; for (let m = 0; m < L && all; m++) all = okM[s + m][t + m];
      if (all) for (let m = 0; m < L; m++) partner[s + m][t + m] = 1;
    }
    const out = nrm.map(p => p.slice());
    for (let k = 0; k < nb; k++) {
      const ps = []; for (let l = 0; l < nb; l++) if (partner[k][l] && Math.abs(l - k) >= L) ps.push(l);
      if (!ps.length) continue;
      for (let j = 0; j < bpb; j++) { const i = starts[k] + j; for (let c = 0; c < 12; c++) { let m = 0; for (const p of ps) m += nrm[starts[p] + j][c]; out[i][c] = (nrm[i][c] + lam * m / ps.length) / (1 + lam); } }
    }
    return out;
  }
  // major scale (tonic 0-11; minor keys share the relative major's scale) in force at every beat, from a first
  // pass of chords: bar-wise fit, smoothed with a high switch cost so only real modulations move it (as the server)
  const MAJ = [0, 2, 4, 5, 7, 9, 11], scaleMask = t => MAJ.reduce((m, d) => m | (1 << ((t + d) % 12)), 0);
  function localScales(chords, bpb, phase) {
    const T = chords.length; if (!T) return [];
    const starts = []; for (let b = ((phase % bpb) + bpb) % bpb; b < T; b += bpb) starts.push(b); if (!starts.length || starts[0] > 0) starts.unshift(0);
    const fit = starts.map((b, k) => {
      const e = k + 1 < starts.length ? starts[k + 1] : T, h = new Float64Array(12);
      for (let i = b; i < e; i++) { const c = chords[i]; if (c.root >= 0) for (const [iv, w] of QS[QI[c.q]].ivs) h[(c.root + iv) % 12] += w; }
      const tot = h.reduce((a, v) => a + v, 0);
      return Array.from({ length: 12 }, (_, t) => { const m = scaleMask(t); let ins = 0; for (let p = 0; p < 12; p++) if (m >> p & 1) ins += h[p]; return ins - 1.5 * (tot - ins); });
    });
    const sw = P.keySwitch ?? 12; let dp = fit[0].slice(); const back = [];
    for (let k = 1; k < starts.length; k++) {
      let best = 0; for (let t = 1; t < 12; t++) if (dp[t] > dp[best]) best = t;
      const bk = new Int8Array(12), nd = new Array(12);
      for (let t = 0; t < 12; t++) { if (dp[t] >= dp[best] - sw) { nd[t] = dp[t] + fit[k][t]; bk[t] = t; } else { nd[t] = dp[best] - sw + fit[k][t]; bk[t] = best; } }
      dp = nd; back.push(bk);
    }
    let t = 0; for (let u = 1; u < 12; u++) if (dp[u] > dp[t]) t = u;
    const path = new Array(starts.length); path[starts.length - 1] = t;
    for (let k = starts.length - 1; k > 0; k--) path[k - 1] = back[k - 1][path[k]];
    const out = new Int8Array(T); starts.forEach((b, k) => out.fill(path[k], b, k + 1 < starts.length ? starts[k + 1] : T));
    return out;
  }
  // bonus for chords of the key in force: all tones in the scale = full; secondary dominants, iv and bVII = half
  function keyBonus(scales) {
    const w = P.keyBonus || 0, cache = {};
    return Array.from(scales, t => {
      if (!w) return null;
      if (!cache[t]) {
        const m = scaleMask(t), v = new Float64Array(12 * NQ);
        for (let r = 0; r < 12; r++) for (let qi = 0; qi < NQ; qi++) {
          const ivs = QS[qi].ivs, full = ivs.every(([iv]) => m >> ((r + iv) % 12) & 1);
          const majTri = QS[qi].base === '' && ivs.some(([iv]) => iv === 4), sec = majTri && (m >> ((r + 7) % 12) & 1);
          const bor = r === (t + 5) % 12 || r === (t + 10) % 12;
          v[r * NQ + qi] = full ? w : (sec || bor) ? w / 2 : 0;
        }
        cache[t] = v;
      }
      return cache[t];
    });
  }
  function decodeChords(beatProfiles, chg, bonus) {
    const emis = beatProfiles.map(({ pc, bs, low }, i) => {
      const e = new Float64Array(NS), sc = scoreAll(pc, bs), kb = bonus && bonus[i];
      for (let s = 0; s < NS - 1; s++) e[s] = P.K * (sc[s] + (kb ? kb[s] : 0));
      e[NS - 1] = P.K * (low ? 3 : -0.6);
      return e;
    });
    if (!emis.length) return [];
    const st = viterbi(emis, chg);
    const out = st.map(s => s === NS - 1 ? { root: -1, q: '', bass: -1 } : { root: Math.floor(s / NQ), q: QS[s % NQ].q, bass: -1 });
    // slash chords: per run, bass note that is a chord tone other than the root and clearly strongest
    for (let i = 0; i < out.length;) {
      let j = i; while (j < out.length && out[j].root === out[i].root && out[j].q === out[i].q) j++;
      if (out[i].root >= 0) {
        const bs = new Float64Array(12); for (let k = i; k < j; k++) for (let c = 0; c < 12; c++) bs[c] += beatProfiles[k].bs[c];
        let bp = 0; for (let c = 1; c < 12; c++) if (bs[c] > bs[bp]) bp = c;
        const tones = QS[QI[out[i].q]].ivs.map(([iv]) => (out[i].root + iv) % 12);
        if (bp !== out[i].root && tones.includes(bp) && bs[bp] > 1.6 * bs[out[i].root]) for (let k = i; k < j; k++) out[k].bass = bp;
      }
      i = j;
    }
    return out;
  }

  const KMAJ = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
  const KMIN = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
  function corr(a, b) {
    const ma = a.reduce((s, v) => s + v, 0) / 12, mb = b.reduce((s, v) => s + v, 0) / 12;
    let n = 0, da = 0, db = 0;
    for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return n / Math.sqrt(da * db || 1);
  }
  function detectKey(ch) {
    let best = { s: -2 };
    for (let r = 0; r < 12; r++) for (const [q, p] of [['', KMAJ], ['m', KMIN]]) {
      const rot = p.map((_, i) => p[mod12(i - r)]), s = corr(ch, rot);
      if (s > best.s) best = { s, root: r, q };
    }
    return { root: best.root, q: best.q };
  }
  // major key or its relative minor (same notes): time on each tonic, V-I cadences, closing chord
  function relativeChoice(key, ch) {
    const M = key.q === 'm' ? mod12(key.root + 3) : key.root, m = mod12(M + 9);
    // a minor chord over the major tonic in the bass (Em7/G) is the major tonic
    const fam = ch.map(c => c.root < 0 ? [-1, 'x'] : c.bass === M && c.root === m ? [M, ''] : [c.root, baseOf(c.q) === 'm' ? 'm' : '']), eq = (a, r, f) => a[0] === r && a[1] === f;
    const sc = { '': 0, m: 0 }, firm = { '': false, m: false };
    for (const x of fam) { if (eq(x, M, '')) sc['']++; else if (eq(x, m, 'm')) sc.m++; }
    const seq = fam.filter((x, i) => x[0] >= 0 && (i === 0 || x[0] !== fam[i - 1][0] || x[1] !== fam[i - 1][1]));
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1], b = seq[i];
      if (a[0] === mod12(M + 7) && eq(b, M, '')) { sc[''] += 4; firm[''] = true; }
      if (eq(a, mod12(m + 7), '') && eq(b, m, 'm')) { sc.m += 4; firm.m = true; }
    }
    if (seq.length) { const n = Math.max(4, 0.05 * ch.length), z = seq[seq.length - 1]; if (eq(z, M, '')) { sc[''] += n; firm[''] = true; } else if (eq(z, m, 'm')) { sc.m += n; firm.m = true; } }
    // the note profile already chose one; switch to the other only on clear evidence (cadence or ending, and much more time)
    const cur = key.q === 'm' ? 'm' : '', oth = cur ? '' : 'm', pick = firm[oth] && sc[oth] > 1.5 * sc[cur] + 4 ? oth : cur;
    return pick === 'm' ? { root: m, q: 'm' } : { root: M, q: '' };
  }
  const useFlats = k => k.q ? [2,7,0,5,10,3].includes(k.root) : [5,10,3,8,1,6].includes(k.root);

  // ---------- naming: fixed spelling, Eb and Bb instead of D# and A# ----------
  const NAMES = ['C','C#','D','Eb','E','F','F#','G','G#','A','Bb','B'];
  const baseOf = q => (QS[QI[q]] || QS[0]).base;
  function name(c, _flats, mode = 'advance', tr = 0) {
    if (!c || c.root < 0) return 'N';
    const q = mode === 'basic' || mode === 'very' ? baseOf(c.q) : c.q;
    let s = NAMES[mod12(c.root + tr)] + q;
    if (mode !== 'basic' && mode !== 'very' && c.bass >= 0 && c.bass !== c.root) s += '/' + NAMES[mod12(c.bass + tr)];
    return s;
  }
  function tones(c, mode = 'advance') {
    if (!c || c.root < 0) return [];
    const q = mode === 'basic' || mode === 'very' ? baseOf(c.q) : c.q;
    return (QS[QI[q]] || QS[0]).ivs.map(([iv]) => mod12(c.root + iv));
  }

  // ---------- chord levels ----------
  // very  : one major/minor chord per bar, pulled toward the key and toward repeating loops
  // plus  : very + colour chords (2, sus2, sus4, 7, dim, slash), up to one change per half bar
  // advance: full chords, majority per half bar
  const PLUS = { '': '', m: 'm', '2': '2', sus2: 'sus2', sus4: 'sus4', '7': '7', dim: 'dim', maj7: '', maj9: '', '6': '', aug: '',
                 '9': '7', '13': '7', '7sus4': 'sus4', '11': 'sus4', m7: 'm', m6: 'm', m9: 'm', m11: 'm', dim7: 'dim', m7b5: 'dim' };
  const NC = { root: -1, q: '', bass: -1 };
  const lab = c => c.root < 0 ? 'N' : c.root + '|' + c.q + '|' + (c.bass ?? -1);
  const unlab = l => { if (l === 'N') return { ...NC }; const [r, q, b] = l.split('|'); return { root: +r, q, bass: +b }; };
  function relMajor(key) { return key.q === 'm' ? mod12(key.root + 3) : key.root; }
  function diatonic(key) {
    const K = relMajor(key), set = new Map([[0, ''], [2, 'm'], [4, 'm'], [5, ''], [7, ''], [9, 'm']].map(([d, q]) => [mod12(K + d) + '|' + q, 1]));
    set.set(mod12(K + 10) + '|', 0.6);
    if (key.q === 'm') set.set(mod12(key.root + 7) + '|', 0.8);
    return set;
  }
  const ROMAN = ['I','bII','II','bIII','III','IV','#IV','V','bVI','VI','bVII','VII'];
  function roman(c, key) {
    if (!c || c.root < 0) return '';
    const b = baseOf(c.q);
    return ROMAN[mod12(c.root - relMajor(key))] + (c.q === 'dim' || c.q === 'm7b5' || c.q === 'dim7' ? '°' : b === 'm' ? 'm' : '');
  }
  function groupSize(bpb) { return bpb === 4 ? 2 : bpb === 6 ? 3 : bpb; }

  function veryLevel(chords, bars, key, locked = []) {
    const dia = diatonic(key);
    let lbl = bars.map(bar => {
      const beats = bar.map(i => chords[i]).filter(c => c.root >= 0);
      if (!beats.length) return 'N';
      let best = null, bs = -Infinity;
      for (let r = 0; r < 12; r++) for (const q of ['', 'm']) {
        const T = tones({ root: r, q }); let s = 0;
        for (const c of beats) {
          const tb = tones(c), ov = T.filter(t => tb.includes(t)).length / 3;
          s += ov + (c.root === r ? 0.5 : 0) + (c.root === r && baseOf(c.q) === q ? 0.3 : 0);
        }
        s += 0.25 * beats.length * (dia.get(r + '|' + q) || 0);
        if (s > bs) { bs = s; best = r + '|' + q + '|-1'; }
      }
      return best;
    });
    // fill gaps inside the song so every bar has a chord
    const first = lbl.findIndex(l => l !== 'N'), last = lbl.length - 1 - [...lbl].reverse().findIndex(l => l !== 'N');
    for (let i = first + 1; i < last; i++) if (lbl[i] === 'N') lbl[i] = lbl[i - 1];
    // loop regularisation: compare each bar with the same position one or two loops away
    const simL = L => { let n = 0, m = 0; for (let i = 0; i + L < lbl.length; i++) if (lbl[i] !== 'N') { m++; if (lbl[i] === lbl[i + L]) n++; } return m ? n / m : 0; };
    let L = 4; if (simL(8) >= simL(4) - 0.05) L = 8; if (simL(2) > simL(4) + 0.1) L = 2;
    const out = lbl.slice();
    for (let i = 0; i < lbl.length; i++) {
      if (lbl[i] === 'N' || locked[i]) continue;
      const w = {}; w[lbl[i]] = 1.5;
      for (const k of [-2, -1, 1, 2]) { const j = i + k * L; if (j >= 0 && j < lbl.length && lbl[j] !== 'N') w[lbl[j]] = (w[lbl[j]] || 0) + (Math.abs(k) === 1 ? 1 : 0.7); }
      let bl = lbl[i]; for (const k in w) if (w[k] > w[bl]) bl = k;
      out[i] = bl;
    }
    return { loop: L, bars: bars.map((bar, bi) => [{ start: bar[0], len: bar.length, chord: unlab(out[bi]) }]) };
  }

  function majority(items, prefer) {
    const cnt = {}; let best = null;
    items.forEach((l, k) => { cnt[l] = (cnt[l] || 0) + 1 - k * 1e-3; });
    for (const l in cnt) if (best === null || cnt[l] > cnt[best] || (Math.abs(cnt[l] - cnt[best]) < 0.01 && prefer && prefer(l))) best = l;
    return best;
  }
  function splitBar(bar, bpb) { const g = groupSize(bpb), out = []; for (let k = 0; k < bar.length; k += g) out.push(bar.slice(k, k + g)); return out; }
  function mergeSegs(segs) {
    const out = [];
    for (const s of segs) { const p = out[out.length - 1]; if (p && lab(p.chord) === lab(s.chord)) p.len += s.len; else out.push({ ...s }); }
    return out;
  }
  function plusLevel(chords, bars, very, bpb) {
    return bars.map((bar, bi) => {
      const v = very.bars[bi][0].chord;
      const segs = splitBar(bar, bpb).map(half => {
        const cs = half.map(i => chords[i]).filter(c => c.root >= 0);
        if (!cs.length || v.root < 0) return { start: half[0], len: half.length, chord: v };
        const roots = new Set(cs.map(c => c.root));
        let root = v.root;
        if (roots.size === 1 && !roots.has(v.root) && cs.length >= 2) root = cs[0].root;
        const same = cs.filter(c => c.root === root);
        if (!same.length) return { start: half[0], len: half.length, chord: v };
        const l = majority(same.map(c => root + '|' + PLUS[c.q] + '|' + (c.bass ?? -1)));
        const ch = unlab(l);
        if (root === v.root && baseOf(ch.q) !== baseOf(v.q) && ch.q !== 'sus2' && ch.q !== 'sus4' && ch.q !== '2') ch.q = v.q;
        return { start: half[0], len: half.length, chord: ch };
      });
      return mergeSegs(segs);
    });
  }
  function advLevel(chords, bars, plus, bpb) {
    return bars.map((bar, bi) => {
      const pl = plus[bi];
      const segs = splitBar(bar, bpb).map(half => {
        const cs = half.map(i => chords[i]);
        const pr = (pl.find(s => s.start <= half[0] && half[0] < s.start + s.len) || pl[0]).chord.root;
        const l = majority(cs.map(lab).filter(x => x !== 'N'), x => unlab(x).root === pr);
        return { start: half[0], len: half.length, chord: l ? unlab(l) : { ...NC } };
      });
      return mergeSegs(segs);
    });
  }
  // Very simple, built from the chords as heard: root + major/minor only, one chord per bar unless both halves of
  // the bar clearly hold different chords. No pattern forcing (the old loop rule could pull a whole verse wrong).
  function veryExact(chords, bars, bpb) {
    const fam = c => c.root < 0 ? 'N' : c.root + '|' + baseOf(c.q) + '|-1';
    const famMaj = idx => { const cnt = {}; for (const i of idx) { const f = fam(chords[i]); if (f !== 'N') cnt[f] = (cnt[f] || 0) + 1; } let b = null; for (const f in cnt) if (!b || cnt[f] > cnt[b]) b = f; return b ? [b, cnt[b]] : ['N', 0]; };
    let prev = 'N';
    return bars.map(bar => {
      const halves = splitBar(bar, bpb), whole = famMaj(bar)[0];
      if (halves.length === 2) {
        const [a, na] = famMaj(halves[0]), [b, nb] = famMaj(halves[1]);
        if (a !== b && a !== 'N' && b !== 'N' && na === halves[0].length && nb === halves[1].length) {
          prev = b; return [{ start: halves[0][0], len: halves[0].length, chord: unlab(a) }, { start: halves[1][0], len: halves[1].length, chord: unlab(b) }];
        }
      }
      const l = whole === 'N' && prev !== 'N' && bar.some(i => chords[i].root >= 0) ? prev : whole; prev = l;
      return [{ start: bar[0], len: bar.length, chord: unlab(l) }];
    });
  }
  // Higher levels only add detail to the very-simple chord under them: same root, same major/minor
  function refineLevel(chords, base, map) {
    return base.map(segs => mergeSegs(segs.map(sg => {
      const v = sg.chord; if (v.root < 0) return { ...sg };
      const idx = []; for (let i = sg.start; i < sg.start + sg.len; i++) idx.push(i);
      const same = idx.map(i => chords[i]).filter(c => c.root === v.root && baseOf(c.q) === baseOf(v.q));
      if (!same.length) return { ...sg };
      const l = majority(same.map(c => v.root + '|' + map(c.q) + '|' + (c.bass ?? -1)));
      const ch = unlab(l); if (baseOf(ch.q) !== baseOf(v.q)) ch.q = v.q;
      return { start: sg.start, len: sg.len, chord: ch };
    })));
  }
  function levels(chords, bars, key, bpb, locked) {
    if (CFG.veryExact) {
      const very = veryExact(chords, bars, bpb), plus = refineLevel(chords, very, q => PLUS[q] ?? q);
      return { loop: 0, very, plus, advance: refineLevel(chords, plus, q => q) };
    }
    const very = veryLevel(chords, bars, key, locked), plus = plusLevel(chords, bars, very, bpb);
    return { loop: very.loop, very: very.bars, plus, advance: advLevel(chords, bars, plus, bpb) };
  }

  // ---------- time signature ----------
  function detectMeter(chords, accent, bpm) {
    const base = chords.map(c => c.root < 0 ? 'N' : c.root + baseOf(c.q));
    const ch = base.map((l, i) => i > 0 && l !== base[i - 1] && l !== 'N' ? 1 : 0);
    const acc = accent && accent.length === chords.length ? accent : null;
    let am = 0, sd = 1;
    if (acc) { am = acc.reduce((a, b) => a + b, 0) / acc.length; sd = Math.sqrt(acc.reduce((a, b) => a + (b - am) ** 2, 0) / acc.length) || 1; }
    const cands = [{ num: 4, den: 4, bpb: 4, prior: 0.08 }, { num: 3, den: 4, bpb: 3, prior: 0 }];
    if (bpm >= 140) cands.push({ num: 6, den: 8, bpb: 6, prior: 0 });
    let best = null;
    for (const c of cands) for (let ph = 0; ph < c.bpb; ph++) {
      let d = 0, nd = 0, o = 0, no = 0, ad = 0, ao = 0;
      for (let i = 1; i < ch.length; i++) {
        const down = (i - ph) % c.bpb === 0;
        if (down) { d += ch[i]; nd++; if (acc) ad += (acc[i] - am) / sd; } else { o += ch[i]; no++; if (acc) ao += (acc[i] - am) / sd; }
      }
      const sc = (nd ? d / nd : 0) - (no ? o / no : 0) + (acc ? 0.3 * ((nd ? ad / nd : 0) - (no ? ao / no : 0)) : 0) + c.prior;
      if (!best || sc > best.score) best = { num: c.num, den: c.den, bpb: c.bpb, phase: ph, score: sc };
    }
    return best;
  }

  function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; }
  const tick = () => new Promise(r => setTimeout(r, 0));

  // phase of bar lines: chord changes tend to land on beat 1
  function barPhase(chords, on) {
    let phase = 0, bestC = -1;
    for (let ph = 0; ph < 4; ph++) {
      let c = 0, o = 0;
      for (let i = 1; i < chords.length; i++) if ((i - ph) % 4 === 0) {
        if (chords[i].root !== chords[i - 1].root) c += 1; else if (chords[i].q !== chords[i - 1].q) c += 0.4;
        o += (on && on[i]) || 0;
      }
      const sc = c + o * 0.01;
      if (sc > bestC) { bestC = sc; phase = ph; }
    }
    return phase;
  }

  // Fix the two common beat-tracker slips using where the harmony actually changes: counting eighth notes
  // as beats (ballads come out at ~180 BPM) and sitting on the 'and' between beats. Same rules as the server.
  function refineGrid(bf, p, ft, HP, HT, nF, fr, tempo = 'auto') {
    if (bf.length < 8 || !HP.length) return bf;
    const cs = [new Float64Array(12)];
    for (const h of HP) { const v = pcFromSemis(h).pc, c = Float64Array.from(cs[cs.length - 1]); for (let k = 0; k < 12; k++) c[k] += v[k]; cs.push(c); }
    const idx = x => { let lo = 0, hi = HT.length; while (lo < hi) { const m = (lo + hi) >> 1; if (HT[m] < x) lo = m + 1; else hi = m; } return lo; };
    let pp = p;
    const nov = (x, w) => {
      const a = idx(x - w), m = idx(x), b = idx(x + w); let d = 0, nl = 0, nr = 0;
      for (let k = 0; k < 12; k++) { const l = cs[m][k] - cs[a][k], r = cs[b][k] - cs[m][k]; d += l * r; nl += l * l; nr += r * r; }
      return nl > 1e-12 && nr > 1e-12 ? 1 - d / Math.sqrt(nl * nr) : 0;
    };
    const score = g => { if (!g.length) return 0; const w = Math.min(0.5, Math.max(0.25, 0.7 * pp / fr)), v = g.map(f => nov(ft(f), w)).sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(0.85 * v.length))]; };
    if (60 * fr / pp >= CFG.halfTempo) { const ev = bf.filter((_, i) => i % 2 === 0), od = bf.filter((_, i) => i % 2 === 1); bf = score(ev) >= score(od) ? ev : od; pp *= 2; }
    if (tempo === 'half') { const ev = bf.filter((_, i) => i % 2 === 0), od = bf.filter((_, i) => i % 2 === 1); bf = score(ev) >= score(od) ? ev : od; pp *= 2; }
    else if (tempo === 'double') { const out = []; bf.forEach((f, i) => { out.push(f); const nx = i + 1 < bf.length ? bf[i + 1] : f + pp; if (Math.round((f + nx) / 2) < nF) out.push(Math.round((f + nx) / 2)); }); return out; }
    const sh = bf.map(f => Math.round(f + pp / 2)).filter(f => f < nF);
    if (score(sh) > 1.25 * score(bf)) bf = (bf[0] - pp / 2 >= 0 ? [Math.round(bf[0] - pp / 2)] : []).concat(sh);
    return bf;
  }
  async function analyze(input, sr, onProgress = () => {}, opts = {}) {
    const x = resample(input, sr), fft = makeFFT(N), fft2 = makeFFT(N2);
    const win = new Float64Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    const win2 = new Float64Array(N2); for (let i = 0; i < N2; i++) win2[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N2);
    const nF = Math.max(1, Math.floor((x.length - N) / HOP) + 1), fr = TSR / HOP;
    const tuneMode = opts.tune === 'off' || !CFG.tune ? 'off' : 'auto';
    const est = tuneMode === 'off' ? { t: 0, spread: 0 } : estimateTuning(x, fft2, win2);
    const cand = tuneMode !== 'off' && Math.abs(est.t) >= CFG.tuneMin && est.spread <= CFG.tuneSpread;

    // harmony pass (longer window for bass resolution). When the recording looks detuned, listen both ways
    // and keep the retuned version only if it fits chord shapes clearly better.
    const nH = Math.max(1, Math.floor((x.length - N2) / HOP2) + 1), HP0 = [], HP1 = [], HT = [];
    const re2 = new Float64Array(N2), im2 = new Float64Array(N2), mag2 = new Float64Array(N2 / 2);
    for (let f = 0; f < nH; f++) {
      const o = f * HOP2;
      for (let i = 0; i < N2; i++) { re2[i] = (x[o + i] || 0) * win2[i]; im2[i] = 0; }
      fft2(re2, im2);
      for (let k = 0; k < N2 / 2; k++) mag2[k] = Math.hypot(re2[k], im2[k]) / (N2 / 4);
      HP0.push(semis(mag2, N2, TSR, 0)); if (cand) HP1.push(semis(mag2, N2, TSR, est.t)); HT.push((o + N2 / 2) / TSR);
      if (f % 60 === 0) { onProgress(0.05 + 0.25 * f / nH); await tick(); }
    }
    const fitOf = HP => { let s = 0, c = 0; for (const h of HP) { const p = pcFromSemis(h); if (Math.max(...p.pc) <= 0) continue; s += Math.max(...scoreAll(p.pc, p.bs)); c++; } return c ? s / c : 0; };
    let tun = 0, tuneNote = tuneMode === 'off' ? 'off' : Math.abs(est.t) < CFG.tuneMin ? 'small' : cand ? 'worse' : 'unstable';
    if (cand) { const f0 = fitOf(HP0), f1 = fitOf(HP1); if (f1 > f0 + CFG.tuneGain * Math.abs(f0)) { tun = est.t; tuneNote = 'applied'; } }
    const HP = tun ? HP1 : HP0;
    const flux = new Float64Array(nF), rms = new Float64Array(nF), mel = new Int16Array(nF).fill(-1), melS = new Float64Array(nF), conf = new Float64Array(nF);
    const re = new Float64Array(N), im = new Float64Array(N), mag = new Float64Array(N / 2);
    let prevL = new Float64Array(N / 2);
    const melC = []; for (let m = 48; m <= 84; m++) melC.push(m);
    const bandA = Math.round(100 * N / TSR), bandB = Math.round(3000 * N / TSR);
    for (let f = 0; f < nF; f++) {
      const o = f * HOP; let e = 0;
      for (let i = 0; i < N; i++) { const v = x[o + i] || 0; e += v * v; re[i] = v * win[i]; im[i] = 0; }
      rms[f] = Math.sqrt(e / N);
      fft(re, im);
      const curL = new Float64Array(N / 2); let fl = 0;
      for (let k = 0; k < N / 2; k++) {
        mag[k] = Math.hypot(re[k], im[k]) / (N / 4);
        curL[k] = Math.log1p(100 * mag[k]);
        const d = curL[k] - prevL[k]; if (d > 0 && k > 2) fl += d;
      }
      flux[f] = fl; prevL = curL;
      let tot = 0; for (let k = bandA; k < bandB; k++) tot += mag[k];
      let bm = -1, bsal = 0; const salA = {};
      for (const m of melC) {
        const f0 = freqOf(m + tun); let s = 0;
        for (let h = 1; h <= 5; h++) {
          const kb = Math.round(h * f0 * N / TSR); if (kb + 1 >= N / 2) break;
          s += Math.pow(0.8, h - 1) * Math.max(mag[kb - 1], mag[kb], mag[kb + 1]);
        }
        salA[m] = s;
        if (s > bsal) { bsal = s; bm = m; }
      }
      while (salA[bm + 12] > CFG.octUp * bsal) bm += 12;
      mel[f] = bm; melS[f] = salA[bm]; conf[f] = tot > 0 ? bsal / tot : 0;
      if (f % 150 === 0) { onProgress(0.3 + 0.55 * f / nF); await tick(); }
    }

    // onset envelope
    const W = Math.round(fr), on = new Float64Array(nF);
    for (let i = 0; i < nF; i++) {
      let s = 0, c = 0; for (let j = Math.max(0, i - W); j < Math.min(nF, i + W); j++) { s += flux[j]; c++; }
      on[i] = Math.max(0, flux[i] - s / c);
    }
    const sd = Math.sqrt(on.reduce((s, v) => s + v * v, 0) / nF) || 1;
    for (let i = 0; i < nF; i++) on[i] /= sd;

    // tempo via autocorrelation
    const lmin = Math.floor(fr * 60 / 180), lmax = Math.ceil(fr * 60 / 60), ac = [];
    for (let L = lmin; L <= lmax; L++) {
      let s = 0; for (let i = L; i < nF; i++) s += on[i] * on[i - L];
      const bpm = 60 * fr / L, w = Math.exp(-0.5 * (Math.log2(bpm / 115) / 0.9) ** 2);
      ac.push(s * w);
    }
    let bi = 0; for (let i = 1; i < ac.length; i++) if (ac[i] > ac[bi]) bi = i;
    let p = lmin + bi;
    if (bi > 0 && bi < ac.length - 1) { const a = ac[bi - 1], b = ac[bi], c = ac[bi + 1], d = a - 2 * b + c; if (d) p += 0.5 * (a - c) / d; }

    // dynamic-programming beat tracker (Ellis 2007)
    const score = new Float64Array(nF), back = new Int32Array(nF).fill(-1), alpha = 400;
    for (let t = 0; t < nF; t++) {
      let best = -Infinity, bj = -1;
      for (let j = t - Math.round(2 * p); j <= t - Math.round(p / 2); j++) {
        if (j < 0) continue;
        const v = score[j] - alpha * Math.log((t - j) / p) ** 2;
        if (v > best) { best = v; bj = j; }
      }
      score[t] = on[t] + (bj >= 0 && best > 0 ? best : 0); back[t] = bj >= 0 && best > 0 ? bj : -1;
    }
    let end = nF - 1; for (let t = Math.max(0, nF - Math.round(p)); t < nF; t++) if (score[t] > score[end]) end = t;
    let bf = []; for (let t = end; t >= 0; t = back[t]) bf.unshift(t);
    if (bf.length < 2) { bf = []; for (let t = 0; t < nF; t += p) bf.push(Math.round(t)); }
    while (bf[0] - p > 0) bf.unshift(Math.round(bf[0] - p));
    while (bf[bf.length - 1] + p < nF) bf.push(Math.round(bf[bf.length - 1] + p));
    const ft = f => (f * HOP + N / 2) / TSR;
    bf = refineGrid(bf, p, ft, HP, HT, nF, fr, opts.tempo);
    const beats = bf.map(ft);
    const intervals = []; for (let i = 1; i < beats.length; i++) intervals.push(beats[i] - beats[i - 1]);
    // median of 8-beat spans: single intervals are quantised to analysis frames (90 BPM read as 92)
    const spans = []; for (let i = 8; i < beats.length; i++) spans.push((beats[i] - beats[i - 8]) / 8);
    const bpm = Math.round(60 / (spans.length >= 3 ? median(spans) : median(intervals)));
    onProgress(0.9); await tick();

    // melody notes
    const medR = median(rms);
    const voiced = new Int16Array(nF).fill(-1);
    for (let f = 0; f < nF; f++) if (conf[f] > CFG.conf && rms[f] > 0.15 * medR && mel[f] >= CFG.melLo) voiced[f] = mel[f];
    const sm = new Int16Array(nF).fill(-1);
    for (let f = 0; f < nF; f++) {
      const w = []; for (let j = f - 2; j <= f + 2; j++) if (j >= 0 && j < nF) w.push(voiced[j]);
      const cnt = {}; let bv = -1, bc = 0; for (const v of w) { cnt[v] = (cnt[v] || 0) + 1; if (cnt[v] > bc) { bc = cnt[v]; bv = v; } }
      sm[f] = bv;
    }
    const notes = [];
    for (let f = 0; f < nF;) {
      let g = f; while (g < nF && sm[g] === sm[f]) g++;
      if (sm[f] >= 0 && g - f >= 3) notes.push({ t0: ft(f) - HOP / TSR / 2, t1: ft(g) - HOP / TSR / 2, midi: sm[f] });
      f = g;
    }
    const out = [];
    for (const n of notes) {
      let s = n.t0;
      const fa = Math.round((n.t0 * TSR - N / 2) / HOP), fb = Math.round((n.t1 * TSR - N / 2) / HOP);
      for (let f = fa + 3; f < fb - 2; f++) if (out.length === 0 || ft(f) - s > 0.15)
        if (on[f] > 1 && Math.min(melS[f - 3], melS[f - 2], melS[f - 1], melS[f]) < 0.7 * Math.max(melS[f], melS[f + 1], melS[f + 2])) {
          out.push({ t0: s, t1: ft(f) - 0.02, midi: n.midi }); s = ft(f);
        }
      out.push({ t0: s, t1: n.t1, midi: n.midi });
    }
    const HPC = HP.map(pcFromSemis);
    // beat-synchronous profiles -> chords
    const bp = [], gpc = new Float64Array(12);
    for (let i = 0; i < beats.length; i++) {
      const t0 = beats[i], t1 = i + 1 < beats.length ? beats[i + 1] : t0 + 60 / bpm;
      const pc = new Float64Array(12), bs = new Float64Array(12), fr2 = [];
      HT.forEach((t, k) => { if (t >= t0 - 0.05 && t < t1 + 0.05) fr2.push(HPC[k]); });
      for (let c = 0; c < 12; c++) { pc[c] = median(fr2.map(h => h.pc[c])); bs[c] = median(fr2.map(h => h.bs[c])); }
      let r = 0, c = 0; for (let f = bf[i]; f < (bf[i + 1] ?? nF) && f < nF; f++) { r += rms[f]; c++; }
      bp.push({ pc, bs, low: c === 0 || r / c < 0.12 * medR || Math.max(...pc) === 0 });
      for (let k = 0; k < 12; k++) gpc[k] += pc[k];
    }
    let chords = decodeChords(bp);
    // bars: where this first pass changes chords and accents fall; then decode again knowing the bars,
    // with repeated passages voting together
    const accent = bf.map(f => on[f] || 0), meter = detectMeter(chords, accent, bpm);
    if (CFG.barAware) {
      const pcs = CFG.repeatVote ? repeatVote(bp.map(b => b.pc), meter.bpb, meter.phase) : bp.map(b => b.pc);
      const bonus = CFG.keyAware ? keyBonus(localScales(chords, meter.bpb, meter.phase)) : null;
      chords = decodeChords(bp.map((b, i) => ({ ...b, pc: Float64Array.from(pcs[i]) })), changeCosts(bp.length, meter.bpb, meter.phase), bonus);
    }
    const kh = new Array(12).fill(0);
    for (const c of chords) if (c.root >= 0) { for (const [iv, w] of QS[QI[c.q]].ivs) kh[(c.root + iv) % 12] += w; kh[c.root] += 0.5; }
    const key = relativeChoice(detectKey(kh.some(v => v) ? kh : Array.from(gpc)), chords), flats = useFlats(key);
    const phase = meter.phase;

    onProgress(1);
    return { engine: 'browser', meter: { num: meter.num, den: meter.den, bpb: meter.bpb, phase: meter.phase, source: 'harmony' }, tuning: Math.round(tun * 100), tuning_est: Math.round(est.t * 100), tune: tuneMode, tune_note: tuneNote, tempo: opts.tempo || 'auto', duration: input.length / sr, bpm, beats, accent, chords, phase, key, flats, notes: out.filter(n => n.t1 - n.t0 > 0.1) };
  }

  // ---------- live helpers (mic / tab) ----------
  function liveProfiles(db, sr, fftSize) {
    const mag = new Float64Array(db.length);
    for (let k = 0; k < db.length; k++) mag[k] = Math.pow(10, db[k] / 20);
    return profiles(mag, fftSize, sr);
  }
  function bestChord(pc, bs) {
    const sc = scoreAll(pc, bs); let b = 0; for (let s = 1; s < sc.length; s++) if (sc[s] > sc[b]) b = s;
    return { root: Math.floor(b / NQ), q: QS[b % NQ].q, bass: -1, score: sc[b] };
  }
  function acfPitch(buf, sr) {
    let e = 0; for (const v of buf) e += v * v;
    if (Math.sqrt(e / buf.length) < 0.01) return -1;
    const minL = Math.floor(sr / 1000), maxL = Math.floor(sr / 70), n = buf.length - maxL;
    const d = new Float64Array(maxL + 1);
    for (let L = minL; L <= maxL; L++) { let s = 0; for (let i = 0; i < n; i++) { const q = buf[i] - buf[i + L]; s += q * q; } d[L] = s; }
    let run = 0; const cm = new Float64Array(maxL + 1);
    for (let L = minL; L <= maxL; L++) { run += d[L]; cm[L] = d[L] * (L - minL + 1) / (run || 1); }
    for (let L = minL + 1; L < maxL; L++) if (cm[L] < 0.15 && cm[L] <= cm[L + 1]) {
      const a = cm[L - 1], b = cm[L], c = cm[L + 1], den = a - 2 * b + c, off = den ? 0.5 * (a - c) / den : 0;
      return midiOf(sr / (L + off));
    }
    return -1;
  }

  // ---------- synth (demo song + tests) ----------
  function render(events, seconds, sr) {
    const len = Math.ceil(seconds * sr), y = new Float32Array(len);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (const ev of events) {
      if (ev.hat) { const k = Math.floor(ev.t * sr); for (let i = 0; i < 0.03 * sr && k + i < len; i++) y[k + i] += 0.05 * (ev.gain || 1) * Math.exp(-i / sr * 120) * rnd(); continue; }
      if (ev.kick || ev.snare) {
        const k = Math.floor(ev.t * sr);
        for (let i = 0; i < 0.15 * sr && k + i < len; i++) {
          const tt = i / sr;
          y[k + i] += ev.kick ? 0.5 * (ev.gain || 1) * Math.exp(-tt * 30) * Math.sin(2 * Math.PI * (45 + 60 * Math.exp(-tt * 40)) * tt) : 0.12 * Math.exp(-tt * 35) * rnd();
        }
        continue;
      }
      const { t, dur, midi, amp, harm } = ev, rel = 0.08, f = freqOf(midi + (render.detune || 0)), a = Math.floor(t * sr), n = Math.floor((dur + rel) * sr);
      for (let i = 0; i < n && a + i < len; i++) {
        const tt = i / sr, env = Math.min(1, tt / 0.01) * (tt < dur ? 1 - 0.3 * Math.min(1, tt / 0.3) : 0.7 * Math.max(0, 1 - (tt - dur) / rel));
        let s = 0; for (let h = 0; h < harm.length; h++) if (f * (h + 1) < sr / 2) s += harm[h] * Math.sin(2 * Math.PI * f * (h + 1) * tt);
        y[a + i] += amp * env * s;
      }
    }
    let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v)); for (let i = 0; i < len; i++) y[i] *= 0.9 / (pk || 1);
    return y;
  }
  const PAD = [1, 0.45, 0.3, 0.2, 0.15, 0.1, 0.08], BASS = [1, 0.5, 0.25], LEAD = [1, 0.5, 0.33, 0.25, 0.2, 0.16];
  // demo: C2 | G/B | Am7 | Fmaj7 | C | Gsus4 G | G7 | C   (x2) at 100 BPM
  const DEMO_BARS = [
    [[4, 36, [48, 50, 52, 55]]], [[4, 47, [50, 55, 59]]], [[4, 45, [48, 52, 55, 57]]], [[4, 41, [48, 52, 53, 57]]],
    [[4, 36, [48, 52, 55]]], [[2, 43, [50, 55, 60]], [2, 43, [50, 55, 59]]], [[4, 43, [50, 53, 55, 59]]], [[4, 36, [48, 52, 55]]]];
  const DEMO_MEL = [[0,1,64],[1,1,64],[2,1,67],[3,1,67],[4,1,71],[5,1,69],[6,2,67],[8,1,69],[9,1,69],[10,1,72],[11,1,71],[12,2,69],[14,2,64],
    [16,1,67],[17,1,64],[18,1,67],[19,1,72],[20,1,72],[21,1,74],[22,1,71],[23,1,67],[24,1,71],[25,1,74],[26,1,71],[27,1,65],[28,2,64],[30,2,60]];
  function synthDemo(sr = 22050) {
    const sb = 0.6, lead = 1, ev = [];
    for (let rep = 0; rep < 2; rep++) {
      const base = lead + rep * 32 * sb; let beat = 0;
      for (const bar of DEMO_BARS) for (const [len, bass, pad] of bar) {
        const t = base + beat * sb;
        for (const m of pad) ev.push({ t, dur: len * sb - 0.05, midi: m, amp: 0.06, harm: PAD });
        for (let b = 0; b < len; b += 2) ev.push({ t: t + b * sb, dur: Math.min(2, len - b) * sb - 0.05, midi: bass, amp: 0.2, harm: BASS });
        for (let b = 0; b < len; b++) { ev.push({ t: t + b * sb, kick: 1 }); if ((beat + b) % 2) ev.push({ t: t + b * sb, snare: 1 }); }
        beat += len;
      }
      for (const [b, d, m] of DEMO_MEL) ev.push({ t: base + b * sb, dur: d * sb - 0.06, midi: m, amp: 0.15, harm: LEAD });
    }
    return { samples: render(ev, lead + 64 * sb + 1.5, sr), sr };
  }

  function toWav(samples, sr) {
    const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
    return buf;
  }

  return { NAMES, levels, veryLevel, detectMeter, roman, groupSize, PLUS, CFG, P, profiles, analyze, synthDemo, render, toWav, liveProfiles, bestChord, acfPitch, decodeChords, scoreAll, barPhase,
           name, tones, baseOf, useFlats, mod12, SHARP, FLAT, QS, PAD, BASS, LEAD };
})(typeof CHORD_VOCAB !== 'undefined' ? CHORD_VOCAB : require('../backend/app/chord_vocab.json'));
if (typeof module !== 'undefined') module.exports = MA;
