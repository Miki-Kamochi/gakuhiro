"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Two little yokai craftsmen pop in from the sides of the screen when the shop
 * "breaks", to offer to build the thing instead of selling it:
 *
 * - ネジまる (left): a one-eyed (一つ目) yokai in a yellow hard hat and denim
 *   overalls, with a screwdriver in its tool belt. It twirls a big wrench and
 *   then shows it off with a ratcheting wiggle and a sparkle.
 * - トン吉 (right): a little horned 鬼 in a 豆絞り ねじり鉢巻 and a navy 腹掛け
 *   apron. It lands, winks and goes "トントン" with its hammer.
 *
 * Built from three.js primitives with toon shading and inverted-hull outlines,
 * drawn on one fixed, transparent, click-through canvas.
 *
 * - "pop":  they bounce in from the left and right edges and shout.
 * - "peek": they settle into the bottom corners (used on the reveal screen).
 * - "hidden": nothing is drawn and the render loop is stopped.
 */
export type YokaiStage = "hidden" | "pop" | "peek";

const INK = "#33243d";
const FOV = 30;
const CAM_Z = 12;

/** Speech bubble lines per character: [left, right]. Each line pops in at `at` seconds. */
const LINES: { at: number; text: string }[][] = [
  [
    { at: 0.32, text: "まって〜！" },
    { at: 1.3, text: "材料はゴミでOK！" },
  ],
  [{ at: 0.55, text: "それ、ぼくらが作るよ！" }],
];

const JP_FONT = `"Zen Maru Gothic", "Hiragino Maru Gothic ProN", "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif`;

/* ---------- small math helpers ---------- */

const TAU = Math.PI * 2;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const easeOutBack = (x: number) => {
  const c = 1.9;
  const t = clamp01(x) - 1;
  return 1 + (c + 1) * t * t * t + c * t * t;
};
const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOut = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
/** Damped spring from 0 to 1 that overshoots once or twice. */
const spring = (u: number) => (u <= 0 ? 0 : 1 - Math.exp(-6.5 * u) * Math.cos(10.5 * u));

/**
 * Hammer height over one "トントン" cycle (1 = raised, 0 = striking).
 * Two quick taps at HITS[0] and HITS[1], then it winds back up and rests.
 */
const HITS = [0.12, 0.42] as const;
const hammerLift = (tau: number) => {
  if (tau < HITS[0]) return 1 - Math.pow(tau / HITS[0], 2);
  if (tau < 0.3) return 0.55 * easeOutCubic((tau - HITS[0]) / (0.3 - HITS[0]));
  if (tau < HITS[1]) return 0.55 * (1 - Math.pow((tau - 0.3) / (HITS[1] - 0.3), 2));
  if (tau < 0.5) return 0;
  return easeInOut((tau - 0.5) / 0.38);
};
/** Seconds since the most recent tap in the cycle (large when none yet). */
const sinceHit = (tau: number) => (tau >= HITS[1] ? tau - HITS[1] : tau >= HITS[0] ? tau - HITS[0] : 9);

/* ---------- canvas-drawn face parts and prints ---------- */

type Draw = (c: CanvasRenderingContext2D, w: number, h: number) => void;

function drawEye(iris: string): Draw {
  return (c, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const rx = w * 0.42;
    const ry = h * 0.44;
    c.fillStyle = "#1f1a33";
    c.beginPath();
    c.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    c.fill();
    // Iris glow from below.
    const g = c.createLinearGradient(0, cy - ry * 0.2, 0, cy + ry);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, iris);
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(cx, cy + ry * 0.08, rx * 0.84, ry * 0.84, 0, 0, TAU);
    c.fill();
    // Big and small highlights.
    c.fillStyle = "#ffffff";
    c.beginPath();
    c.ellipse(cx + rx * 0.3, cy - ry * 0.38, rx * 0.36, ry * 0.32, -0.4, 0, TAU);
    c.fill();
    c.beginPath();
    c.arc(cx - rx * 0.36, cy + ry * 0.42, rx * 0.16, 0, TAU);
    c.fill();
    // Tiny sparkle.
    c.beginPath();
    c.arc(cx + rx * 0.42, cy + ry * 0.3, rx * 0.08, 0, TAU);
    c.fill();
  };
}

/** Happy closed eye: a thick ^ arc. */
const drawClosedEye: Draw = (c, w, h) => {
  c.strokeStyle = "#1f1a33";
  c.lineWidth = w * 0.13;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(w * 0.14, h * 0.62);
  c.quadraticCurveTo(w * 0.5, h * 0.12, w * 0.86, h * 0.62);
  c.stroke();
};

const drawBlush: Draw = (c, w, h) => {
  const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, "rgba(255,120,150,0.85)");
  g.addColorStop(0.6, "rgba(255,130,160,0.45)");
  g.addColorStop(1, "rgba(255,140,170,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = "rgba(230,70,110,0.75)";
  c.lineWidth = w * 0.045;
  c.lineCap = "round";
  for (let i = -1; i <= 1; i++) {
    const x = w / 2 + i * w * 0.17;
    c.beginPath();
    c.moveTo(x + w * 0.05, h * 0.36);
    c.lineTo(x - w * 0.05, h * 0.64);
    c.stroke();
  }
};

/** Round "o" mouth, shouting まって〜！ */
const drawShoutMouth: Draw = (c, w, h) => {
  c.fillStyle = "#5a1f2e";
  c.strokeStyle = "#1f1a33";
  c.lineWidth = w * 0.06;
  c.beginPath();
  c.ellipse(w / 2, h / 2, w * 0.3, h * 0.36, 0, 0, TAU);
  c.fill();
  c.save();
  c.clip();
  c.fillStyle = "#ff8fa3";
  c.beginPath();
  c.ellipse(w / 2, h * 0.84, w * 0.24, h * 0.2, 0, 0, TAU);
  c.fill();
  c.restore();
  c.beginPath();
  c.ellipse(w / 2, h / 2, w * 0.3, h * 0.36, 0, 0, TAU);
  c.stroke();
};

/** Wide grin with one little 八重歯 fang. */
const drawFangGrin: Draw = (c, w, h) => {
  const path = () => {
    c.beginPath();
    c.moveTo(w * 0.1, h * 0.22);
    c.quadraticCurveTo(w * 0.5, h * 0.3, w * 0.9, h * 0.22);
    c.quadraticCurveTo(w * 0.86, h * 0.86, w * 0.5, h * 0.86);
    c.quadraticCurveTo(w * 0.14, h * 0.86, w * 0.1, h * 0.22);
    c.closePath();
  };
  c.fillStyle = "#5a1f2e";
  path();
  c.fill();
  c.save();
  path();
  c.clip();
  c.fillStyle = "#ff8fa3";
  c.beginPath();
  c.ellipse(w * 0.5, h * 0.9, w * 0.26, h * 0.26, 0, 0, TAU);
  c.fill();
  // Fang.
  c.fillStyle = "#ffffff";
  c.beginPath();
  c.moveTo(w * 0.24, h * 0.2);
  c.lineTo(w * 0.42, h * 0.24);
  c.lineTo(w * 0.32, h * 0.5);
  c.closePath();
  c.fill();
  c.restore();
  c.strokeStyle = "#1f1a33";
  c.lineWidth = w * 0.05;
  c.lineJoin = "round";
  path();
  c.stroke();
};

/** 緑十字 sticker on the hard hat. */
const drawSafetyCross: Draw = (c, w, h) => {
  c.fillStyle = "#ffffff";
  c.strokeStyle = INK;
  c.lineWidth = w * 0.06;
  c.beginPath();
  c.arc(w / 2, h / 2, w * 0.42, 0, TAU);
  c.fill();
  c.stroke();
  c.fillStyle = "#1fa75a";
  const a = w * 0.12;
  const b = w * 0.3;
  c.beginPath();
  c.roundRect(w / 2 - a, h / 2 - b, a * 2, b * 2, a * 0.35);
  c.roundRect(w / 2 - b, h / 2 - a, b * 2, a * 2, a * 0.35);
  c.fill();
};

/** Denim overall bib with straps, a pocket and a pencil, wrapped onto the torso. */
const drawBib: Draw = (c, w, h) => {
  const denim = "#4a7fd6";
  const lw = w * 0.022;
  c.lineJoin = "round";
  c.lineCap = "round";
  // Straps from the bib up over the shoulders.
  c.strokeStyle = INK;
  c.lineWidth = w * 0.09 + lw * 2;
  c.beginPath();
  c.moveTo(w * 0.33, h * 0.4);
  c.lineTo(w * 0.17, -h * 0.05);
  c.moveTo(w * 0.67, h * 0.4);
  c.lineTo(w * 0.83, -h * 0.05);
  c.stroke();
  c.strokeStyle = denim;
  c.lineWidth = w * 0.09;
  c.stroke();
  // Bib.
  c.fillStyle = denim;
  c.strokeStyle = INK;
  c.lineWidth = lw;
  c.beginPath();
  c.roundRect(w * 0.29, h * 0.32, w * 0.42, h * 0.8, w * 0.04);
  c.fill();
  c.stroke();
  // Pencil peeking out of the pocket.
  c.save();
  c.translate(w * 0.43, h * 0.56);
  c.rotate(-0.25);
  c.fillStyle = "#ffcf3a";
  c.fillRect(-w * 0.02, -h * 0.2, w * 0.04, h * 0.2);
  c.fillStyle = "#f2c79a";
  c.beginPath();
  c.moveTo(-w * 0.02, -h * 0.2);
  c.lineTo(w * 0.02, -h * 0.2);
  c.lineTo(0, -h * 0.27);
  c.closePath();
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = lw * 0.6;
  c.strokeRect(-w * 0.02, -h * 0.2, w * 0.04, h * 0.2);
  c.restore();
  // Pocket with stitching.
  c.fillStyle = "#3f6fc0";
  c.strokeStyle = INK;
  c.lineWidth = lw * 0.8;
  c.beginPath();
  c.roundRect(w * 0.37, h * 0.52, w * 0.26, h * 0.26, w * 0.03);
  c.fill();
  c.stroke();
  c.strokeStyle = "#ffd98a";
  c.lineWidth = lw * 0.45;
  c.setLineDash([w * 0.018, w * 0.014]);
  c.beginPath();
  c.moveTo(w * 0.39, h * 0.58);
  c.lineTo(w * 0.61, h * 0.58);
  c.moveTo(w * 0.32, h * 0.36);
  c.lineTo(w * 0.32, h);
  c.moveTo(w * 0.68, h * 0.36);
  c.lineTo(w * 0.68, h);
  c.stroke();
  c.setLineDash([]);
  // Buttons where the straps meet the bib.
  for (const x of [0.345, 0.655]) {
    c.fillStyle = "#ffcf3a";
    c.strokeStyle = INK;
    c.lineWidth = lw * 0.7;
    c.beginPath();
    c.arc(w * x, h * 0.4, w * 0.035, 0, TAU);
    c.fill();
    c.stroke();
  }
};

/** Navy 腹掛け apron with a どんぶり pocket and a 化 crest. */
const drawApron: Draw = (c, w, h) => {
  const navy = "#2b4a8c";
  const lw = w * 0.022;
  c.lineJoin = "round";
  // Neck straps.
  c.strokeStyle = INK;
  c.lineWidth = w * 0.07 + lw * 2;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(w * 0.36, h * 0.12);
  c.lineTo(w * 0.3, -h * 0.05);
  c.moveTo(w * 0.64, h * 0.12);
  c.lineTo(w * 0.7, -h * 0.05);
  c.stroke();
  c.strokeStyle = navy;
  c.lineWidth = w * 0.07;
  c.stroke();
  // Apron body: narrow at the chest, wide over the belly.
  c.fillStyle = navy;
  c.strokeStyle = INK;
  c.lineWidth = lw;
  c.beginPath();
  c.moveTo(w * 0.33, h * 0.08);
  c.lineTo(w * 0.67, h * 0.08);
  c.quadraticCurveTo(w * 0.7, h * 0.3, w * 0.86, h * 0.36);
  c.lineTo(w * 0.86, h * 0.88);
  c.quadraticCurveTo(w * 0.86, h * 0.97, w * 0.76, h * 0.97);
  c.lineTo(w * 0.24, h * 0.97);
  c.quadraticCurveTo(w * 0.14, h * 0.97, w * 0.14, h * 0.88);
  c.lineTo(w * 0.14, h * 0.36);
  c.quadraticCurveTo(w * 0.3, h * 0.3, w * 0.33, h * 0.08);
  c.closePath();
  c.fill();
  c.stroke();
  // どんぶり pocket.
  c.strokeStyle = "#9fb6e6";
  c.lineWidth = lw * 0.5;
  c.setLineDash([w * 0.018, w * 0.014]);
  c.beginPath();
  c.moveTo(w * 0.18, h * 0.52);
  c.quadraticCurveTo(w * 0.5, h * 0.58, w * 0.82, h * 0.52);
  c.stroke();
  c.setLineDash([]);
  // Crest.
  const cx = w * 0.5;
  const cy = h * 0.4;
  const r = w * 0.115;
  c.fillStyle = "#ffffff";
  c.strokeStyle = "#e2483d";
  c.lineWidth = lw * 0.9;
  c.beginPath();
  c.arc(cx, cy, r, 0, TAU);
  c.fill();
  c.stroke();
  c.fillStyle = navy;
  c.font = `900 ${Math.round(r * 1.45)}px ${JP_FONT}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("化", cx, cy + r * 0.06);
};

/** 豆絞り: navy dots on white cotton, tiled around the headband. */
const drawMameshibori: Draw = (c, w, h) => {
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, w, h);
  c.fillStyle = "#2b4a8c";
  for (const [x, y] of [
    [0.25, 0.27],
    [0.75, 0.73],
  ]) {
    c.beginPath();
    c.arc(w * x, h * y, h * 0.17, 0, TAU);
    c.fill();
  }
  // A faint twist line.
  c.strokeStyle = "rgba(51,36,61,0.18)";
  c.lineWidth = h * 0.06;
  c.beginPath();
  c.moveTo(0, h);
  c.lineTo(w, 0);
  c.stroke();
};

/** 4-point sparkle (キラッ). */
const drawSparkle: Draw = (c, w, h) => {
  const cx = w / 2;
  const cy = h / 2;
  const star = (R: number, r: number) => {
    c.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU - Math.PI / 2;
      const rr = i % 2 ? r : R;
      c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    c.closePath();
  };
  c.lineJoin = "round";
  star(w * 0.46, w * 0.1);
  c.fillStyle = "#fff6a8";
  c.strokeStyle = INK;
  c.lineWidth = w * 0.05;
  c.stroke();
  c.fill();
  star(w * 0.26, w * 0.06);
  c.fillStyle = "#ffffff";
  c.fill();
};

/** Hammer impact burst (トン！). */
const drawBurst: Draw = (c, w, h) => {
  const cx = w / 2;
  const cy = h / 2;
  c.lineJoin = "round";
  c.beginPath();
  const n = 9;
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * TAU;
    const rr = i % 2 ? w * 0.22 : w * (i % 4 ? 0.4 : 0.46);
    c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  c.closePath();
  c.fillStyle = "#ffd23f";
  c.strokeStyle = INK;
  c.lineWidth = w * 0.045;
  c.stroke();
  c.fill();
  c.fillStyle = "#fff6c2";
  c.beginPath();
  c.arc(cx, cy, w * 0.14, 0, TAU);
  c.fill();
};

/* ---------- the scene ---------- */

type Rig = {
  kind: "wrench" | "hammer";
  root: THREE.Group;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  /** The tool, a child of the inner hand: rotates in the arm's plane. */
  tool: THREE.Object3D;
  /** Sparkle (wrench) or impact burst (hammer). */
  fx: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  wisp: THREE.Object3D;
  /** Blinks by squashing this texture vertically. */
  openEye: THREE.Texture;
  /** The eye that winks (texture swap), if any. */
  winkEye?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  closedEye: THREE.Texture;
  /** Where the speech bubble attaches, in the rig's local space. */
  head: THREE.Vector3;
};

type Pose = { x: number; y: number; s: number; rz: number; ry: number };

const HEAD_R = 0.68;
const HEAD_Y = 1.32;

function buildScene() {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  const texs = new Set<THREE.Texture>();
  const g = <T extends THREE.BufferGeometry>(geo: T) => (geos.add(geo), geo);

  const gradient = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  texs.add(gradient);

  const toonCache = new Map<string, THREE.MeshToonMaterial>();
  const toon = (color: string) => {
    let m = toonCache.get(color);
    if (!m) {
      m = new THREE.MeshToonMaterial({ color, gradientMap: gradient });
      toonCache.set(color, m);
      mats.add(m);
    }
    return m;
  };

  const outlineCache = new Map<number, THREE.ShaderMaterial>();
  const outlineMat = (thickness: number) => {
    let m = outlineCache.get(thickness);
    if (!m) {
      m = new THREE.ShaderMaterial({
        uniforms: { thickness: { value: thickness }, color: { value: new THREE.Color(INK) } },
        vertexShader: /* glsl */ `
          uniform float thickness;
          void main() {
            vec3 p = position + normal * thickness;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 color;
          void main() {
            gl_FragColor = vec4(color, 1.0);
            #include <colorspace_fragment>
          }`,
        side: THREE.BackSide,
      });
      outlineCache.set(thickness, m);
      mats.add(m);
    }
    return m;
  };

  /** Same shape with welded, averaged normals, so hard-edged hulls don't crack. */
  const welded = (geo: THREE.BufferGeometry) => {
    const pos = new THREE.BufferGeometry();
    pos.setAttribute("position", geo.getAttribute("position"));
    if (geo.index) pos.setIndex(geo.index);
    const m = mergeVertices(pos, 1e-4);
    m.computeVertexNormals();
    return g(m);
  };

  /** Toon mesh with an inverted-hull outline child. `hard` welds normals for the hull. */
  const part = (geo: THREE.BufferGeometry, color: string | THREE.Material, outline = 0.035, hard = false) => {
    const mesh = new THREE.Mesh(g(geo), typeof color === "string" ? toon(color) : color);
    if (outline > 0) mesh.add(new THREE.Mesh(hard ? welded(geo) : geo, outlineMat(outline)));
    return mesh;
  };

  const tex = (w: number, h: number, draw: Draw) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext("2d");
    if (c) draw(c, w, h);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texs.add(t);
    return t;
  };

  const decalProps = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  /** Unlit decal (faces, stickers, effects). */
  const decalMat = (map: THREE.Texture) => {
    const m = new THREE.MeshBasicMaterial({ map, ...decalProps });
    mats.add(m);
    return m;
  };
  /** Toon-shaded decal (printed cloth). */
  const clothMat = (map: THREE.Texture) => {
    const m = new THREE.MeshToonMaterial({ map, gradientMap: gradient, ...decalProps });
    mats.add(m);
    return m;
  };

  /**
   * A patch of a sphere of radius r used as a decal. theta is measured from the
   * top, phi from the front (positive = towards +x); w and h are in radians.
   */
  const sphDecal = <M extends THREE.Material>(mat: M, r: number, theta: number, phi: number, w: number, h: number) =>
    new THREE.Mesh(g(new THREE.SphereGeometry(r, 24, 16, Math.PI / 2 + phi - w / 2, w, theta - h / 2, h)), mat);

  const flatDecal = (map: THREE.Texture, w: number, h: number) => new THREE.Mesh(g(new THREE.PlaneGeometry(w, h)), decalMat(map));

  const shared = {
    blush: tex(128, 80, drawBlush),
    closed: tex(128, 128, drawClosedEye),
  };

  /* ----- shared chibi body: big round head, small round torso, stubby limbs ----- */

  const torsoCurve = new THREE.SplineCurve([
    new THREE.Vector2(0, 0.1),
    new THREE.Vector2(0.3, 0.115),
    new THREE.Vector2(0.44, 0.24),
    new THREE.Vector2(0.465, 0.42),
    new THREE.Vector2(0.43, 0.62),
    new THREE.Vector2(0.3, 0.82),
    new THREE.Vector2(0, 0.9),
  ]).getPoints(32);
  torsoCurve[0].x = 0;
  torsoCurve[torsoCurve.length - 1].x = 0;
  const torsoR = (y: number) => {
    for (let i = 1; i < torsoCurve.length; i++) {
      const a = torsoCurve[i - 1];
      const b = torsoCurve[i];
      if (y <= b.y) return lerp(a.x, b.x, clamp01((y - a.y) / (b.y - a.y || 1)));
    }
    return 0;
  };
  /** A decal that hugs the torso between heights y0 and y1, centered at the front. */
  const torsoDecal = (mat: THREE.Material, y0: number, y1: number, w: number, lift: number) => {
    const pts: THREE.Vector2[] = [];
    for (let k = 0; k <= 16; k++) {
      const y = lerp(y0, y1, k / 16);
      pts.push(new THREE.Vector2(torsoR(y) + lift, y));
    }
    return new THREE.Mesh(g(new THREE.LatheGeometry(pts, 24, -w / 2, w)), mat);
  };
  /** Trousers: the torso below yCut, slightly inflated. */
  const trousers = (yCut: number, color: string) => {
    const pts = [new THREE.Vector2(0, 0.092)];
    for (let k = 1; k <= 12; k++) {
      const y = lerp(0.1, yCut, k / 12);
      pts.push(new THREE.Vector2(torsoR(y) * 1.035 + 0.008, y));
    }
    pts.push(new THREE.Vector2(0, yCut));
    return part(new THREE.LatheGeometry(pts, 40), color, 0.035);
  };

  /** A little 人魂 (spirit flame) with dot eyes: the "yokai" giveaway. */
  const makeWisp = () => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = i / 24;
      pts.push(new THREE.Vector2(0.3 * Math.sin(Math.PI * Math.pow(a, 0.55)), -0.28 + a * 0.95));
    }
    const wisp = new THREE.Group();
    wisp.add(part(new THREE.LatheGeometry(pts, 24), "#d4dcff", 0.025));
    const dot = g(new THREE.SphereGeometry(0.035, 12, 8));
    const dotMat = new THREE.MeshBasicMaterial({ color: "#1f1a33" });
    mats.add(dotMat);
    for (const x of [-0.08, 0.08]) {
      const d = new THREE.Mesh(dot, dotMat);
      d.position.set(x, 0.02, 0.27);
      d.scale.set(1, 1.4, 0.6);
      wisp.add(d);
    }
    return wisp;
  };

  /** Arm hanging from a shoulder pivot, with a round mitten hand that can hold a tool. */
  const makeArm = (color: string) => {
    const pivot = new THREE.Group();
    const arm = part(new THREE.CapsuleGeometry(0.1, 0.2, 6, 12), color, 0.03);
    arm.position.y = -0.1;
    pivot.add(arm);
    const hand = new THREE.Group();
    hand.position.y = -0.34;
    hand.add(part(new THREE.SphereGeometry(0.13, 16, 12), color, 0.03));
    pivot.add(hand);
    return { pivot, hand };
  };

  const chibi = (skin: string, trouser: string, shoe: string, iris: string) => {
    const root = new THREE.Group();
    const head = part(new THREE.SphereGeometry(HEAD_R, 40, 28), skin, 0.04);
    head.position.y = HEAD_Y;
    root.add(head);
    root.add(part(new THREE.LatheGeometry(torsoCurve, 40), skin, 0.035));
    root.add(trousers(0.34, trouser));
    const footGeo = g(new THREE.SphereGeometry(0.17, 16, 12));
    for (const x of [-0.21, 0.21]) {
      const f = part(footGeo, shoe, 0.03);
      f.position.set(x, 0.09, 0.1);
      f.scale.set(1.05, 0.72, 1.35);
      root.add(f);
    }
    const L = makeArm(skin);
    L.pivot.position.set(-0.4, 0.64, 0.06);
    const R = makeArm(skin);
    R.pivot.position.set(0.4, 0.64, 0.06);
    root.add(L.pivot, R.pivot);
    const wisp = makeWisp();
    wisp.scale.setScalar(0.5);
    root.add(wisp);
    const openEye = tex(128, 128, drawEye(iris));
    /** Puts a decal on the head sphere. */
    const onHead = <M extends THREE.Material>(mat: M, theta: number, phi: number, w: number, h: number) => {
      const m = sphDecal(mat, HEAD_R + 0.012, theta, phi, w, h);
      m.position.y = HEAD_Y;
      root.add(m);
      return m;
    };
    return { root, armL: L, armR: R, wisp, openEye, onHead };
  };

  /** Shared "fx" quad (sparkle or burst), tiny until it's needed. */
  const fxQuad = (draw: Draw, size: number) => {
    const m = flatDecal(tex(128, 128, draw), size, size);
    m.material.depthTest = false;
    m.renderOrder = 10;
    m.scale.setScalar(0.0001);
    return m;
  };

  /* ----- the wrench ----- */
  const makeWrench = () => {
    const hw = 0.068; // half handle width
    const yr = -0.3; // box-end ring center
    const rr = 0.155;
    const yj = 0.8; // open jaw center
    const rj = 0.235;
    const nw = 0.085; // half notch width
    const s = new THREE.Shape();
    const ar = Math.acos(hw / rr);
    const aj = Math.acos(hw / rj);
    const an = Math.acos(nw / rj);
    s.absarc(0, yr, rr, Math.PI - ar, TAU + ar, false);
    s.lineTo(hw, yj - Math.sin(aj) * rj);
    s.absarc(0, yj, rj, -aj, an, false);
    s.lineTo(nw, yj + 0.03);
    s.absarc(0, yj + 0.03, nw, 0, Math.PI, true);
    s.lineTo(-nw, yj + Math.sin(an) * rj);
    s.absarc(0, yj, rj, Math.PI - an, Math.PI + aj, false);
    s.lineTo(-hw, yr + Math.sin(ar) * rr);
    const hole = new THREE.Path();
    hole.absarc(0, yr, 0.07, 0, TAU, true);
    s.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: 0.07,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.024,
      bevelSegments: 2,
      curveSegments: 18,
    });
    geo.translate(0, 0, -0.035);
    const group = new THREE.Group();
    group.add(part(geo, "#bccbe0", 0.03, true));
    return group;
  };

  /* ----- the hammer (head along x, striking face at -x) ----- */
  const makeHammer = () => {
    const group = new THREE.Group();
    const handle = part(new THREE.CapsuleGeometry(0.065, 0.82, 4, 12), "#d99a5b", 0.03);
    handle.position.y = 0.3;
    group.add(handle);
    const head = new THREE.Group();
    head.position.y = 0.78;
    const steel = "#6f7d92";
    const block = part(new THREE.CylinderGeometry(0.15, 0.15, 0.42, 20), steel, 0.03, true);
    block.rotation.z = Math.PI / 2;
    head.add(block);
    const face = part(new THREE.CylinderGeometry(0.175, 0.175, 0.08, 20), "#97a4b8", 0.03, true);
    face.rotation.z = Math.PI / 2;
    face.position.x = -0.23;
    head.add(face);
    const peen = part(new THREE.CylinderGeometry(0.15, 0.08, 0.16, 20), steel, 0.03, true);
    peen.rotation.z = Math.PI / 2;
    peen.position.x = 0.29;
    head.add(peen);
    group.add(head);
    return group;
  };

  /* ----- ネジまる: one-eyed builder with a hard hat and a wrench ----- */
  const nejimaru = (): Rig => {
    const b = chibi("#dccbff", "#4a7fd6", "#f08a3c", "#ffb13b");
    const { root } = b;

    // Face: one big eye peeking out from under the brim.
    b.onHead(decalMat(b.openEye), 1.43, 0, 0.84, 0.84);
    for (const phi of [-0.8, 0.8]) b.onHead(decalMat(shared.blush), 1.76, phi, 0.36, 0.22);
    b.onHead(decalMat(tex(128, 128, drawShoutMouth)), 1.98, 0, 0.22, 0.22);

    // Hard hat: a closed lathe of brim + dome, a ridge on top and a 緑十字 sticker.
    const hat = new THREE.Group();
    hat.position.y = HEAD_Y;
    const Rd = HEAD_R * 1.08;
    const yc = HEAD_R * 0.05;
    const yb = HEAD_R * 0.36;
    const a0 = Math.acos((yb + 0.02 - yc) / Rd);
    const prof = [
      new THREE.Vector2(0, yb - 0.035),
      new THREE.Vector2(0.86, yb - 0.035),
      new THREE.Vector2(0.9, yb - 0.012),
      new THREE.Vector2(0.9, yb + 0.004),
      new THREE.Vector2(0.87, yb + 0.02),
    ];
    for (let i = 0; i <= 14; i++) {
      const a = a0 * (1 - i / 14);
      prof.push(new THREE.Vector2(Rd * Math.sin(a), yc + Rd * Math.cos(a)));
    }
    prof[prof.length - 1].x = 0;
    const yellow = "#ffcf3a";
    hat.add(part(new THREE.LatheGeometry(prof, 48), yellow, 0.04));
    const ridgeArc = 2.1;
    const ridgeGeo = new THREE.TorusGeometry(Rd, 0.05, 8, 32, ridgeArc);
    ridgeGeo.rotateZ(Math.PI / 2 - ridgeArc / 2 - 0.35);
    ridgeGeo.rotateY(Math.PI / 2);
    const ridge = part(ridgeGeo, "#ffbf1f", 0.025);
    ridge.position.y = yc;
    hat.add(ridge);
    const sticker = sphDecal(decalMat(tex(128, 128, drawSafetyCross)), Rd + 0.008, 0.98, 0, 0.42, 0.42);
    sticker.position.y = yc;
    hat.add(sticker);
    root.add(hat);

    // Overalls: denim bib + straps, a tool belt with a screwdriver tucked in.
    root.add(torsoDecal(clothMat(tex(256, 256, drawBib)), 0.3, 0.78, 1.5, 0.012));
    const beltR = torsoR(0.34) * 1.035 + 0.02;
    const beltGeo = new THREE.TorusGeometry(beltR, 0.045, 8, 48);
    beltGeo.rotateX(Math.PI / 2);
    const belt = part(beltGeo, "#8a5a3a", 0.025);
    belt.position.y = 0.34;
    root.add(belt);
    const buckle = part(new RoundedBoxGeometry(0.15, 0.12, 0.05, 2, 0.02), "#ffcf3a", 0.022);
    buckle.position.set(0, 0.34, beltR + 0.035);
    root.add(buckle);
    const driver = new THREE.Group();
    driver.position.set(-beltR * 0.82, 0.38, beltR * 0.56);
    driver.rotation.set(0.15, -0.6, 0.35);
    const dHandle = part(new THREE.CapsuleGeometry(0.055, 0.12, 4, 10), "#ff6b5b", 0.022);
    dHandle.position.y = 0.1;
    driver.add(dHandle);
    const shaft = part(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), "#c3cfdd", 0.016, true);
    shaft.position.y = -0.06;
    driver.add(shaft);
    root.add(driver);

    // Big wrench in the inner (right) hand, pointing out along the arm.
    const tool = new THREE.Group();
    tool.add(makeWrench());
    b.armR.hand.add(tool);
    const fx = fxQuad(drawSparkle, 0.55);
    fx.position.set(0.16, 1.02, 0.12);
    tool.add(fx);

    return {
      kind: "wrench",
      root,
      armL: b.armL.pivot,
      armR: b.armR.pivot,
      tool,
      fx,
      wisp: b.wisp,
      openEye: b.openEye,
      closedEye: shared.closed,
      head: new THREE.Vector3(0, 2.28, 0),
    };
  };

  /* ----- トン吉: little oni carpenter with a ねじり鉢巻 and a hammer ----- */
  const tonkichi = (): Rig => {
    const b = chibi("#ffab9c", "#25335c", "#25335c", "#ff6f61");
    const { root } = b;

    // Face: two big eyes (the left one winks), blush and a fang grin.
    const eyeMat = decalMat(b.openEye);
    const winkEye = b.onHead(decalMat(b.openEye), 1.56, -0.3, 0.38, 0.48);
    b.onHead(eyeMat, 1.56, 0.3, 0.38, 0.48);
    for (const phi of [-0.68, 0.68]) b.onHead(decalMat(shared.blush), 1.8, phi, 0.34, 0.2);
    b.onHead(decalMat(tex(128, 96, drawFangGrin)), 1.96, 0, 0.3, 0.2);

    // Two little horns.
    const hornPts: THREE.Vector2[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = i / 10;
      hornPts.push(new THREE.Vector2(0.11 * Math.pow(1 - a, 0.85) + 0.012 * Math.sin(Math.PI * a), -0.06 + 0.3 * a));
    }
    hornPts[hornPts.length - 1].x = 0;
    const hornGeo = g(new THREE.LatheGeometry(hornPts, 16));
    const up = new THREE.Vector3(0, 1, 0);
    for (const phi of [-0.52, 0.52]) {
      const th = 0.5;
      const d = new THREE.Vector3(Math.sin(th) * Math.sin(phi), Math.cos(th), Math.sin(th) * Math.cos(phi));
      const horn = part(hornGeo, "#fff1cc", 0.025);
      horn.scale.setScalar(1.3);
      horn.position.copy(d).multiplyScalar(HEAD_R - 0.02);
      horn.position.y += HEAD_Y;
      d.x *= 1.5;
      horn.quaternion.setFromUnitVectors(up, d.normalize());
      root.add(horn);
    }

    // 豆絞り headband, knotted on the side with two tails.
    const bandY = HEAD_R * 0.36;
    const bandR = Math.sqrt(HEAD_R * HEAD_R - bandY * bandY) + 0.03;
    const dots = tex(128, 64, drawMameshibori);
    dots.wrapS = THREE.RepeatWrapping;
    dots.repeat.set(9, 1);
    const bandMat = new THREE.MeshToonMaterial({ map: dots, gradientMap: gradient });
    mats.add(bandMat);
    const bandGeo = new THREE.TorusGeometry(bandR, 0.075, 10, 56);
    bandGeo.rotateX(Math.PI / 2);
    const band = part(bandGeo, bandMat, 0.025);
    band.position.y = HEAD_Y + bandY;
    root.add(band);
    const knot = new THREE.Group();
    const ka = 1.15;
    knot.position.set(Math.sin(ka) * bandR, HEAD_Y + bandY, Math.cos(ka) * bandR);
    knot.rotation.y = ka;
    const k = part(new THREE.SphereGeometry(0.1, 14, 10), bandMat, 0.025);
    k.scale.set(0.8, 0.9, 1);
    knot.add(k);
    // Tails hang from the knot, flaring outwards (knot-local +z points away from the head).
    const tailGeo = g(new THREE.CapsuleGeometry(0.05, 0.2, 4, 8));
    for (const [rx, rz] of [
      [-0.7, 0.45],
      [-1.25, -0.25],
    ]) {
      const holder = new THREE.Group();
      holder.rotation.set(rx, 0, rz);
      const tail = part(tailGeo, bandMat, 0.022);
      tail.position.y = -0.15;
      tail.scale.set(1, 1, 0.55);
      holder.add(tail);
      knot.add(holder);
    }
    root.add(knot);

    // 腹掛け apron, a tie at the waist and a leather 腰袋.
    root.add(torsoDecal(clothMat(tex(256, 256, drawApron)), 0.14, 0.78, 1.35, 0.03));
    const tieR = torsoR(0.36) * 1.035 + 0.035;
    const tieGeo = new THREE.TorusGeometry(tieR, 0.028, 6, 48);
    tieGeo.rotateX(Math.PI / 2);
    const tie = part(tieGeo, "#2b4a8c", 0.02);
    tie.position.y = 0.36;
    root.add(tie);
    const pouch = part(new RoundedBoxGeometry(0.16, 0.22, 0.24, 2, 0.04), "#b07a43", 0.025);
    pouch.position.set(tieR * 0.92, 0.26, tieR * 0.3);
    pouch.rotation.y = 0.35;
    root.add(pouch);

    // Hammer in the inner (left) hand.
    const tool = new THREE.Group();
    tool.add(makeHammer());
    b.armL.hand.add(tool);
    const fx = fxQuad(drawBurst, 0.6);
    fx.position.set(-0.42, 0.78, 0.15);
    tool.add(fx);

    return {
      kind: "hammer",
      root,
      armL: b.armL.pivot,
      armR: b.armR.pivot,
      tool,
      fx,
      wisp: b.wisp,
      openEye: b.openEye,
      winkEye,
      closedEye: shared.closed,
      head: new THREE.Vector3(0, 2.18, 0),
    };
  };

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.set(-3, 5, 8);
  scene.add(sun);

  const left = nejimaru();
  const right = tonkichi();
  scene.add(left.root, right.root);

  const dispose = () => {
    geos.forEach((x) => x.dispose());
    mats.forEach((x) => x.dispose());
    texs.forEach((x) => x.dispose());
  };

  return { scene, left, right, dispose };
}

/* ---------- component ---------- */

const BUBBLE =
  "absolute left-0 top-0 whitespace-nowrap rounded-[1.2em] border-[3px] bg-white px-4 py-1.5 font-pop text-base font-bold leading-tight opacity-0 shadow-[0_4px_0_#33243d] will-change-transform sm:px-5 sm:py-2 sm:text-2xl";

const newPose = (): Pose => ({ x: 0, y: 0, s: 1, rz: 0, ry: 0 });
const copyPose = (out: Pose, p: Pose) => {
  out.x = p.x;
  out.y = p.y;
  out.s = p.s;
  out.rz = p.rz;
  out.ry = p.ry;
};

export default function YokaiPop({ stage }: { stage: YokaiStage }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const bubbleL = useRef<HTMLDivElement>(null);
  const bubbleR = useRef<HTMLDivElement>(null);
  const setStageRef = useRef<(s: YokaiStage) => void>(() => {});

  useEffect(() => {
    const wrap = wrapRef.current;
    const bl = bubbleL.current;
    const br = bubbleR.current;
    if (!wrap || !bl || !br) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      return; // No WebGL: the shop flow simply runs without the yokai.
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const canvas = renderer.domElement;
    canvas.className = "absolute inset-0 h-full w-full";
    wrap.prepend(canvas);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
    camera.position.set(0, 0, CAM_Z);
    const { scene, left, right, dispose } = buildScene();
    const lineEls = (el: HTMLDivElement) => Array.from(el.querySelectorAll<HTMLElement>("[data-line]"));
    const rigs = [
      { rig: left, side: -1, delay: 0, bubble: bl, lines: LINES[0], spans: lineEls(bl) },
      { rig: right, side: 1, delay: 0.14, bubble: br, lines: LINES[1], spans: lineEls(br) },
    ] as const;
    /** Which line each bubble shows (-1 = none chosen yet). */
    const shown = [-1, -1];
    const showLine = (i: number, k: number) => {
      if (shown[i] === k) return;
      shown[i] = k;
      rigs[i].spans.forEach((s, j) => (s.hidden = j !== k));
    };
    showLine(0, 0);
    showLine(1, 0);

    // Layout in world units at z = 0, recomputed on resize.
    let vw = 1;
    let vh = 1;
    const L = { H: 1, W: 1, s: 1 };
    const resize = () => {
      vw = window.innerWidth;
      vh = window.innerHeight;
      renderer.setSize(vw, vh, false);
      camera.aspect = vw / vh;
      camera.updateProjectionMatrix();
      L.H = 2 * CAM_Z * Math.tan((FOV * Math.PI) / 360);
      L.W = L.H * camera.aspect;
      L.s = Math.min((0.33 * L.H) / 2.1, (0.36 * L.W) / 2);
    };
    resize();

    const popPose = (side: number, out: Pose) => {
      out.x = side * (L.W / 2 - 1.0 * L.s - 0.03 * L.W);
      out.y = -L.H / 2 + 0.06 * L.H;
      out.s = L.s;
      out.rz = 0;
      out.ry = -side * 0.38;
      return out;
    };
    const peekPose = (side: number, out: Pose) => {
      const s = L.s * 0.82;
      out.x = side * (L.W / 2 - 1.05 * s);
      out.y = -L.H / 2 - 0.06 * s;
      out.s = s;
      out.rz = side * 0.14;
      out.ry = -side * 0.45;
      return out;
    };
    const offX = (side: number) => side * (L.W / 2 + 2.4 * L.s);

    let stage: YokaiStage = "hidden";
    let start = 0;
    let raf = 0;
    let peekFromPop = false;
    const target = [newPose(), newPose()];
    const cur = [newPose(), newPose()];
    const from = [newPose(), newPose()];
    const hasLast = [false, false];
    const anchor = new THREE.Vector3();

    /** Bubble layout for this frame, measured per rig and applied once both are known. */
    const boxes = [0, 1].map(() => ({ x: 0, y: 0, w: 0, h: 0, ax: 0, k: 0, alpha: 0 }));
    const BUBBLE_MARGIN = 8;

    const measureBubble = (i: number, el: HTMLDivElement, rig: Rig, side: number, k: number, alpha: number) => {
      const b = boxes[i];
      b.k = k;
      b.alpha = alpha;
      if (alpha <= 0.001) return;
      anchor.copy(rig.head);
      rig.root.localToWorld(anchor);
      anchor.project(camera);
      b.ax = (anchor.x * 0.5 + 0.5) * vw;
      const ay = (-anchor.y * 0.5 + 0.5) * vh;
      b.w = el.offsetWidth;
      b.h = el.offsetHeight;
      b.x = Math.min(vw - b.w - BUBBLE_MARGIN, Math.max(BUBBLE_MARGIN, b.ax - b.w / 2 - side * b.w * 0.22));
      b.y = Math.max(BUBBLE_MARGIN, ay - b.h - 12);
    };

    /** On narrow screens the two bubbles can collide: push them apart, then stack if needed. */
    const separateBubbles = () => {
      const a = boxes[0];
      const b = boxes[1];
      if (a.alpha <= 0.001 || b.alpha <= 0.001) return;
      const gap = 6;
      let over = a.x + a.w + gap - b.x;
      if (over <= 0 || a.y > b.y + b.h || b.y > a.y + a.h) return;
      const moveA = Math.min(over / 2, a.x - BUBBLE_MARGIN);
      a.x -= moveA;
      over -= moveA;
      const moveB = Math.min(over, vw - BUBBLE_MARGIN - b.w - b.x);
      b.x += moveB;
      over -= moveB;
      const moreA = Math.min(over, a.x - BUBBLE_MARGIN);
      a.x -= moreA;
      over -= moreA;
      if (over > 0.5) b.y = Math.max(BUBBLE_MARGIN, a.y - b.h - gap);
    };

    const applyBubble = (i: number, el: HTMLDivElement) => {
      const b = boxes[i];
      if (b.alpha <= 0.001) {
        el.style.opacity = "0";
        return;
      }
      const tail = Math.min(b.w - 22, Math.max(22, b.ax - b.x));
      el.style.setProperty("--tail", `${tail}px`);
      el.style.transformOrigin = `${tail}px ${b.h + 10}px`;
      el.style.transform = `translate(${b.x}px, ${b.y}px) scale(${Math.max(0.01, b.k)})`;
      el.style.opacity = String(b.alpha);
    };

    const frame = (now: number) => {
      const t = reduced ? 10 : (now - start) / 1000;
      const clock = reduced ? 0 : now / 1000;

      for (let i = 0; i < rigs.length; i++) {
        const { rig, side, delay, bubble, lines } = rigs[i];
        const p = cur[i];
        const tgt = target[i];
        let sx = 1;
        let sy = 1;
        let hop = 0;
        let twirl = 0;
        let bubbleK = 0;
        let bubbleA = 0;
        const u = t - delay;
        const popping = stage === "pop";

        if (popping) {
          popPose(side, tgt);
          copyPose(p, tgt);
          p.x = lerp(offX(side), tgt.x, spring(u));
          const air = 0.42;
          if (u > 0 && u < air) {
            const a = u / air;
            hop = Math.sin(Math.PI * a) * 0.9 * L.s;
            sx = 0.94;
            sy = 1.08;
            twirl = -side * TAU * easeOutCubic(a);
            p.rz = side * 0.35 * (1 - a);
          } else if (u >= air) {
            const d = u - air;
            const sq = Math.exp(-7 * d) * Math.cos(16 * d);
            sy = 1 - 0.24 * sq;
            sx = 1 + 0.16 * sq;
          }
          let li = 0;
          for (let k = 1; k < lines.length; k++) if (u >= lines[k].at) li = k;
          showLine(i, li);
          bubbleK = easeOutBack((u - lines[li].at) / 0.28);
          bubbleA = clamp01((u - lines[0].at) / 0.12);
        } else {
          peekPose(side, tgt);
          const k = easeOutBack(t / 0.6);
          const f = from[i];
          p.x = lerp(f.x, tgt.x, k);
          p.y = lerp(f.y, tgt.y, k);
          p.s = lerp(f.s, tgt.s, clamp01(k));
          p.rz = lerp(f.rz, tgt.rz, k);
          p.ry = lerp(f.ry, tgt.ry, k);
          // Speech bubbles shrink away as the reveal comes in.
          bubbleK = 1 - easeOutCubic(t / 0.25);
          bubbleA = peekFromPop ? clamp01(1 - t / 0.25) : 0;
        }
        hasLast[i] = true;

        // How "landed" they are: 0 while flying in, 1 once settled.
        const settle = reduced || (!popping && peekFromPop) ? 1 : clamp01(((popping ? u : t) - 0.45) / 0.3);
        // Time since landing (pop) or since arriving in the corner (peek).
        const since = reduced ? 10 : popping ? u - 0.45 : peekFromPop ? t + 1 : t - 0.45;
        const ph = i * 1.7;
        const bob = reduced ? 0 : Math.abs(Math.sin(clock * 5.2 + ph)) * 0.07 * p.s * settle;
        const wiggle = reduced ? 0 : Math.sin(clock * 4.4 + ph) * 0.07 * settle;

        // Arms: + rotates the inner arm (towards the screen center) upward.
        const s = side < 0 ? 1 : -1;
        const inner = side < 0 ? rig.armR : rig.armL;
        const outer = side < 0 ? rig.armL : rig.armR;
        const fx = rig.fx;
        let fxK = 0;

        if (rig.kind === "wrench") {
          // Raise the wrench, twirl it once, then show it off with a ratcheting wiggle.
          const raise = easeOutBack(settle);
          inner.rotation.z = s * (lerp(0.7, 2.25, raise) + (reduced ? 0 : 0.07 * Math.sin(clock * 3.1)) * settle);
          const spinT = since - 0.15;
          const spin = reduced ? 0 : TAU * easeOutCubic(spinT / 0.55);
          const ratchet = reduced ? 0 : 0.22 * Math.max(0, Math.sin(clock * 7 + ph)) * clamp01(spinT - 0.6);
          rig.tool.rotation.z = Math.PI - 0.22 - s * (spin + ratchet);
          // Sparkle right after the twirl, then a gleam every couple of seconds.
          const gl = spinT - 0.5;
          const gleam = (clock + 0.6) % 2.6;
          fxK = reduced ? 0 : Math.max(gl > 0 && gl < 0.5 ? Math.sin((Math.PI * gl) / 0.5) : 0, gleam < 0.4 && spinT > 1.2 ? Math.sin((Math.PI * gleam) / 0.4) : 0);
          fx.rotation.z = clock * 3;
          // Outer hand: "wait!" up high while shouting, then on the hip.
          const shout = popping ? clamp01((u - 0.25) / 0.2) * (1 - clamp01((u - 1.25) / 0.3)) : 0;
          const wave = reduced ? 0 : Math.sin(clock * 14 + ph);
          outer.rotation.z = -s * (lerp(0.55 + (reduced ? 0 : 0.12 * Math.sin(clock * 6 + ph)), 2.75 + 0.18 * wave, shout) * lerp(1, settle, 0.5));
        } else {
          // トントン: two quick taps, wind up, repeat.
          const up = 2.45;
          const hit = 1.2;
          let lift = 1;
          let flash = 0;
          if (!reduced && since > 0.3) {
            const tau = (since - 0.3) % 1.15;
            lift = hammerLift(tau);
            const d = sinceHit(tau);
            flash = d < 0.18 ? 1 - d / 0.18 : 0;
          }
          inner.rotation.z = s * lerp(lerp(1.0, up, settle), lerp(hit, up, lift), settle);
          rig.tool.rotation.z = Math.PI + s * 0.15;
          fxK = flash > 0 ? 0.55 + 0.6 * (1 - flash) : 0;
          fx.material.opacity = Math.min(1, flash * 3);
          fx.rotation.z = flash * 0.4;
          sy -= 0.05 * flash;
          sx += 0.03 * flash;
          outer.rotation.z = -s * (0.5 + (reduced ? 0 : 0.12 * Math.sin(clock * 6 + ph)));
        }
        fx.scale.setScalar(Math.max(0.0001, fxK));

        rig.root.position.set(p.x, p.y + hop + bob, 0);
        rig.root.rotation.set(0.1, p.ry + twirl, p.rz + wiggle);
        rig.root.scale.set(p.s * sx, p.s * sy, p.s * sx);

        // Spirit flame floats beside the head, on the outer side.
        const wt = clock * 2.2 + ph;
        rig.wisp.position.set(side * 0.8 + Math.sin(wt) * 0.06, 2.4 + Math.sin(wt * 1.3) * 0.1, -0.2);
        rig.wisp.rotation.z = Math.sin(wt * 1.1) * 0.25;

        // Eyes: the oni winks after it lands, both blink now and then.
        const blinkPhase = (clock + i * 0.9) % 2.8;
        const blink = !reduced && blinkPhase < 0.12 ? 0.12 : 1;
        rig.openEye.repeat.y = 1 / blink;
        rig.openEye.offset.y = 0.5 - 0.5 / blink;
        if (rig.winkEye) {
          const winkWindow = popping ? u > 0.85 && u < 1.35 : t > 0.7 && t < 1.15;
          const want = winkWindow && !reduced ? rig.closedEye : rig.openEye;
          const m = rig.winkEye.material;
          if (m.map !== want) {
            m.map = want;
            m.needsUpdate = true;
          }
        }

        rig.root.updateMatrixWorld();
        measureBubble(i, bubble, rig, side, bubbleK, bubbleA);
      }
      separateBubbles();
      applyBubble(0, bl);
      applyBubble(1, br);

      renderer.render(scene, camera);
      if (!reduced && stage !== "hidden") raf = requestAnimationFrame(frame);
    };

    const setStage = (next: YokaiStage) => {
      if (next === stage) return;
      cancelAnimationFrame(raf);
      if (next === "peek") {
        // Glide from wherever they are now; enter from the sides if they weren't on screen.
        peekFromPop = stage === "pop";
        rigs.forEach(({ side }, i) => {
          if (peekFromPop && hasLast[i]) copyPose(from[i], cur[i]);
          else {
            peekPose(side, from[i]);
            from[i].x = side * (L.W / 2 + 2.4 * L.s);
          }
        });
      }
      if (next === "pop") {
        hasLast.fill(false);
        showLine(0, 0);
        showLine(1, 0);
      }
      stage = next;
      start = performance.now();
      wrap.style.visibility = next === "hidden" ? "hidden" : "visible";
      if (next !== "hidden") raf = requestAnimationFrame(frame);
    };
    setStageRef.current = setStage;

    // Warm up shaders and textures now so the first click has no hitch.
    wrap.style.visibility = "hidden";
    renderer.compile(scene, camera);
    renderer.render(scene, camera);

    const onResize = () => {
      resize();
      if (reduced && stage !== "hidden") frame(performance.now());
    };
    window.addEventListener("resize", onResize);

    return () => {
      setStageRef.current = () => {};
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    setStageRef.current(stage);
  }, [stage]);

  return (
    <div ref={wrapRef} aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden" style={{ visibility: "hidden" }}>
      <div ref={bubbleL} className={BUBBLE} style={{ borderColor: INK, color: INK }}>
        <Lines lines={LINES[0]} />
        <Tail />
      </div>
      <div ref={bubbleR} className={BUBBLE} style={{ borderColor: INK, color: INK }}>
        <Lines lines={LINES[1]} />
        <Tail />
      </div>
    </div>
  );
}

function Lines({ lines }: { lines: { text: string }[] }) {
  return lines.map((l) => (
    <span key={l.text} data-line>
      {l.text}
    </span>
  ));
}

function Tail() {
  return (
    <span
      className="absolute -bottom-[11px] h-5 w-5 -translate-x-1/2 rotate-45 border-b-[3px] border-r-[3px] bg-white"
      style={{ left: "var(--tail, 50%)", borderColor: INK }}
    />
  );
}
