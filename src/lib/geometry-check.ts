import type { Part } from "./blueprint";

/**
 * Geometry checks for AI-generated models. Everything works on world-space
 * axis-aligned bounding boxes (rotation applied), which is exact for the
 * 90°-rotated panels most builds use and conservative otherwise.
 */

type V = { x: number; y: number; z: number };
type Box = { min: V; max: V };

const DEG = Math.PI / 180;
/** Gaps this small count as touching (glue, tape, rounding). */
const TOUCH = 0.25;

const CONTAINERS = new Set(["cup", "tube", "tray"]);

/** Half extents in the part's local frame, matching the viewer's geometry. */
function halfExtents(p: Part): V {
  const { x, y, z } = p.size;
  switch (p.shape) {
    case "cylinder":
    case "cone":
    case "cup":
    case "tube":
      return { x: x / 2, y: y / 2, z: x / 2 };
    case "sphere":
      return { x: x / 2, y: x / 2, z: x / 2 };
    case "torus":
      // Three's torus lies in the local XY plane; y is the tube thickness.
      return { x: x / 2, y: x / 2, z: y / 2 };
    default:
      return { x: x / 2, y: y / 2, z: z / 2 };
  }
}

/** Rotate by an Euler angle in degrees, order 'XYZ' — the same matrix as THREE.Matrix4.makeRotationFromEuler. */
function rotate(v: V, r: V): V {
  const [a, b, c] = [r.x * DEG, r.y * DEG, r.z * DEG];
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  // Matrix for Euler order 'XYZ' (as THREE.Matrix4.makeRotationFromEuler).
  const m = [
    [cb * cc, -cb * sc, sb],
    [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
    [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb],
  ];
  return {
    x: m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
    y: m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
    z: m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z,
  };
}

export function worldBox(p: Part): Box {
  const h = halfExtents(p);
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const c = rotate({ x: sx * h.x, y: sy * h.y, z: sz * h.z }, p.rotation);
        for (const k of ["x", "y", "z"] as const) {
          min[k] = Math.min(min[k], p.position[k] + c[k]);
          max[k] = Math.max(max[k], p.position[k] + c[k]);
        }
      }
  return { min, max };
}

const AXES = ["x", "y", "z"] as const;
const overlap1 = (a: Box, b: Box, k: "x" | "y" | "z") => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]);
const volume = (b: Box) => AXES.reduce((v, k) => v * Math.max(b.max[k] - b.min[k], 0.01), 1);
const inside = (inner: Box, outer: Box, tol = 0.3) =>
  AXES.every((k) => inner.min[k] >= outer.min[k] - tol && inner.max[k] <= outer.max[k] + tol);
const touches = (a: Box, b: Box) => AXES.every((k) => overlap1(a, b, k) >= -TOUCH);

export type Issue = { kind: "overlap" | "floating" | "duplicate"; ids: string[]; text: string };

/** Find visible problems: parts pushed through each other, parts hanging in the air, doubles. */
export function findIssues(parts: Part[]): Issue[] {
  const boxes = parts.map(worldBox);
  const issues: Issue[] = [];

  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      const depth = AXES.map((k) => overlap1(a, b, k));
      if (depth.some((d) => d <= 0.3)) continue;

      const [p, q] = [parts[i], parts[j]];
      const same =
        AXES.every((k) => Math.abs(p.position[k] - q.position[k]) < 0.3) &&
        AXES.every((k) => Math.abs(p.size[k] - q.size[k]) < 0.3);
      if (same) {
        issues.push({ kind: "duplicate", ids: [p.id, q.id], text: `「${p.name}」と「${q.name}」が同じ位置に重なっています。` });
        continue;
      }

      // A part entirely inside another (soil in a cup, a wick in a tank) is a deliberate
      // placement; the visible problem is parts poking through each other's walls.
      if (inside(b, a, CONTAINERS.has(p.shape) ? 0.3 : 0.05) || inside(a, b, CONTAINERS.has(q.shape) ? 0.3 : 0.05)) continue;

      const ov = depth.reduce((v, d) => v * d, 1);
      const smaller = Math.min(volume(a), volume(b));
      if (ov < smaller * 0.2) continue; // small overlaps at joints read as glued
      const axis = AXES[depth.indexOf(Math.min(...depth))];
      issues.push({
        kind: "overlap",
        ids: [p.id, q.id],
        text: `「${p.name}」と「${q.name}」が${axis}方向に${Math.min(...depth).toFixed(1)}cmめり込んでいます（小さい方の部品の${Math.round((ov / smaller) * 100)}%）。`,
      });
    }
  }

  parts.forEach((p, i) => {
    const b = boxes[i];
    if (b.min.y <= TOUCH) return;
    if (boxes.some((o, j) => j !== i && touches(b, o))) return;
    issues.push({ kind: "floating", ids: [p.id], text: `「${p.name}」がどの部品にも接しておらず、宙に浮いています（下端 y=${b.min.y.toFixed(1)}cm）。` });
  });

  return issues;
}

/**
 * Deterministic clean-up that's always safe:
 * - floating parts drop straight down onto whatever is under them (or the ground);
 * - the whole model sits on y = 0 and is centred over the origin.
 */
export function settle(parts: Part[]): Part[] {
  const out = parts.map((p) => ({ ...p, position: { ...p.position } }));

  // Lowest first, so parts resting on dropped parts follow them down.
  const order = out.map((_, i) => i).sort((i, j) => worldBox(out[i]).min.y - worldBox(out[j]).min.y);
  for (let pass = 0; pass < 2; pass++) {
    for (const i of order) {
      const b = worldBox(out[i]);
      if (b.min.y <= TOUCH) continue;
      if (out.some((o, j) => j !== i && touches(b, worldBox(o)))) continue;
      // Highest top below this part whose footprint overlaps it.
      let floor = 0;
      out.forEach((o, j) => {
        if (j === i) return;
        const ob = worldBox(o);
        if (overlap1(b, ob, "x") > 0 && overlap1(b, ob, "z") > 0 && ob.max.y <= b.min.y + 0.01) floor = Math.max(floor, ob.max.y);
      });
      out[i].position.y -= b.min.y - floor;
    }
  }

  if (out.length === 0) return out;
  const all = out.map(worldBox);
  const minY = Math.min(...all.map((b) => b.min.y));
  const cx = (Math.min(...all.map((b) => b.min.x)) + Math.max(...all.map((b) => b.max.x))) / 2;
  const cz = (Math.min(...all.map((b) => b.min.z)) + Math.max(...all.map((b) => b.max.z))) / 2;
  const round = (v: number) => Math.round(v * 100) / 100;
  for (const p of out) {
    p.position.x = round(p.position.x - cx);
    p.position.y = round(p.position.y - minY);
    p.position.z = round(p.position.z - cz);
  }
  return out;
}
