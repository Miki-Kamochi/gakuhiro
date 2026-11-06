"use client";

import { useState } from "react";
import styles from "./styles";
import { LIGHT_SPEED, deBroglieWavelength, formatLength, formatSci } from "./physics";

type Thing = { id: string; name: string; inSentence: string; massKg: number; speed: number; note: string };

const THINGS: Thing[] = [
  { id: "electron", name: "Electron", inSentence: "an electron", massKg: 9.109e-31, speed: 1.0e6, note: "moving at 1,000 km per second" },
  { id: "proton", name: "Proton", inSentence: "a proton", massKg: 1.673e-27, speed: 2.0e3, note: "at room-temperature speed" },
  { id: "helium", name: "Helium atom", inSentence: "a helium atom", massKg: 6.646e-27, speed: 1.3e3, note: "at room-temperature speed" },
  { id: "c60", name: "Buckyball (C₆₀)", inSentence: "a buckyball (C₆₀)", massKg: 1.196e-24, speed: 220, note: "at the speed used in the 1999 Vienna experiment" },
  { id: "dust", name: "Dust grain (1 µm)", inSentence: "a 1 µm dust grain", massKg: 1e-15, speed: 1e-3, note: "drifting at 1 mm per second" },
  { id: "baseball", name: "Baseball", inSentence: "a baseball", massKg: 0.145, speed: 40, note: "thrown as a fastball" },
];

// The speed slider is logarithmic: position 0 → 0.01 m/s, position 1000 → 10⁸ m/s (one third of c)
const MIN_EXP = -2;
const MAX_EXP = 8;
const toSpeed = (pos: number) => Math.pow(10, MIN_EXP + ((MAX_EXP - MIN_EXP) * pos) / 1000);
const toPos = (speed: number) => Math.round(((Math.log10(speed) - MIN_EXP) / (MAX_EXP - MIN_EXP)) * 1000);

// Length scale for the comparison bar: 10⁻⁴⁰ m … 1 m
const SCALE_MIN_EXP = -40;
const SCALE_MAX_EXP = 0;
const scalePercent = (metres: number) => {
  const exp = Math.log10(metres);
  const clamped = Math.min(SCALE_MAX_EXP, Math.max(SCALE_MIN_EXP, exp));
  return ((clamped - SCALE_MIN_EXP) / (SCALE_MAX_EXP - SCALE_MIN_EXP)) * 100;
};

const LANDMARKS: { label: string; size: string; metres: number }[] = [
  { label: "Planck length", size: "10⁻³⁵ m", metres: 1.6e-35 },
  { label: "Nucleus", size: "10⁻¹⁵ m", metres: 1e-15 },
  { label: "Atom", size: "10⁻¹⁰ m", metres: 1e-10 },
  { label: "Light", size: "5 × 10⁻⁷ m", metres: 5e-7 },
];

const ATOM = 1e-10;
const NUCLEUS = 1e-15;

function comparison(lambda: number): string {
  if (lambda > 10 * ATOM) {
    return `About ${formatSci(lambda / ATOM, 2)} times wider than an atom. Wave effects are large and easy to see.`;
  }
  if (lambda >= 0.1 * ATOM) {
    return "About the size of an atom. The rows of atoms in a crystal act as a diffraction grating for this wave.";
  }
  if (lambda >= NUCLEUS) {
    return `About ${formatSci(ATOM / lambda, 2)} times smaller than an atom. Seeing it takes a very fine grating and a careful experiment.`;
  }
  return `About ${formatSci(NUCLEUS / lambda, 2)} times smaller than an atomic nucleus. Far too small to show up in any interference experiment so far.`;
}

export default function DeBroglieCalculator() {
  const [thingId, setThingId] = useState("electron");
  const [speed, setSpeed] = useState(THINGS[0].speed);

  const thing = THINGS.find((t) => t.id === thingId) ?? THINGS[0];
  const lambda = deBroglieWavelength(thing.massKg, speed);
  const fractionOfC = speed / LIGHT_SPEED;
  const relativistic = fractionOfC > 0.01;
  const markerPercent = scalePercent(lambda);
  const offScale = Math.log10(lambda) < SCALE_MIN_EXP;

  return (
    <figure className={`${styles.lab} ${styles.wide}`} aria-labelledby="debroglie-title">
      <div className={styles.labHead}>
        <h3 className={styles.labTitle} id="debroglie-title">
          Lab 2 · How big is a matter wave?
        </h3>
        <p className={styles.labNote}>λ = h / p, with relativistic momentum</p>
      </div>

      <div className={styles.controls}>
        <label className={styles.control} htmlFor="db-object">
          <span className={styles.controlLabel}>Object</span>
          <select
            id="db-object"
            className={styles.select}
            value={thingId}
            onChange={(e) => {
              const next = THINGS.find((t) => t.id === e.target.value) ?? THINGS[0];
              setThingId(next.id);
              setSpeed(next.speed);
            }}
          >
            {THINGS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.control} htmlFor="db-speed">
          <span className={styles.controlLabel}>
            Speed <span className={styles.controlValue}>{formatSci(speed)} m/s</span>
          </span>
          <input
            id="db-speed"
            className={styles.slider}
            type="range"
            min={0}
            max={1000}
            step={1}
            value={toPos(speed)}
            aria-valuetext={`${formatSci(speed)} metres per second`}
            onChange={(e) => setSpeed(toSpeed(Number(e.target.value)))}
          />
        </label>
      </div>

      <div className={styles.result} aria-live="polite">
        <span className={styles.resultLabel}>
          de Broglie wavelength of {thing.inSentence}
          {speed === thing.speed ? ` ${thing.note}` : ""}
        </span>
        <span className={styles.resultValue}>λ = {formatLength(lambda)}</span>
        <span className={styles.resultNote}>
          {comparison(lambda)}
          {relativistic ? ` At ${(fractionOfC * 100).toFixed(1)}% of light speed, relativity raises the momentum a little.` : ""}
        </span>
      </div>

      <div className={styles.scaleWrap}>
        <div className={styles.scale} role="img" aria-label={`λ on a scale from 10⁻⁴⁰ m to 1 m: ${formatLength(lambda)}`}>
          <div className={styles.scaleBar} />
          {LANDMARKS.map((m) => (
            <div key={m.label}>
              <div className={styles.scaleTick} style={{ left: `${scalePercent(m.metres)}%` }} />
              <div className={styles.scaleTickLabel} style={{ left: `${scalePercent(m.metres)}%` }}>
                {m.label}
                <br />
                {m.size}
              </div>
            </div>
          ))}
          <div className={styles.scaleMarker} style={{ left: `${markerPercent}%` }}>
            <span className={styles.scaleMarkerLabel}>{offScale ? "◀ λ off scale" : "λ"}</span>
            <span className={styles.scaleMarkerPin} />
          </div>
        </div>
      </div>
    </figure>
  );
}
