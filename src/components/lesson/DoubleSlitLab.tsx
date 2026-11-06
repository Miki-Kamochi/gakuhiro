"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./styles";
import { doubleSlitIntensity, wavelengthToRgb } from "./physics";

// Apparatus (all lengths in millimetres)
const SCREEN_DIST_MM = 1000; // slits to screen: 1 m
const SLIT_WIDTH_MM = 0.04; // each slit is 40 µm wide
const HALF_WIDTH_MM = 15; // the screen shows −15 mm … +15 mm
const BINS = 150;
const PREFILL = 200; // hits already on the screen when the lab first appears
const MAX_HITS = 40000;

const DEFAULT_WAVELENGTH_NM = 532;
const DEFAULT_SEPARATION_MM = 0.25;

type Params = { wavelengthNm: number; separationMm: number; whichPath: boolean };

type Sim = {
  xs: number[]; // mm from centre
  ys: number[]; // 0..1 down the screen
  bins: number[];
};

function newSim(): Sim {
  return { xs: [], ys: [], bins: new Array(BINS).fill(0) };
}

function intensityAt(x: number, p: Params) {
  return doubleSlitIntensity(x, p.wavelengthNm * 1e-6, p.separationMm, SLIT_WIDTH_MM, SCREEN_DIST_MM, p.whichPath);
}

/** Draws one landing position from the intensity pattern (rejection sampling; the peak intensity is 1). */
function sampleHit(p: Params): number {
  for (;;) {
    const x = (Math.random() * 2 - 1) * HALF_WIDTH_MM;
    if (Math.random() < intensityAt(x, p)) return x;
  }
}

function fire(sim: Sim, p: Params, n: number) {
  for (let i = 0; i < n && sim.xs.length < MAX_HITS; i++) {
    const x = sampleHit(p);
    sim.xs.push(x);
    sim.ys.push(Math.random());
    const bin = Math.min(BINS - 1, Math.floor(((x + HALF_WIDTH_MM) / (2 * HALF_WIDTH_MM)) * BINS));
    sim.bins[bin] += 1;
  }
}

function sizeCanvas(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h, dpr };
}

function drawHits(canvas: HTMLCanvasElement, sim: Sim, p: Params, from: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { w, h, dpr } = sizeCanvas(canvas);
  if (from === 0) ctx.clearRect(0, 0, w, h);
  const [r, g, b] = wavelengthToRgb(p.wavelengthNm);
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.85)`;
  const radius = 1.1 * dpr;
  for (let i = from; i < sim.xs.length; i++) {
    const px = ((sim.xs[i] + HALF_WIDTH_MM) / (2 * HALF_WIDTH_MM)) * w;
    const py = sim.ys[i] * h;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHistogram(canvas: HTMLCanvasElement, sim: Sim, p: Params) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { w, h, dpr } = sizeCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const n = sim.xs.length;
  const binWidthMm = (2 * HALF_WIDTH_MM) / BINS;

  // Expected hits per bin from the wave prediction, normalised to the same number of hits
  const expected = new Array(BINS).fill(0);
  let total = 0;
  for (let i = 0; i < BINS; i++) {
    // average over a few points inside the bin so narrow fringes are not aliased
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const x = -HALF_WIDTH_MM + (i + (k + 0.5) / 4) * binWidthMm;
      sum += intensityAt(x, p);
    }
    expected[i] = sum / 4;
    total += expected[i];
  }
  for (let i = 0; i < BINS; i++) expected[i] = total > 0 ? (expected[i] / total) * n : 0;

  const peak = Math.max(1, ...sim.bins, ...expected) * 1.1;
  const pad = 6 * dpr;
  const usable = h - pad;
  const barW = w / BINS;

  const [r, g, b] = wavelengthToRgb(p.wavelengthNm);
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.75)`;
  for (let i = 0; i < BINS; i++) {
    const bh = (sim.bins[i] / peak) * usable;
    ctx.fillRect(i * barW + 0.5 * dpr, h - bh, Math.max(1, barW - 1 * dpr), bh);
  }

  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  for (let i = 0; i < BINS; i++) {
    const x = (i + 0.5) * barW;
    const y = h - (expected[i] / peak) * usable;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

export default function DoubleSlitLab() {
  const [wavelengthNm, setWavelengthNm] = useState(DEFAULT_WAVELENGTH_NM);
  const [separationMm, setSeparationMm] = useState(DEFAULT_SEPARATION_MM);
  const [whichPath, setWhichPath] = useState(false);
  const [running, setRunning] = useState(false);
  const [count, setCount] = useState(PREFILL);

  const screenRef = useRef<HTMLCanvasElement>(null);
  const histRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Sim | null>(null);

  const redrawAll = (p: Params) => {
    const sim = simRef.current;
    if (!sim) return;
    if (screenRef.current) drawHits(screenRef.current, sim, p, 0);
    if (histRef.current) drawHistogram(histRef.current, sim, p);
  };

  // Start a fresh screen with a few hundred hits so the pattern is visible at rest
  const restart = (p: Params) => {
    const sim = newSim();
    fire(sim, p, PREFILL);
    simRef.current = sim;
    setCount(sim.xs.length);
    redrawAll(p);
  };

  // First paint: create the simulation once (Strict Mode runs effects twice in development)
  useEffect(() => {
    if (simRef.current) return;
    const sim = newSim();
    fire(sim, { wavelengthNm: DEFAULT_WAVELENGTH_NM, separationMm: DEFAULT_SEPARATION_MM, whichPath: false }, PREFILL);
    simRef.current = sim;
  }, []);

  // Keep the canvases sharp and redrawn when their size changes
  useEffect(() => {
    const p = { wavelengthNm, separationMm, whichPath };
    const redraw = () => {
      const sim = simRef.current;
      if (!sim) return;
      if (screenRef.current) drawHits(screenRef.current, sim, p, 0);
      if (histRef.current) drawHistogram(histRef.current, sim, p);
    };
    redraw();
    const observer = new ResizeObserver(redraw);
    if (screenRef.current) observer.observe(screenRef.current);
    if (histRef.current) observer.observe(histRef.current);
    return () => observer.disconnect();
  }, [wavelengthNm, separationMm, whichPath]);

  // Fire particles while running; the rate ramps up so the first hits can be seen one by one
  useEffect(() => {
    if (!running) return;
    const p = { wavelengthNm, separationMm, whichPath };
    let frame = 0;
    let carry = 0;
    const tick = () => {
      const sim = simRef.current;
      if (!sim) return;
      if (sim.xs.length >= MAX_HITS) {
        setRunning(false);
        return;
      }
      carry += Math.min(80, Math.max(0.5, sim.xs.length / 60));
      const n = Math.floor(carry);
      carry -= n;
      if (n > 0) {
        const from = sim.xs.length;
        fire(sim, p, n);
        if (screenRef.current) drawHits(screenRef.current, sim, p, from);
        if (histRef.current) drawHistogram(histRef.current, sim, p);
        setCount(sim.xs.length);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, wavelengthNm, separationMm, whichPath]);

  const fireBatch = (n: number) => {
    const sim = simRef.current;
    if (!sim) return;
    const p = { wavelengthNm, separationMm, whichPath };
    const from = sim.xs.length;
    fire(sim, p, n);
    if (screenRef.current) drawHits(screenRef.current, sim, p, from);
    if (histRef.current) drawHistogram(histRef.current, sim, p);
    setCount(sim.xs.length);
  };

  const fringeSpacingMm = (wavelengthNm * 1e-6 * SCREEN_DIST_MM) / separationMm;
  const [r, g, b] = wavelengthToRgb(wavelengthNm);
  const full = count >= MAX_HITS;

  return (
    <figure className={`${styles.lab} ${styles.wide}`} aria-labelledby="double-slit-title">
      <div className={styles.labHead}>
        <h3 className={styles.labTitle} id="double-slit-title">
          Lab 1 · Double slit, one photon at a time
        </h3>
        <p className={styles.labNote}>Slits 40 µm wide · screen 1.00 m away</p>
      </div>

      <div className={styles.screen}>
        <canvas
          ref={screenRef}
          role="img"
          aria-label={
            whichPath
              ? `Detector screen with ${count} photon hits forming one broad band, because the slits are being watched.`
              : `Detector screen with ${count} photon hits forming bright and dark bands about ${fringeSpacingMm.toFixed(2)} mm apart.`
          }
        />
      </div>

      <div className={styles.histogram}>
        <canvas ref={histRef} role="img" aria-label="Histogram of hit positions compared with the wave prediction." />
      </div>
      <div className={styles.axis} aria-hidden="true">
        <span>−15 mm</span>
        <span>0</span>
        <span>+15 mm</span>
      </div>

      <div className={styles.stats} aria-live="polite">
        <span>
          Photons detected <b>{count.toLocaleString("en-US")}</b>
        </span>
        <span>
          Predicted fringe spacing <b>{whichPath ? "no fringes" : `${fringeSpacingMm.toFixed(2)} mm`}</b>
        </span>
        <span className={styles.legend}>
          <span className={styles.swatch} style={{ background: `rgb(${r}, ${g}, ${b})` }} /> hits per position
        </span>
        <span className={styles.legend}>
          <span className={styles.swatchLine} /> wave prediction
        </span>
      </div>

      <div className={styles.toolbar}>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonPrimary}`}
          onClick={() => setRunning((v) => !v)}
          disabled={full}
        >
          {running ? "Pause" : full ? "Screen full" : "Play"}
        </button>
        <button type="button" className={styles.button} onClick={() => fireBatch(1)} disabled={full}>
          Fire 1
        </button>
        <button type="button" className={styles.button} onClick={() => fireBatch(1000)} disabled={full}>
          Fire 1,000
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => restart({ wavelengthNm, separationMm, whichPath })}
        >
          Clear screen
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={whichPath}
          className={styles.switch}
          onClick={() => {
            const next = !whichPath;
            setWhichPath(next);
            restart({ wavelengthNm, separationMm, whichPath: next });
          }}
        >
          <span className={styles.switchTrack} aria-hidden="true" />
          Watch which slit
        </button>
      </div>

      <div className={styles.controls}>
        <label className={styles.control} htmlFor="ds-wavelength">
          <span className={styles.controlLabel}>
            Wavelength <span className={styles.controlValue}>{wavelengthNm} nm</span>
          </span>
          <input
            id="ds-wavelength"
            className={styles.slider}
            type="range"
            min={400}
            max={700}
            step={1}
            value={wavelengthNm}
            onChange={(e) => {
              const next = Number(e.target.value);
              setWavelengthNm(next);
              restart({ wavelengthNm: next, separationMm, whichPath });
            }}
          />
        </label>
        <label className={styles.control} htmlFor="ds-separation">
          <span className={styles.controlLabel}>
            Slit separation <span className={styles.controlValue}>{separationMm.toFixed(2)} mm</span>
          </span>
          <input
            id="ds-separation"
            className={styles.slider}
            type="range"
            min={0.1}
            max={0.5}
            step={0.01}
            value={separationMm}
            onChange={(e) => {
              const next = Number(e.target.value);
              setSeparationMm(next);
              restart({ wavelengthNm, separationMm: next, whichPath });
            }}
          />
        </label>
      </div>
    </figure>
  );
}
