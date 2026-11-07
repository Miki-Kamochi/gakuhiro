import type { Part } from "./blueprint";
import { worldBox } from "./geometry-check";

/**
 * The AI says *where a part goes relative to another part* ("on the base,
 * flush with its front edge", "inside the cup"); this file turns that into
 * exact centre coordinates. Language models are bad at chained arithmetic like
 * "y = top of the part below + half my height", so we do it here instead.
 *
 * Axes: Y is up, +Z is the front, +X is the right. Units are cm.
 */

type V = { x: number; y: number; z: number };

export const ORIENTATIONS = ["upright", "upside_down", "lying_x", "lying_z"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

export const PLACE_MODES = ["ground", "on", "inside", "beside", "under"] as const;
export const ALIGNS = ["center", "front", "back", "left", "right"] as const;

export type Place = {
  mode: (typeof PLACE_MODES)[number];
  ref: string;
  align: (typeof ALIGNS)[number];
  offset: V;
};

/** A part as the AI writes it: no coordinates, just orientation and placement. */
export type PlacedPart = Omit<Part, "position" | "rotation"> & {
  orientation: Orientation;
  tilt_deg: number;
  place: Place;
};

const ZERO: V = { x: 0, y: 0, z: 0 };

/** Euler rotation (degrees, XYZ) for an orientation plus a backwards lean. */
export function rotationFor(orientation: Orientation, tilt = 0): V {
  // Positive tilt leans the top backwards (towards -Z), like the back of a phone stand.
  const lean = -(Number.isFinite(tilt) ? Math.max(-80, Math.min(80, tilt)) : 0);
  switch (orientation) {
    case "upside_down":
      return { x: 180 + lean, y: 0, z: 0 };
    case "lying_x":
      return { x: lean, y: 0, z: 90 };
    case "lying_z":
      return { x: 90 + lean, y: 0, z: 0 };
    default:
      return { x: lean, y: 0, z: 0 };
  }
}

/** Wall and floor thickness of open containers, matching components/viewer/geometry.ts. */
function wallOf(p: Part): number {
  if (p.shape === "cup" || p.shape === "tube") {
    const d = p.size.x;
    const w = p.size.z;
    const v = Number.isFinite(w) && w > 0 ? w : Math.max(0.15, d * 0.03);
    return Math.min(Math.max(v, 0.08), d / 4);
  }
  if (p.shape === "tray") return Math.min(0.5, Math.max(0.1, Math.min(p.size.x, p.size.z) * 0.06));
  return 0;
}

type Box = ReturnType<typeof worldBox>;

/** The space inside a container that contents can occupy. Solid parts: the part itself. */
function innerBox(ref: Part, box: Box): Box {
  const t = wallOf(ref);
  if (!t) return box;
  const upright = Math.abs(ref.rotation.x) < 1 && Math.abs(ref.rotation.z) < 1;
  const floor = upright && ref.shape !== "tube" ? t : 0;
  return {
    min: { x: box.min.x + t, y: box.min.y + floor, z: box.min.z + t },
    max: { x: box.max.x - t, y: box.max.y, z: box.max.z - t },
  };
}

const ROUND = new Set(["cylinder", "cone", "cup", "tube", "sphere", "torus"]);

/** Contents (soil, water, pens) must fit inside their container: shrink their footprint if needed. */
function fitInside(p: Part, inner: Box): Part {
  if (Math.abs(p.rotation.x) > 1 || Math.abs(p.rotation.z) > 1) return p;
  const w = Math.max(inner.max.x - inner.min.x, 0.1);
  const d = Math.max(inner.max.z - inner.min.z, 0.1);
  if (ROUND.has(p.shape)) {
    const max = Math.min(w, d);
    if (p.size.x <= max) return p;
    return { ...p, size: { ...p.size, x: max, z: p.shape === "cup" || p.shape === "tube" ? p.size.z : max } };
  }
  if (p.size.x <= w && p.size.z <= d) return p;
  return { ...p, size: { ...p.size, x: Math.min(p.size.x, w), z: Math.min(p.size.z, d) } };
}

const centre = (b: Box, k: "x" | "z") => (b.min[k] + b.max[k]) / 2;

/** Horizontal position that centres the part on `area`, or makes it flush with one edge. */
function alignIn(area: Box, local: Box, align: Place["align"]): { x: number; z: number } {
  switch (align) {
    case "front":
      return { x: centre(area, "x"), z: area.max.z - local.max.z };
    case "back":
      return { x: centre(area, "x"), z: area.min.z - local.min.z };
    case "left":
      return { x: area.min.x - local.min.x, z: centre(area, "z") };
    case "right":
      return { x: area.max.x - local.max.x, z: centre(area, "z") };
    default:
      return { x: centre(area, "x"), z: centre(area, "z") };
  }
}

/** Horizontal position just outside one side of `ref`, touching it. */
function alignBeside(ref: Box, local: Box, side: Place["align"]): { x: number; z: number } {
  switch (side) {
    case "back":
      return { x: centre(ref, "x"), z: ref.min.z - local.max.z };
    case "left":
      return { x: ref.min.x - local.max.x, z: centre(ref, "z") };
    case "right":
      return { x: ref.max.x - local.min.x, z: centre(ref, "z") };
    default: // front, center
      return { x: centre(ref, "x"), z: ref.max.z - local.min.z };
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Turn placed parts into parts with absolute positions and rotations.
 * Parts may refer to any other part; unknown refs and cycles fall back to the ground.
 * With `partial`, parts whose ref hasn't arrived yet (while streaming) are left out
 * instead, so nothing jumps when the ref shows up.
 */
export function resolveParts(input: PlacedPart[], { partial = false } = {}): Part[] {
  const byId = new Map(input.map((p) => [p.id, p]));
  const done = new Map<string, Part | null>();
  const visiting = new Set<string>();

  const resolve = (p: PlacedPart): Part | null => {
    if (done.has(p.id)) return done.get(p.id)!;
    visiting.add(p.id);

    const { orientation, tilt_deg, place, ...rest } = p;
    let part: Part = { ...rest, rotation: rotationFor(orientation, tilt_deg), position: ZERO };
    const offset = { x: num(place?.offset?.x), y: num(place?.offset?.y), z: num(place?.offset?.z) };
    const mode = place?.mode ?? "ground";
    const align = place?.align ?? "center";

    let refPart: Part | null = null;
    if (mode !== "ground") {
      const ref = place.ref ? byId.get(place.ref) : undefined;
      if (ref && ref.id !== p.id && !visiting.has(ref.id)) refPart = resolve(ref);
      if (!refPart && partial && place.ref) {
        visiting.delete(p.id);
        done.set(p.id, null);
        return null;
      }
    }

    let pos: V;
    if (!refPart) {
      const local = worldBox(part);
      pos = { x: offset.x, y: -local.min.y + offset.y, z: offset.z };
    } else {
      const R = worldBox(refPart);
      if (mode === "inside") {
        const inner = innerBox(refPart, R);
        part = fitInside(part, inner);
        const local = worldBox(part);
        const h = alignIn(inner, local, align);
        pos = { x: h.x + offset.x, y: inner.min.y - local.min.y + offset.y, z: h.z + offset.z };
      } else {
        const local = worldBox(part);
        if (mode === "beside") {
          const h = alignBeside(R, local, align);
          pos = { x: h.x + offset.x, y: R.min.y - local.min.y + offset.y, z: h.z + offset.z };
        } else if (mode === "under") {
          const h = alignIn(R, local, align);
          pos = { x: h.x + offset.x, y: R.min.y - local.max.y + offset.y, z: h.z + offset.z };
        } else {
          const h = alignIn(R, local, align);
          pos = { x: h.x + offset.x, y: R.max.y - local.min.y + offset.y, z: h.z + offset.z };
        }
      }
    }

    const round = (v: number) => Math.round(v * 100) / 100;
    const out: Part = { ...part, position: { x: round(pos.x), y: round(pos.y), z: round(pos.z) } };
    visiting.delete(p.id);
    done.set(p.id, out);
    return out;
  };

  return input.flatMap((p) => {
    const r = resolve(p);
    return r ? [r] : [];
  });
}
