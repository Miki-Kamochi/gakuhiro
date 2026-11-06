// Shared constants and formatting helpers for the quantum lessons.
// Everything here is pure and deterministic, so it renders the same on the server and in the browser.

export const PLANCK = 6.62607015e-34; // J·s (exact, SI 2019)
export const LIGHT_SPEED = 2.99792458e8; // m/s (exact)

const SUPERSCRIPT: Record<string, string> = {
  "-": "⁻",
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
};

export function superscript(n: number): string {
  return String(n)
    .split("")
    .map((ch) => SUPERSCRIPT[ch] ?? ch)
    .join("");
}

/** 7.27e-10 -> "7.27 × 10⁻¹⁰". Numbers between 0.01 and 10 000 are written plainly. */
export function formatSci(value: number, sigFigs = 3): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 0.01 && abs < 1e4) {
    return Number(value.toPrecision(sigFigs)).toString();
  }
  const [mantissa, exp] = value.toExponential(sigFigs - 1).split("e");
  return `${mantissa} × 10${superscript(Number(exp))}`;
}

const LENGTH_UNITS: { unit: string; scale: number }[] = [
  { unit: "m", scale: 1 },
  { unit: "mm", scale: 1e-3 },
  { unit: "µm", scale: 1e-6 },
  { unit: "nm", scale: 1e-9 },
  { unit: "pm", scale: 1e-12 },
  { unit: "fm", scale: 1e-15 },
];

/** Picks a readable unit for a length in metres; falls back to scientific notation in metres. */
export function formatLength(metres: number): string {
  if (!Number.isFinite(metres) || metres <= 0) return "—";
  if (metres >= 1e-15 && metres < 1e3) {
    // Largest unit that keeps the number at 0.1 or more, so 7.27e-10 m reads "0.727 nm"
    const choice = LENGTH_UNITS.find(({ scale }) => metres >= 0.1 * scale) ?? LENGTH_UNITS[LENGTH_UNITS.length - 1];
    const scaled = metres / choice.scale;
    return `${Number(scaled.toPrecision(3))} ${choice.unit}`;
  }
  return `${formatSci(metres)} m`;
}

/** Relativistic de Broglie wavelength λ = h / (γ m v). */
export function deBroglieWavelength(massKg: number, speed: number): number {
  const beta = speed / LIGHT_SPEED;
  const gamma = 1 / Math.sqrt(1 - beta * beta);
  return PLANCK / (gamma * massKg * speed);
}

/** Approximate sRGB colour of visible light (380–780 nm), after Dan Bruton's algorithm. */
export function wavelengthToRgb(nm: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  if (nm >= 380 && nm < 440) {
    r = -(nm - 440) / (440 - 380);
    b = 1;
  } else if (nm >= 440 && nm < 490) {
    g = (nm - 440) / (490 - 440);
    b = 1;
  } else if (nm >= 490 && nm < 510) {
    g = 1;
    b = -(nm - 510) / (510 - 490);
  } else if (nm >= 510 && nm < 580) {
    r = (nm - 510) / (580 - 510);
    g = 1;
  } else if (nm >= 580 && nm < 645) {
    r = 1;
    g = -(nm - 645) / (645 - 580);
  } else if (nm >= 645 && nm <= 780) {
    r = 1;
  }
  // Brightness falls off near the edges of human vision
  let factor = 1;
  if (nm >= 380 && nm < 420) factor = 0.3 + (0.7 * (nm - 380)) / (420 - 380);
  else if (nm > 700 && nm <= 780) factor = 0.3 + (0.7 * (780 - nm)) / (780 - 700);
  const gammaCorrect = (c: number) => Math.round(255 * Math.pow(c * factor, 0.8));
  return [gammaCorrect(r), gammaCorrect(g), gammaCorrect(b)];
}

/**
 * Relative intensity on a screen a distance L from two slits (Fraunhofer, small angles).
 * x, slitSep, slitWidth and screenDist share one length unit; wavelength in the same unit.
 * With `whichPath`, the two paths no longer interfere and only the single-slit envelope remains.
 */
export function doubleSlitIntensity(
  x: number,
  wavelength: number,
  slitSep: number,
  slitWidth: number,
  screenDist: number,
  whichPath: boolean,
): number {
  const beta = (Math.PI * slitWidth * x) / (wavelength * screenDist);
  const envelope = beta === 0 ? 1 : (Math.sin(beta) / beta) ** 2;
  if (whichPath) return envelope;
  const phase = (Math.PI * slitSep * x) / (wavelength * screenDist);
  return Math.cos(phase) ** 2 * envelope;
}
