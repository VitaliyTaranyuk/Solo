import { describe, test, expect, beforeEach } from 'vitest';
import {
  fmtTime, Geo, OneEuro, MINVIS,
  mkFrame, Lm, Analyzers, RepEngine, MultiAnalyzer,
  structuralClassify, EX_KEYS
} from '../src/core.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a full 33-landmark array; overrides supply {x,y,visibility} per index */
function makeLm(overrides = {}) {
  const base = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1.0 }));
  for (const [i, val] of Object.entries(overrides)) base[+i] = { ...base[+i], ...val };
  return base;
}

/**
 * Drive a RepEngine through many frames at a constant raw signal value.
 * Returns the last frame result and the final timestamp used.
 */
function feedSignal(engine, signal, frames = 12, startT = 0, dt = 33) {
  let result;
  for (let i = 0; i < frames; i++) result = engine.onFrame(null, 1, startT + i * dt, signal);
  return { result, endT: startT + (frames - 1) * dt };
}

// ---------------------------------------------------------------------------
// fmtTime
// ---------------------------------------------------------------------------
describe('fmtTime', () => {
  test('zero ms → 00:00', () => expect(fmtTime(0)).toBe('00:00'));
  test('1 second', ()      => expect(fmtTime(1000)).toBe('00:01'));
  test('61 seconds',()     => expect(fmtTime(61000)).toBe('01:01'));
  test('10 minutes',()     => expect(fmtTime(600000)).toBe('10:00'));
  test('1 hour',()         => expect(fmtTime(3600000)).toBe('60:00'));
  test('negative ms handled', () => expect(fmtTime(-5000)).toBe('00:05'));
});

// ---------------------------------------------------------------------------
// Geo
// ---------------------------------------------------------------------------
describe('Geo.angle', () => {
  test('right angle (90°)', () => {
    const a = { x: 0, y: 0 }, b = { x: 1, y: 0 }, c = { x: 1, y: 1 };
    expect(Geo.angle(a, b, c)).toBeCloseTo(90, 1);
  });
  test('straight line (180°)', () => {
    const a = { x: 0, y: 0 }, b = { x: 1, y: 0 }, c = { x: 2, y: 0 };
    expect(Geo.angle(a, b, c)).toBeCloseTo(180, 1);
  });
  test('45-degree angle', () => {
    const a = { x: 0, y: 0 }, b = { x: 1, y: 0 }, c = { x: 2, y: 1 };
    // ab direction: (-1,0), cb direction: (1,-1) normalised
    // expected angle at b ≈ 135° (angle between left and upper-right)
    const angle = Geo.angle(a, b, c);
    expect(angle).toBeGreaterThan(100);
    expect(angle).toBeLessThan(170);
  });
  test('zero-length vector returns 0', () => {
    const p = { x: 1, y: 1 };
    expect(Geo.angle(p, p, { x: 2, y: 2 })).toBe(0);
  });
});

describe('Geo.norm', () => {
  test('midpoint', () => expect(Geo.norm(5, 0, 10)).toBeCloseTo(0.5));
  test('at lo → 0', () => expect(Geo.norm(0, 0, 10)).toBe(0));
  test('at hi → 1', () => expect(Geo.norm(10, 0, 10)).toBe(1));
  test('below lo → clamped 0', () => expect(Geo.norm(-5, 0, 10)).toBe(0));
  test('above hi → clamped 1', () => expect(Geo.norm(15, 0, 10)).toBe(1));
});

describe('Geo.incl', () => {
  test('horizontal segment → 0°', () => {
    expect(Geo.incl({ x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0, 1);
  });
  test('vertical segment → 90°', () => {
    expect(Geo.incl({ x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90, 1);
  });
  test('45° diagonal', () => {
    expect(Geo.incl({ x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(45, 1);
  });
});

describe('Geo.midpt', () => {
  test('two points', () => {
    const m = Geo.midpt({ x: 0, y: 0 }, { x: 2, y: 4 });
    expect(m.x).toBe(1); expect(m.y).toBe(2);
  });
  test('null + point returns the point', () => {
    const p = { x: 3, y: 7 };
    expect(Geo.midpt(null, p)).toEqual(p);
    expect(Geo.midpt(p, null)).toEqual(p);
  });
  test('both null returns null', () => {
    expect(Geo.midpt(null, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mkFrame / visibility
// ---------------------------------------------------------------------------
describe('mkFrame', () => {
  test('visible landmark returns scaled x', () => {
    const lm = makeLm({ 11: { x: 0.5, y: 0.4, visibility: 0.9 } });
    const f  = mkFrame(lm, 2); // aspect=2
    const pt = f.g(11);
    expect(pt).not.toBeNull();
    expect(pt.x).toBeCloseTo(1.0); // 0.5 * 2
    expect(pt.y).toBeCloseTo(0.4);
  });
  test('low-visibility landmark returns null', () => {
    const lm = makeLm({ 11: { x: 0.5, y: 0.5, visibility: 0.2 } });
    expect(mkFrame(lm, 1).g(11)).toBeNull();
  });
  test('vis() returns false below MINVIS', () => {
    const lm = makeLm({ 11: { visibility: MINVIS - 0.01 } });
    expect(mkFrame(lm, 1).vis(11)).toBe(false);
  });
  test('vis() returns true at MINVIS', () => {
    const lm = makeLm({ 11: { visibility: MINVIS } });
    expect(mkFrame(lm, 1).vis(11)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// OneEuro filter
// ---------------------------------------------------------------------------
describe('OneEuro', () => {
  test('first call returns exact value', () => {
    const f = new OneEuro();
    expect(f.filter(0.42, 0)).toBeCloseTo(0.42);
  });
  test('converges to constant input', () => {
    const f = new OneEuro();
    let v = f.filter(1.0, 0);
    for (let i = 1; i <= 30; i++) v = f.filter(1.0, i * 33);
    expect(v).toBeCloseTo(1.0, 2);
  });
  test('stays ≥ 0 for non-negative input stream', () => {
    const f = new OneEuro();
    for (let i = 0; i < 20; i++) {
      const out = f.filter(Math.random(), i * 33);
      expect(out).toBeGreaterThanOrEqual(-0.01); // allow tiny float error
    }
  });
  test('reset clears internal state', () => {
    const f = new OneEuro();
    f.filter(100, 0);
    f.reset();
    const v = f.filter(0.5, 1000); // fresh start — should return exactly 0.5
    expect(v).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// Analyzers — signal values for carefully crafted landmark positions
// ---------------------------------------------------------------------------
describe('Analyzers.push_up signal', () => {
  // Helpers: suppress the opposite arm so only the configured side is used.
  const hideRight = { [Lm.RS]: { visibility: 0 }, [Lm.RE]: { visibility: 0 }, [Lm.RW]: { visibility: 0 } };
  const hideLeft  = { [Lm.LS]: { visibility: 0 }, [Lm.LE]: { visibility: 0 }, [Lm.LW]: { visibility: 0 } };

  // 90° elbow angle → high signal (peak)
  function bentArmLm() {
    return makeLm({
      [Lm.LS]: { x: 0.3, y: 0.3 }, // shoulder
      [Lm.LE]: { x: 0.5, y: 0.3 }, // elbow to the right
      [Lm.LW]: { x: 0.5, y: 0.5 }, // wrist straight down → 90° at elbow
      ...hideRight,
    });
  }
  // ~170° elbow (almost straight) → low signal (start)
  function straightArmLm() {
    return makeLm({
      [Lm.LS]: { x: 0.3, y: 0.5 },
      [Lm.LE]: { x: 0.5, y: 0.5 },
      [Lm.LW]: { x: 0.7, y: 0.47 }, // nearly collinear → ~171°
      ...hideRight,
    });
  }

  test('bent elbow → signal ≥ peak threshold (0.7)', () => {
    const sig = Analyzers.push_up.sig(mkFrame(bentArmLm(), 1));
    expect(sig).toBeGreaterThanOrEqual(0.7);
  });
  test('straight elbow → signal ≤ start threshold (0.3)', () => {
    const sig = Analyzers.push_up.sig(mkFrame(straightArmLm(), 1));
    expect(sig).toBeLessThanOrEqual(0.3);
  });
  test('all arm landmarks invisible → null', () => {
    const lm = makeLm({ ...hideLeft, ...hideRight });
    expect(Analyzers.push_up.sig(mkFrame(lm, 1))).toBeNull();
  });
});

describe('Analyzers.squat signal', () => {
  const hideRightLeg = { [Lm.RH]: { visibility: 0 }, [Lm.RK]: { visibility: 0 }, [Lm.RA]: { visibility: 0 } };

  // Knee bent to ~90° → high signal
  function deepSquatLm() {
    return makeLm({
      [Lm.LH]: { x: 0.5, y: 0.4 }, // hip
      [Lm.LK]: { x: 0.5, y: 0.6 }, // knee below hip
      [Lm.LA]: { x: 0.3, y: 0.6 }, // ankle to the left → 90° at knee
      ...hideRightLeg,
    });
  }
  // Straight leg (standing, ~180°) → low signal
  function standingLm() {
    return makeLm({
      [Lm.LH]: { x: 0.5, y: 0.3 },
      [Lm.LK]: { x: 0.5, y: 0.6 },
      [Lm.LA]: { x: 0.5, y: 0.9 }, // collinear → 180°
      ...hideRightLeg,
    });
  }
  test('deep squat → signal ≥ 0.68', () => {
    const sig = Analyzers.squat.sig(mkFrame(deepSquatLm(), 1));
    expect(sig).toBeGreaterThanOrEqual(0.68);
  });
  test('standing straight → signal ≤ 0.15', () => {
    const sig = Analyzers.squat.sig(mkFrame(standingLm(), 1));
    expect(sig).toBeLessThanOrEqual(0.15);
  });
});

// ---------------------------------------------------------------------------
// RepEngine FSM
// ---------------------------------------------------------------------------
describe('RepEngine', () => {
  let engine;
  beforeEach(() => { engine = new RepEngine('push_up'); });

  test('starts at 0 reps', () => {
    expect(engine.reps).toBe(0);
  });

  test('null landmarks → quality=lost, reps unchanged', () => {
    const r = engine.onFrame(null, 1, 0);
    expect(r.quality).toBe('lost');
    expect(r.reps).toBe(0);
    expect(r.counted).toBe(false);
  });

  test('counts one rep: start → peak → start (sufficient gap)', () => {
    // Feed signal=0.05 (start) for 12 frames to stabilise filter
    const { endT: t1 } = feedSignal(engine, 0.05, 12, 0);
    // Feed signal=1.0 (peak) for 12 frames
    const { endT: t2 } = feedSignal(engine, 1.0, 12, t1 + 33);
    // Feed signal=0.05 again — gap from t=0 > 450 ms → rep counted on first qualifying frame
    const { result } = feedSignal(engine, 0.05, 12, t2 + 33);
    // reps accumulates; .counted is only true on the single frame the rep fires
    expect(result.reps).toBe(1);
  });

  test('counts two consecutive reps', () => {
    let t = 0;
    // Rep 1
    ({ endT: t } = feedSignal(engine, 0.0, 12, t));
    ({ endT: t } = feedSignal(engine, 1.0, 12, t + 33));
    ({ endT: t } = feedSignal(engine, 0.0, 12, t + 33));
    // Rep 2
    ({ endT: t } = feedSignal(engine, 1.0, 12, t + 33));
    const { result } = feedSignal(engine, 0.0, 12, t + 33);
    expect(result.reps).toBe(2);
  });

  test('gap enforcement: too-fast repeat does NOT count as extra rep', () => {
    let t = 0;
    // Do one full rep
    ({ endT: t } = feedSignal(engine, 0.0, 12, t));
    ({ endT: t } = feedSignal(engine, 1.0, 12, t + 33));
    ({ endT: t } = feedSignal(engine, 0.0, 12, t + 33));
    const repsAfterFirst = engine.reps;
    expect(repsAfterFirst).toBe(1);

    // Immediately do another cycle within 100 ms (< 450 ms gap)
    ({ endT: t } = feedSignal(engine, 1.0, 2, t + 33));
    const { result } = feedSignal(engine, 0.0, 2, t + 10);
    // Gap since lastRep is too short → should still be 1
    expect(result.reps).toBe(repsAfterFirst);
  });

  test('no rep counted if peak never reached', () => {
    // Only feed start-level signal, never peak
    const { result } = feedSignal(engine, 0.1, 30, 0);
    expect(result.reps).toBe(0);
    expect(result.counted).toBe(false);
  });

  test('adjust() increases reps', () => {
    engine.reps = 3;
    engine.adjust(2);
    expect(engine.reps).toBe(5);
  });

  test('adjust() decreases reps', () => {
    engine.reps = 3;
    engine.adjust(-1);
    expect(engine.reps).toBe(2);
  });

  test('adjust() clamps at 0', () => {
    engine.adjust(-100);
    expect(engine.reps).toBe(0);
  });

  test('reset() clears all state', () => {
    let t = 0;
    ({ endT: t } = feedSignal(engine, 0.0, 12, t));
    ({ endT: t } = feedSignal(engine, 1.0, 12, t + 33));
    feedSignal(engine, 0.0, 12, t + 33);
    expect(engine.reps).toBe(1);

    engine.reset();
    expect(engine.reps).toBe(0);
    expect(engine.phase).toBe('start');
    expect(engine.reachedPeak).toBe(false);
  });

  test('quality=good when valid signal present', () => {
    const r = engine.onFrame(null, 1, 0, 0.5);
    expect(r.quality).toBe('good');
  });

  test('phase reflects signal position', () => {
    // After stabilising at peak
    feedSignal(engine, 1.0, 12, 0);
    expect(engine.phase).toBe('peak');
    // After going back to start
    feedSignal(engine, 0.0, 12, 400);
    expect(engine.phase).toBe('start');
  });

  test('works for all four exercise types', () => {
    for (const ex of EX_KEYS) {
      const eng = new RepEngine(ex);
      let t = 0;
      ({ endT: t } = feedSignal(eng, 0.0, 12, t));
      ({ endT: t } = feedSignal(eng, 1.0, 12, t + 33));
      feedSignal(eng, 0.0, 12, t + 33);
      expect(eng.reps).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// MultiAnalyzer
// ---------------------------------------------------------------------------
describe('MultiAnalyzer._var', () => {
  let ma;
  beforeEach(() => { ma = new MultiAnalyzer(); });

  test('empty buffer → 0', ()   => expect(ma._var([])).toBe(0));
  test('< 6 items → 0', ()      => expect(ma._var([1, 2, 3])).toBe(0));
  test('constant buffer → 0', () => expect(ma._var([5,5,5,5,5,5,5])).toBeCloseTo(0));
  test('alternating 0/1 → ~0.25', () => {
    const buf = Array.from({ length: 20 }, (_, i) => i % 2);
    expect(ma._var(buf)).toBeCloseTo(0.25, 2);
  });
  test('all zeros → 0', () => {
    expect(ma._var(new Array(10).fill(0))).toBe(0);
  });
});

describe('MultiAnalyzer.totalActivity', () => {
  test('sums variance values', () => {
    const ma = new MultiAnalyzer();
    const vars = { push_up: 0.01, squat: 0.02, pull_up: 0, sit_up: 0.005 };
    expect(ma.totalActivity(vars)).toBeCloseTo(0.035, 5);
  });
  test('all zeros → 0', () => {
    const ma = new MultiAnalyzer();
    const vars = Object.fromEntries(EX_KEYS.map(k => [k, 0]));
    expect(ma.totalActivity(vars)).toBe(0);
  });
});

describe('MultiAnalyzer.onFrame', () => {
  test('null landmarks → null', () => {
    const ma = new MultiAnalyzer();
    expect(ma.onFrame(null, 1, 0)).toBeNull();
  });

  test('returns signals and vars for all exercise keys', () => {
    const ma  = new MultiAnalyzer();
    const lm  = makeLm(); // all visible, mid positions
    const out = ma.onFrame(lm, 1, 0);
    expect(out).not.toBeNull();
    expect(Object.keys(out.signals).sort()).toEqual([...EX_KEYS].sort());
    expect(Object.keys(out.vars).sort()).toEqual([...EX_KEYS].sort());
  });

  test('buffer caps at BUF entries', () => {
    const ma = new MultiAnalyzer();
    const lm = makeLm();
    for (let i = 0; i <= ma.BUF + 5; i++) ma.onFrame(lm, 1, i * 33);
    for (const ex of EX_KEYS) {
      if (ma.bufs[ex].length > 0) expect(ma.bufs[ex].length).toBeLessThanOrEqual(ma.BUF);
    }
  });

  test('reset clears all buffers', () => {
    const ma = new MultiAnalyzer();
    const lm = makeLm();
    for (let i = 0; i < 10; i++) ma.onFrame(lm, 1, i * 33);
    ma.reset();
    for (const ex of EX_KEYS) expect(ma.bufs[ex]).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// structuralClassify
// ---------------------------------------------------------------------------
describe('structuralClassify', () => {
  test('vertical body, wrists low → squat', () => {
    const lm = makeLm({
      [Lm.LS]: { x: 0.45, y: 0.30 }, [Lm.RS]: { x: 0.55, y: 0.30 },
      [Lm.LH]: { x: 0.45, y: 0.60 }, [Lm.RH]: { x: 0.55, y: 0.60 },
      [Lm.LW]: { x: 0.40, y: 0.55 }, [Lm.RW]: { x: 0.60, y: 0.55 },
      [Lm.NOSE]: { x: 0.50, y: 0.15 },
    });
    expect(structuralClassify(lm, 1)).toBe('squat');
  });

  test('vertical body, wrists above nose → pull_up', () => {
    const lm = makeLm({
      [Lm.LS]: { x: 0.45, y: 0.40 }, [Lm.RS]: { x: 0.55, y: 0.40 },
      [Lm.LH]: { x: 0.45, y: 0.70 }, [Lm.RH]: { x: 0.55, y: 0.70 },
      [Lm.LW]: { x: 0.40, y: 0.05 }, [Lm.RW]: { x: 0.60, y: 0.05 }, // wrists high
      [Lm.NOSE]: { x: 0.50, y: 0.25 }, // nose below wrists
    });
    expect(structuralClassify(lm, 1)).toBe('pull_up');
  });

  test('horizontal body → "horizontal"', () => {
    // Spine goes left-right: shoulder x=0.3, hip x=0.7, same y
    const lm = makeLm({
      [Lm.LS]: { x: 0.30, y: 0.50 }, [Lm.RS]: { x: 0.30, y: 0.50 },
      [Lm.LH]: { x: 0.70, y: 0.50 }, [Lm.RH]: { x: 0.70, y: 0.50 },
    });
    expect(structuralClassify(lm, 1)).toBe('horizontal');
  });

  test('missing shoulder landmarks → null', () => {
    const lm = makeLm({
      [Lm.LS]: { visibility: 0.0 }, [Lm.RS]: { visibility: 0.0 },
      [Lm.LH]: { x: 0.5, y: 0.6 },
    });
    expect(structuralClassify(lm, 1)).toBeNull();
  });

  test('missing hip landmarks → null', () => {
    const lm = makeLm({
      [Lm.LS]: { x: 0.5, y: 0.3 },
      [Lm.LH]: { visibility: 0.0 }, [Lm.RH]: { visibility: 0.0 },
    });
    expect(structuralClassify(lm, 1)).toBeNull();
  });
});
