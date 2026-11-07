import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Part } from "@/lib/blueprint";

export const DEG = Math.PI / 180;

/** Chunky Tinkercad-like primitives. Sizes are in cm, matching `Part.size`. */
export function geometryFor(part: Part): THREE.BufferGeometry {
  const x = Math.max(part.size.x, 0.05);
  const y = Math.max(part.size.y, 0.05);
  const z = Math.max(part.size.z, 0.05);
  switch (part.shape) {
    case "box":
      return new THREE.BoxGeometry(x, y, z);
    case "cylinder":
      return new THREE.CylinderGeometry(x / 2, x / 2, y, 48);
    case "cone":
      return new THREE.ConeGeometry(x / 2, y, 48);
    case "sphere":
      return new THREE.SphereGeometry(x / 2, 40, 24);
    case "torus": {
      const tube = Math.max(y / 2, 0.1);
      return new THREE.TorusGeometry(Math.max(x / 2 - tube, tube), tube, 16, 64);
    }
    case "cup":
      return hollowCylinder(x, y, wall(x, part.size.z), true);
    case "tube":
      return hollowCylinder(x, y, wall(x, part.size.z), false);
    case "tray":
      return openBox(x, y, z, Math.min(0.5, Math.max(0.1, Math.min(x, z) * 0.06)));
    default:
      return new THREE.BoxGeometry(x, y, z);
  }
}

/** Wall thickness for cups/tubes: the AI's value if sensible, else a thin default. */
function wall(diameter: number, w: number): number {
  const fallback = Math.max(0.15, diameter * 0.03);
  const v = Number.isFinite(w) && w > 0 ? w : fallback;
  return Math.min(Math.max(v, 0.08), diameter / 4);
}

/** Open-topped (cup) or open-ended (tube) cylinder, centred like CylinderGeometry. */
function hollowCylinder(d: number, h: number, t: number, bottom: boolean): THREE.BufferGeometry {
  const r = d / 2;
  const ri = r - t;
  const y0 = -h / 2;
  const y1 = h / 2;
  // Profile walked outside-up, over the rim, inside-down (and across the floor for a cup).
  const pts = bottom
    ? [[0, y0], [r, y0], [r, y1], [ri, y1], [ri, y0 + t], [0, y0 + t]]
    : [[ri, y0], [r, y0], [r, y1], [ri, y1], [ri, y0]];
  const g = new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), 48);
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

/** Box with no lid: floor plus four walls, merged into one geometry. */
function openBox(w: number, h: number, d: number, t: number): THREE.BufferGeometry {
  const pieces: [number, number, number, number, number, number][] = [
    [w, t, d, 0, -h / 2 + t / 2, 0], // floor
    [w, h, t, 0, 0, d / 2 - t / 2], // front
    [w, h, t, 0, 0, -d / 2 + t / 2], // back
    [t, h, d - 2 * t, -w / 2 + t / 2, 0, 0], // left
    [t, h, d - 2 * t, w / 2 - t / 2, 0, 0], // right
  ];
  const geos = pieces.map(([a, b, c, px, py, pz]) => new THREE.BoxGeometry(a, b, c).translate(px, py, pz));
  const merged = mergeGeometries(geos, false) ?? new THREE.BoxGeometry(w, h, d);
  geos.forEach((g) => g.dispose());
  merged.computeBoundingBox();
  return merged;
}

/** 13 → "13", 0.45 → "0.5", 12.25 → "12.3". */
export function cm(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Short size text for a floating label, e.g. "13 × 14 × 0.5 cm" or "直径10 × 高さ13 cm". */
export function sizeText(part: Part): string {
  const { x, y, z } = part.size;
  switch (part.shape) {
    case "box":
    case "tray":
      return `${cm(x)} × ${cm(y)} × ${cm(z)} cm`;
    case "cylinder":
    case "cone":
    case "cup":
    case "tube":
      return `直径${cm(x)} × 高さ${cm(y)} cm`;
    case "sphere":
      return `直径${cm(x)} cm`;
    case "torus":
      return `外径${cm(x)} ・ 太さ${cm(y)} cm`;
    default:
      return `${cm(x)} × ${cm(y)} × ${cm(z)} cm`;
  }
}

export type DimAxis = "x" | "y" | "z";
export type DimSpec = { axis: DimAxis; label: string };

/** Which measurements to call out for the selected part (in the part's local frame). */
export function dimSpecs(part: Part): DimSpec[] {
  switch (part.shape) {
    case "box":
    case "tray":
      return [
        { axis: "x", label: "幅" },
        { axis: "y", label: "高さ" },
        { axis: "z", label: "奥行き" },
      ];
    case "cylinder":
    case "cone":
    case "cup":
    case "tube":
      return [
        { axis: "x", label: "直径" },
        { axis: "y", label: "高さ" },
      ];
    case "sphere":
      return [{ axis: "x", label: "直径" }];
    case "torus":
      return [
        { axis: "x", label: "外径" },
        { axis: "z", label: "太さ" },
      ];
    default:
      return [];
  }
}

const finite = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Guard against half-baked AI output (NaN / missing numbers) so one bad part can't break the camera. */
export function sanitize(p: Part): Part {
  const s = p.size ?? { x: 1, y: 1, z: 1 };
  const q = p.position ?? { x: 0, y: 0, z: 0 };
  const r = p.rotation ?? { x: 0, y: 0, z: 0 };
  const ok =
    [s.x, s.y, s.z, q.x, q.y, q.z, r.x, r.y, r.z, p.step].every((v) => typeof v === "number" && Number.isFinite(v)) &&
    typeof p.color === "string";
  if (ok) return p;
  return {
    ...p,
    size: { x: finite(s.x, 1), y: finite(s.y, finite(s.x, 1)), z: finite(s.z, finite(s.x, 1)) },
    position: { x: finite(q.x, 0), y: finite(q.y, 0), z: finite(q.z, 0) },
    rotation: { x: finite(r.x, 0), y: finite(r.y, 0), z: finite(r.z, 0) },
    step: Math.round(finite(p.step, 1)),
    color: typeof p.color === "string" ? p.color : "#cccccc",
    name: p.name ?? "",
  };
}

/** Everything that changes the mesh. Parts with the same id and signature are reused as-is. */
export function signature(p: Part): string {
  const { size: s, position: q, rotation: r } = p;
  return `${p.shape}|${s.x},${s.y},${s.z}|${q.x},${q.y},${q.z}|${r.x},${r.y},${r.z}|${p.color}|${p.step}|${p.name}`;
}

const ROUND = new Set(["cylinder", "cone", "sphere", "torus", "cup", "tube"]);
export const isRound = (p: Part) => ROUND.has(p.shape);
