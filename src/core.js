// Pure, DOM-free logic — importable by both index.html and tests

export const Lm = {
  NOSE:0, LS:11, RS:12, LE:13, RE:14,
  LW:15, RW:16, LH:23, RH:24, LK:25, RK:26, LA:27, RA:28
};

export const EX = {
  pull_up: 'Подтягивания',
  push_up:  'Отжимания',
  squat:    'Приседания',
  sit_up:   'Ситапы'
};
export const EX_KEYS = Object.keys(EX);

export function fmtTime(ms) {
  const s = Math.floor(Math.abs(ms) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export const Geo = {
  /** Angle (degrees) at vertex b between rays b→a and b→c */
  angle(a, b, c) {
    const abx = a.x - b.x, aby = a.y - b.y;
    const cbx = c.x - b.x, cby = c.y - b.y;
    const dot = abx * cbx + aby * cby;
    const ma  = Math.hypot(abx, aby);
    const mc  = Math.hypot(cbx, cby);
    if (ma < 1e-6 || mc < 1e-6) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot / (ma * mc)))) * 180 / Math.PI;
  },
  /** Inclination angle (degrees) of segment a→b from horizontal */
  incl(a, b) {
    return Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x)) * 180 / Math.PI;
  },
  /** Clamp-normalise v into [0,1] over [lo,hi] */
  norm(v, lo, hi) {
    return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  },
  /** Safe midpoint — returns the non-null point when one is null */
  midpt(a, b) {
    return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a || b;
  }
};

export const MINVIS = 0.45;

/**
 * Wrap a raw landmark array into a typed frame helper.
 * x is scaled by aspect so angle calcs aren't distorted by non-square video.
 */
export function mkFrame(landmarks, aspect) {
  return {
    g(i) {
      const l = landmarks[i];
      return l && (l.visibility ?? l.presence ?? 1) >= MINVIS
        ? { x: l.x * aspect, y: l.y, v: (l.visibility ?? l.presence ?? 1) }
        : null;
    },
    vis(i) {
      const l = landmarks[i];
      return !!(l && (l.visibility ?? l.presence ?? 1) >= MINVIS);
    }
  };
}

// ---------------------------------------------------------------------------
// Exercise signal functions — return 0 (start/rest) … 1 (peak/contracted)
// ---------------------------------------------------------------------------
export const Analyzers = {
  push_up: {
    cfg: { peak: 0.7, start: 0.3, gap: 450 },
    sig(f) {
      const A = [];
      if (f.vis(Lm.LS) && f.vis(Lm.LE) && f.vis(Lm.LW))
        A.push(Geo.angle(f.g(Lm.LS), f.g(Lm.LE), f.g(Lm.LW)));
      if (f.vis(Lm.RS) && f.vis(Lm.RE) && f.vis(Lm.RW))
        A.push(Geo.angle(f.g(Lm.RS), f.g(Lm.RE), f.g(Lm.RW)));
      if (!A.length) return null;
      return Geo.norm(160 - A.reduce((s, x) => s + x, 0) / A.length, 0, 80);
    }
  },

  squat: {
    cfg: { peak: 0.68, start: 0.3, gap: 450 },
    sig(f) {
      const A = [];
      if (f.vis(Lm.LH) && f.vis(Lm.LK) && f.vis(Lm.LA))
        A.push(Geo.angle(f.g(Lm.LH), f.g(Lm.LK), f.g(Lm.LA)));
      if (f.vis(Lm.RH) && f.vis(Lm.RK) && f.vis(Lm.RA))
        A.push(Geo.angle(f.g(Lm.RH), f.g(Lm.RK), f.g(Lm.RA)));
      if (!A.length) return null;
      return Geo.norm(170 - A.reduce((s, x) => s + x, 0) / A.length, 0, 80);
    }
  },

  pull_up: {
    cfg: { peak: 0.7, start: 0.32, gap: 450 },
    sig(f) {
      const A = [];
      if (f.vis(Lm.LS) && f.vis(Lm.LE) && f.vis(Lm.LW))
        A.push(Geo.angle(f.g(Lm.LS), f.g(Lm.LE), f.g(Lm.LW)));
      if (f.vis(Lm.RS) && f.vis(Lm.RE) && f.vis(Lm.RW))
        A.push(Geo.angle(f.g(Lm.RS), f.g(Lm.RE), f.g(Lm.RW)));
      if (!A.length) return null;
      const flex = Geo.norm(160 - A.reduce((s, x) => s + x, 0) / A.length, 0, 105);
      const n  = f.g(Lm.NOSE), ls = f.g(Lm.LS), rs = f.g(Lm.RS);
      const lw = f.g(Lm.LW),   rw = f.g(Lm.RW);
      const lh = f.g(Lm.LH),   rh = f.g(Lm.RH);
      if (n && ls && rs && lw && rw && lh && rh) {
        const wy = (lw.y + rw.y) / 2, sy = (ls.y + rs.y) / 2, hy = (lh.y + rh.y) / 2;
        const torso = hy - sy;
        if (torso > 1e-3) {
          const gap  = (n.y - wy) / torso;
          const vert = 1 - Geo.norm(gap, 0.2, 1.4);
          return 0.5 * flex + 0.5 * vert;
        }
      }
      return flex;
    }
  },

  sit_up: {
    cfg: { peak: 0.68, start: 0.28, gap: 500 },
    sig(f) {
      if (!f.vis(Lm.LH) && !f.vis(Lm.RH)) return null;
      if (!f.vis(Lm.LS) && !f.vis(Lm.RS)) return null;
      const ls = f.g(Lm.LS), rs = f.g(Lm.RS);
      const lh = f.g(Lm.LH), rh = f.g(Lm.RH);
      const sh = Geo.midpt(ls, rs), hp = Geo.midpt(lh, rh);
      if (!sh || !hp) return null;
      return Geo.norm(Geo.incl(hp, sh), 15, 65);
    }
  }
};

// ---------------------------------------------------------------------------
// One-Euro smoothing filter
// ---------------------------------------------------------------------------
export class OneEuro {
  constructor(minCut = 1, beta = 0.7, dCut = 1) {
    this.minCut = minCut; this.beta = beta; this.dCut = dCut;
    this.reset();
  }
  reset() { this.started = false; this.tPrev = -1; this.xPrev = 0; this.dxPrev = 0; }
  _alpha(cut, dt) { const tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); }
  filter(x, t) {
    if (!this.started || this.tPrev < 0) {
      this.started = true; this.xPrev = x; this.tPrev = t; this.dxPrev = 0;
      return x;
    }
    const dt  = Math.max(1, t - this.tPrev) / 1000;
    this.tPrev = t;
    const dx   = (x - this.xPrev) / dt;
    const edx  = this.dxPrev + this._alpha(this.dCut, dt) * (dx - this.dxPrev);
    this.dxPrev = edx;
    const cut  = this.minCut + this.beta * Math.abs(edx);
    const ex   = this.xPrev + this._alpha(cut, dt) * (x - this.xPrev);
    this.xPrev = ex;
    return ex;
  }
}

// ---------------------------------------------------------------------------
// Rep-counting state machine (hysteresis FSM)
// ---------------------------------------------------------------------------
export class RepEngine {
  constructor(ex) {
    this.A   = Analyzers[ex];
    this.cfg = this.A.cfg;
    this.filter = new OneEuro();
    this.reset();
  }
  reset() {
    this.reps = 0; this.phase = 'start'; this.reachedPeak = false;
    this.lastRep = 0; this.lost = 0;
    this.filter.reset();
  }
  adjust(d) { this.reps = Math.max(0, this.reps + d); }

  /**
   * Process one video frame.
   * @param {Array|null} landmarks  MediaPipe landmark array, or null
   * @param {number}     aspect     videoWidth / videoHeight
   * @param {number}     t          performance.now() timestamp (ms)
   * @param {number|undefined} _sig  Test-seam: supply raw signal directly (bypasses landmark parsing)
   */
  onFrame(landmarks, aspect, t, _sig = undefined) {
    const f   = landmarks ? mkFrame(landmarks, aspect) : null;
    const raw = _sig !== undefined ? _sig : (f ? this.A.sig(f) : null);

    if (raw == null) {
      this.lost++;
      if (this.lost > 5) this.filter.reset();
      return { quality: 'lost', phase: this.phase, reps: this.reps, counted: false };
    }

    this.lost = 0;
    const s = this.filter.filter(raw, t);
    let counted = false;

    if (s >= this.cfg.peak) {
      this.reachedPeak = true;
      this.phase = 'peak';
    } else if (s <= this.cfg.start) {
      if (this.reachedPeak && t - this.lastRep >= this.cfg.gap) {
        this.reps++;
        counted  = true;
        this.lastRep = t;
      }
      this.reachedPeak = false;
      this.phase = 'start';
    } else {
      this.phase = this.reachedPeak ? 'down' : 'up';
    }

    return { quality: 'good', phase: this.phase, reps: this.reps, counted, signal: s };
  }
}

// ---------------------------------------------------------------------------
// Runs all four analyzers in parallel; tracks rolling variance per exercise
// ---------------------------------------------------------------------------
export class MultiAnalyzer {
  constructor() {
    this.filters = {};
    this.bufs    = {};
    for (const ex of EX_KEYS) {
      this.filters[ex] = new OneEuro(1, 0.7, 1);
      this.bufs[ex]    = [];
    }
    this.BUF = 90; // ~3 s at 30 fps
  }

  reset() {
    for (const ex of EX_KEYS) {
      this.filters[ex].reset();
      this.bufs[ex] = [];
    }
  }

  onFrame(landmarks, aspect, t) {
    if (!landmarks) return null;
    const f       = mkFrame(landmarks, aspect);
    const signals = {}, vars = {};
    for (const ex of EX_KEYS) {
      const raw = Analyzers[ex].sig(f);
      if (raw != null) {
        const s = this.filters[ex].filter(raw, t);
        this.bufs[ex].push(s);
        if (this.bufs[ex].length > this.BUF) this.bufs[ex].shift();
        signals[ex] = s;
        vars[ex]    = this._var(this.bufs[ex]);
      } else {
        vars[ex]    = 0;
        signals[ex] = null;
      }
    }
    return { signals, vars };
  }

  /** Population variance */
  _var(buf) {
    if (buf.length < 6) return 0;
    const mean = buf.reduce((a, b) => a + b, 0) / buf.length;
    return buf.reduce((a, b) => a + (b - mean) ** 2, 0) / buf.length;
  }

  totalActivity(vars) {
    return Object.values(vars).reduce((a, b) => a + b, 0);
  }
}

// ---------------------------------------------------------------------------
// Structural body-orientation classifier
// Returns: 'pull_up' | 'squat' | 'horizontal' | null
// ---------------------------------------------------------------------------
export function structuralClassify(landmarks, aspect) {
  const f    = mkFrame(landmarks, aspect);
  const ls   = f.g(Lm.LS), rs  = f.g(Lm.RS);
  const lh   = f.g(Lm.LH), rh  = f.g(Lm.RH);
  const lw   = f.g(Lm.LW), rw  = f.g(Lm.RW);
  const nose = f.g(Lm.NOSE);

  if (!ls && !rs) return null;
  if (!lh && !rh) return null;

  const sh = Geo.midpt(ls, rs);
  const hp = Geo.midpt(lh, rh);
  if (!sh || !hp) return null;

  // 0 = vertical spine (standing), 90 = horizontal (lying)
  const spineAngle = Math.atan2(Math.abs(sh.x - hp.x), Math.abs(sh.y - hp.y)) * 180 / Math.PI;

  if (spineAngle < 38) {
    // Standing / hanging — distinguish pull-up by wrist height
    const wristY  = lw && rw ? (lw.y + rw.y) / 2 : lw?.y ?? rw?.y ?? 1;
    const noseY   = nose?.y ?? sh.y;
    return wristY < noseY - 0.04 ? 'pull_up' : 'squat';
  }

  if (spineAngle > 42) return 'horizontal'; // push-up or sit-up

  return null; // transitional angle — uncertain
}
