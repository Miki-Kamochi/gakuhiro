"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/**
 * Two 付喪神 (household trash that came alive) pop in from the sides of the
 * screen when the shop "breaks": ボトるん, a PET bottle, and ハコすけ, a cardboard
 * box. Built from three.js primitives with toon shading and inverted-hull
 * outlines, drawn on one fixed, transparent, click-through canvas.
 *
 * - "pop":  they bounce in from the left and right edges and shout.
 * - "peek": they settle into the bottom corners (used on the reveal screen).
 * - "hidden": nothing is drawn and the render loop is stopped.
 */
export type YokaiStage = "hidden" | "pop" | "peek";

const INK = "#33243d";
const FOV = 30;
const CAM_Z = 12;

/* ---------- small math helpers ---------- */

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const easeOutBack = (x: number) => {
  const c = 1.9;
  const t = clamp01(x) - 1;
  return 1 + (c + 1) * t * t * t + c * t * t;
};
const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
/** Damped spring from 0 to 1 that overshoots once or twice. */
const spring = (u: number) => (u <= 0 ? 0 : 1 - Math.exp(-6.5 * u) * Math.cos(10.5 * u));

/* ---------- canvas-drawn face parts ---------- */

type Draw = (c: CanvasRenderingContext2D, w: number, h: number) => void;

function drawEye(iris: string): Draw {
  return (c, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const rx = w * 0.42;
    const ry = h * 0.44;
    c.fillStyle = "#1f1a33";
    c.beginPath();
    c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    c.fill();
    // Iris glow from below.
    const g = c.createLinearGradient(0, cy - ry * 0.2, 0, cy + ry);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, iris);
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(cx, cy + ry * 0.08, rx * 0.84, ry * 0.84, 0, 0, Math.PI * 2);
    c.fill();
    // Big and small highlights.
    c.fillStyle = "#ffffff";
    c.beginPath();
    c.ellipse(cx + rx * 0.3, cy - ry * 0.38, rx * 0.36, ry * 0.32, -0.4, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(cx - rx * 0.36, cy + ry * 0.42, rx * 0.16, 0, Math.PI * 2);
    c.fill();
    // Tiny sparkle.
    c.beginPath();
    c.arc(cx + rx * 0.42, cy + ry * 0.3, rx * 0.08, 0, Math.PI * 2);
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
  c.lineWidth = w * 0.05;
  c.beginPath();
  c.ellipse(w / 2, h / 2, w * 0.3, h * 0.36, 0, 0, Math.PI * 2);
  c.fill();
  c.save();
  c.clip();
  c.fillStyle = "#ff8fa3";
  c.beginPath();
  c.ellipse(w / 2, h * 0.84, w * 0.24, h * 0.2, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();
  c.beginPath();
  c.ellipse(w / 2, h / 2, w * 0.3, h * 0.36, 0, 0, Math.PI * 2);
  c.stroke();
};

/** Wide grin with the tongue sticking out (てへっ). */
const drawGrinMouth: Draw = (c, w, h) => {
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
  c.ellipse(w * 0.6, h * 0.86, w * 0.24, h * 0.24, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();
  c.strokeStyle = "#1f1a33";
  c.lineWidth = w * 0.045;
  c.lineJoin = "round";
  path();
  c.stroke();
};

const drawLabel: Draw = (c, w, h) => {
  c.fillStyle = "#7fd8b6";
  c.fillRect(0, 0, w, h);
  c.fillStyle = "#ffffff";
  c.beginPath();
  c.moveTo(0, h * 0.72);
  for (let x = 0; x <= w; x += 4) c.lineTo(x, h * 0.72 + Math.sin((x / w) * Math.PI * 12) * h * 0.06);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.closePath();
  c.fill();
  c.fillStyle = "#2f7d68";
  c.font = `bold ${Math.round(h * 0.34)}px "Hiragino Maru Gothic ProN", "Hiragino Sans", "Noto Sans JP", sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  // Front of the bottle is the middle of the texture.
  for (const x of [w * 0.5, w * 0.0, w * 1.0]) {
    c.fillText("♻ おみず", x, h * 0.4);
  }
};

const drawShine: Draw = (c, w, h) => {
  const g = c.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.5, "rgba(255,255,255,0.9)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.beginPath();
  c.roundRect(0, 0, w, h, w / 2);
  c.fill();
};

const drawArrows: Draw = (c, w, h) => {
  c.strokeStyle = "#7a4e2a";
  c.fillStyle = "#7a4e2a";
  c.lineWidth = w * 0.07;
  c.lineCap = "round";
  for (const x of [w * 0.32, w * 0.68]) {
    c.beginPath();
    c.moveTo(x, h * 0.78);
    c.lineTo(x, h * 0.34);
    c.stroke();
    c.beginPath();
    c.moveTo(x - w * 0.13, h * 0.38);
    c.lineTo(x, h * 0.18);
    c.lineTo(x + w * 0.13, h * 0.38);
    c.closePath();
    c.fill();
  }
  c.fillRect(w * 0.18, h * 0.86, w * 0.64, h * 0.05);
};

/* ---------- the scene ---------- */

type Rig = {
  root: THREE.Group;
  body: THREE.Group;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  eyeL: THREE.Mesh;
  eyeR: THREE.Mesh;
  flapL?: THREE.Object3D;
  flapR?: THREE.Object3D;
  wisp: THREE.Object3D;
  /** Where the speech bubble attaches, in the rig's local space. */
  head: THREE.Vector3;
  openEye: THREE.Texture;
  closedEye: THREE.Texture;
};

type Pose = { x: number; y: number; s: number; rz: number; ry: number };

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

  /** Toon mesh with an inverted-hull outline child. */
  const part = (geo: THREE.BufferGeometry, color: string, outline = 0.035) => {
    const mesh = new THREE.Mesh(g(geo), toon(color));
    if (outline > 0) mesh.add(new THREE.Mesh(geo, outlineMat(outline)));
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

  const decalMat = (map: THREE.Texture) => {
    const m = new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    mats.add(m);
    return m;
  };

  /** A decal that hugs a cylinder of radius r, centered at angle theta (0 = front). */
  const cylDecal = (map: THREE.Texture, r: number, y: number, theta: number, width: number, height: number) => {
    const len = width / r;
    const mesh = new THREE.Mesh(
      g(new THREE.CylinderGeometry(r, r, height, 16, 1, true, theta - len / 2, len)),
      decalMat(map),
    );
    mesh.position.y = y;
    return mesh;
  };

  const flatDecal = (map: THREE.Texture, w: number, h: number) => new THREE.Mesh(g(new THREE.PlaneGeometry(w, h)), decalMat(map));

  const shared = {
    blush: tex(128, 80, drawBlush),
    closed: tex(128, 128, drawClosedEye),
  };

  /** A little 人魂 (spirit flame) with dot eyes: the "yokai" giveaway. */
  const makeWisp = () => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = i / 24;
      pts.push(new THREE.Vector2(0.3 * Math.sin(Math.PI * Math.pow(a, 0.55)), -0.28 + a * 0.95));
    }
    const wisp = new THREE.Group();
    const flame = part(new THREE.LatheGeometry(pts, 24), "#d4dcff", 0.025);
    wisp.add(flame);
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

  const capsuleArm = (r: number, len: number, color: string) => {
    const pivot = new THREE.Group();
    const arm = part(new THREE.CapsuleGeometry(r, len, 6, 12), color, 0.03);
    arm.position.y = -len / 2;
    pivot.add(arm);
    return pivot;
  };

  /* ----- ボトるん: PET bottle ----- */
  const bottle = (): Rig => {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const R = 0.62;

    const profile: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
    for (let i = 0; i <= 8; i++) {
      const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2);
      profile.push(new THREE.Vector2(0.44 + 0.18 * Math.cos(a), 0.18 + 0.18 * Math.sin(a)));
    }
    profile.push(new THREE.Vector2(R, 1.2));
    for (let i = 1; i <= 10; i++) {
      const a = i / 10;
      profile.push(new THREE.Vector2(0.26 + (R - 0.26) * (Math.cos(Math.PI * a) + 1) * 0.5, 1.2 + 0.42 * a));
    }
    profile.push(new THREE.Vector2(0.26, 1.82), new THREE.Vector2(0, 1.82));
    body.add(part(new THREE.LatheGeometry(profile, 48), "#cdeff8", 0.04));

    // Cap with rounded top edge.
    const cap: THREE.Vector2[] = [new THREE.Vector2(0, 1.74), new THREE.Vector2(0.31, 1.74)];
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      cap.push(new THREE.Vector2(0.25 + 0.06 * Math.cos(a), 1.98 + 0.06 * Math.sin(a)));
    }
    cap.push(new THREE.Vector2(0, 2.04));
    body.add(part(new THREE.LatheGeometry(cap, 32), "#ff8a73", 0.035));

    // Petaloid feet at the bottom.
    const footGeo = g(new THREE.SphereGeometry(0.17, 16, 12));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.PI / 5;
      const f = part(footGeo, "#b4e3f0", 0.03);
      f.position.set(Math.sin(a) * 0.34, 0.07, Math.cos(a) * 0.34);
      f.scale.set(1, 0.7, 1);
      body.add(f);
    }

    // Label band and plastic shine.
    const label = new THREE.Mesh(
      g(new THREE.CylinderGeometry(R + 0.006, R + 0.006, 0.34, 48, 1, true, Math.PI, Math.PI * 2)),
      decalMat(tex(512, 96, drawLabel)),
    );
    label.position.y = 0.36;
    body.add(label);
    body.add(cylDecal(tex(32, 128, drawShine), R + 0.01, 0.82, -0.62, 0.11, 0.62));

    // Face.
    const openEye = tex(128, 128, drawEye("#3fc7e0"));
    const eyeL = cylDecal(openEye, R + 0.012, 0.93, -0.3, 0.27, 0.3);
    const eyeR = cylDecal(openEye, R + 0.012, 0.93, 0.3, 0.27, 0.3);
    body.add(eyeL, eyeR);
    for (const th of [-0.62, 0.62]) body.add(cylDecal(shared.blush, R + 0.011, 0.74, th, 0.26, 0.16));
    body.add(cylDecal(tex(128, 128, drawShoutMouth), R + 0.012, 0.7, 0, 0.17, 0.17));

    const armL = capsuleArm(0.085, 0.24, "#cdeff8");
    armL.position.set(-R + 0.02, 0.66, 0);
    const armR = capsuleArm(0.085, 0.24, "#cdeff8");
    armR.position.set(R - 0.02, 0.66, 0);
    body.add(armL, armR);

    const wisp = makeWisp();
    wisp.scale.setScalar(0.7);
    root.add(wisp);

    return { root, body, armL, armR, eyeL, eyeR, wisp, head: new THREE.Vector3(0, 2.25, 0), openEye, closedEye: shared.closed };
  };

  /* ----- ハコすけ: cardboard box ----- */
  const box = (): Rig => {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const W = 1.56;
    const H = 1.12;
    const D = 1.1;
    const cy = 0.14 + H / 2;
    const kraft = "#dba76a";

    const shell = part(new RoundedBoxGeometry(W, H, D, 4, 0.1), kraft, 0.04);
    shell.position.y = cy;
    body.add(shell);

    // Dark opening on top (the flaps are open).
    const holeMat = new THREE.MeshBasicMaterial({ color: "#6b4426" });
    mats.add(holeMat);
    const hole = new THREE.Mesh(g(new THREE.PlaneGeometry(W - 0.22, D - 0.22)), holeMat);
    hole.rotation.x = -Math.PI / 2;
    hole.position.y = cy + H / 2 + 0.004;
    body.add(hole);

    // Side flaps as floppy ears.
    const flap = (side: -1 | 1) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * (W / 2 - 0.05), cy + H / 2 - 0.02, 0);
      const f = part(new RoundedBoxGeometry(0.06, 0.52, D - 0.06, 2, 0.025), "#c99459", 0.03);
      f.position.y = 0.25;
      pivot.add(f);
      body.add(pivot);
      return pivot;
    };
    const flapL = flap(-1);
    const flapR = flap(1);

    // "This side up" arrows on the right side.
    const arrows = flatDecal(tex(128, 128, drawArrows), 0.42, 0.42);
    arrows.position.set(W / 2 + 0.006, cy - 0.05, 0.12);
    arrows.rotation.y = Math.PI / 2;
    body.add(arrows);

    // Face on the front.
    const fz = D / 2 + 0.006;
    const openEye = tex(128, 128, drawEye("#ff9f43"));
    const eyeL = flatDecal(openEye, 0.32, 0.34);
    eyeL.position.set(-0.3, cy + 0.12, fz);
    const eyeR = flatDecal(openEye, 0.32, 0.34);
    eyeR.position.set(0.3, cy + 0.12, fz);
    body.add(eyeL, eyeR);
    for (const x of [-0.56, 0.56]) {
      const b = flatDecal(shared.blush, 0.3, 0.19);
      b.position.set(x, cy - 0.08, fz);
      body.add(b);
    }
    const mouth = flatDecal(tex(128, 128, drawGrinMouth), 0.3, 0.3);
    mouth.position.set(0, cy - 0.16, fz);
    body.add(mouth);

    // Stubby feet.
    const footGeo = g(new THREE.SphereGeometry(0.17, 16, 12));
    for (const x of [-0.4, 0.4]) {
      const f = part(footGeo, "#b98448", 0.03);
      f.position.set(x, 0.1, 0.12);
      f.scale.set(1.15, 0.65, 1.35);
      body.add(f);
    }

    const armL = capsuleArm(0.095, 0.24, kraft);
    armL.position.set(-W / 2 + 0.02, cy - 0.02, 0);
    const armR = capsuleArm(0.095, 0.24, kraft);
    armR.position.set(W / 2 - 0.02, cy - 0.02, 0);
    body.add(armL, armR);

    const wisp = makeWisp();
    wisp.scale.setScalar(0.7);
    root.add(wisp);

    return {
      root,
      body,
      armL,
      armR,
      eyeL,
      eyeR,
      flapL,
      flapR,
      wisp,
      head: new THREE.Vector3(0, 1.95, 0),
      openEye,
      closedEye: shared.closed,
    };
  };

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.set(-3, 5, 8);
  scene.add(sun);

  const left = bottle();
  const right = box();
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
    const rigs = [
      { rig: left, side: -1, delay: 0, bubble: bl, bubbleAt: 0.32 },
      { rig: right, side: 1, delay: 0.14, bubble: br, bubbleAt: 0.55 },
    ] as const;

    // Layout in world units at z = 0, recomputed on resize.
    let vw = 1;
    let vh = 1;
    let L = { H: 1, W: 1, s: 1 };
    const resize = () => {
      vw = window.innerWidth;
      vh = window.innerHeight;
      renderer.setSize(vw, vh, false);
      camera.aspect = vw / vh;
      camera.updateProjectionMatrix();
      const H = 2 * CAM_Z * Math.tan((FOV * Math.PI) / 360);
      const W = H * camera.aspect;
      L = { H, W, s: Math.min((0.33 * H) / 2.1, (0.36 * W) / 2) };
    };
    resize();

    const popPose = (side: number): Pose => ({
      x: side * (L.W / 2 - 1.0 * L.s - 0.03 * L.W),
      y: -L.H / 2 + 0.06 * L.H,
      s: L.s,
      rz: 0,
      ry: -side * 0.38,
    });
    const peekPose = (side: number): Pose => {
      const s = L.s * 0.82;
      return { x: side * (L.W / 2 - 1.05 * s), y: -L.H / 2 - 0.06 * s, s, rz: side * 0.14, ry: -side * 0.45 };
    };
    const offPose = (side: number, target: Pose): Pose => ({ ...target, x: side * (L.W / 2 + 2.4 * L.s) });

    let stage: YokaiStage = "hidden";
    let start = 0;
    let raf = 0;
    let peekFromPop = false;
    const last: (Pose | null)[] = [null, null];
    const from: Pose[] = [popPose(-1), popPose(1)];
    const anchor = new THREE.Vector3();

    const placeBubble = (el: HTMLDivElement, rig: Rig, side: number, k: number, alpha: number) => {
      if (alpha <= 0.001) {
        el.style.opacity = "0";
        return;
      }
      anchor.copy(rig.head);
      rig.root.localToWorld(anchor);
      anchor.project(camera);
      const ax = (anchor.x * 0.5 + 0.5) * vw;
      const ay = (-anchor.y * 0.5 + 0.5) * vh;
      const bw = el.offsetWidth;
      const bh = el.offsetHeight;
      const margin = 8;
      const left = Math.min(vw - bw - margin, Math.max(margin, ax - bw / 2 - side * bw * 0.22));
      const top = Math.max(margin, ay - bh - 12);
      const tail = Math.min(bw - 22, Math.max(22, ax - left));
      el.style.setProperty("--tail", `${tail}px`);
      el.style.transformOrigin = `${tail}px ${bh + 10}px`;
      el.style.transform = `translate(${left}px, ${top}px) scale(${Math.max(0.01, k)})`;
      el.style.opacity = String(alpha);
    };

    const frame = (now: number) => {
      const t = reduced ? 10 : (now - start) / 1000;
      const clock = now / 1000;

      rigs.forEach(({ rig, side, delay, bubble, bubbleAt }, i) => {
        let p: Pose;
        let sx = 1;
        let sy = 1;
        let hop = 0;
        let twirl = 0;
        let bubbleK = 0;
        let bubbleA = 0;
        const u = t - delay;

        if (stage === "pop") {
          const target = popPose(side);
          const off = offPose(side, target);
          const k = spring(u);
          p = { ...target, x: lerp(off.x, target.x, k) };
          const air = 0.42;
          if (u > 0 && u < air) {
            const a = u / air;
            hop = Math.sin(Math.PI * a) * 0.9 * L.s;
            sx = 0.94;
            sy = 1.08;
            twirl = -side * Math.PI * 2 * easeOutCubic(a);
            p.rz = side * 0.35 * (1 - a);
          } else if (u >= air) {
            const d = u - air;
            const sq = Math.exp(-7 * d) * Math.cos(16 * d);
            sy = 1 - 0.24 * sq;
            sx = 1 + 0.16 * sq;
          }
          bubbleK = easeOutBack((u - bubbleAt) / 0.28);
          bubbleA = clamp01((u - bubbleAt) / 0.12);
        } else {
          const target = peekPose(side);
          const k = easeOutBack(t / 0.6);
          const f = from[i];
          p = {
            x: lerp(f.x, target.x, k),
            y: lerp(f.y, target.y, k),
            s: lerp(f.s, target.s, clamp01(k)),
            rz: lerp(f.rz, target.rz, k),
            ry: lerp(f.ry, target.ry, k),
          };
          // Speech bubbles shrink away as the reveal comes in.
          bubbleK = 1 - easeOutCubic(t / 0.25);
          bubbleA = peekFromPop ? clamp01(1 - t / 0.25) : 0;
        }

        // Idle life: bob, wiggle, flapping arms.
        const settle = reduced ? 1 : clamp01((u - 0.45) / 0.3);
        const ph = i * 1.7;
        const bob = reduced ? 0 : Math.abs(Math.sin(clock * 5.2 + ph)) * 0.07 * p.s * settle;
        const wiggle = reduced ? 0 : Math.sin(clock * 4.4 + ph) * 0.09 * settle;

        rig.root.position.set(p.x, p.y + hop + bob, 0);
        rig.root.rotation.set(0.1, p.ry + twirl, p.rz + wiggle);
        rig.root.scale.set(p.s * sx, p.s * sy, p.s * sx);
        last[i] = p;

        // Arms: the bottle holds up a "wait!" hand, the box waves.
        const wave = reduced ? 0 : Math.sin(clock * 14 + ph);
        const inner = side < 0 ? rig.armR : rig.armL;
        const outer = side < 0 ? rig.armL : rig.armR;
        const s = side < 0 ? 1 : -1; // + rotates the inner arm upward
        inner.rotation.z = s * (2.45 + 0.25 * wave * settle) * settle + s * 0.5 * (1 - settle);
        outer.rotation.z = -s * (0.55 + (reduced ? 0 : 0.15 * Math.sin(clock * 6 + ph)));

        if (rig.flapL && rig.flapR) {
          const flap = reduced ? 0 : Math.sin(clock * 9) * 0.22;
          rig.flapL.rotation.z = 0.6 + flap;
          rig.flapR.rotation.z = -0.6 - flap;
        }

        // Spirit flame: beside the bottle's cap (outer side), rising out of the open box.
        const wt = clock * 2.2 + ph;
        if (i === 0) rig.wisp.position.set(side * 0.86 + Math.sin(wt) * 0.06, 1.5 + Math.sin(wt * 1.3) * 0.1, -0.1);
        else rig.wisp.position.set(side * 0.42 + Math.sin(wt) * 0.08, 1.72 +Math.abs(Math.sin(wt * 1.4)) * 0.16, -0.15);
        rig.wisp.rotation.z = Math.sin(wt * 1.1) * 0.25;

        // Eyes: the box winks after it lands, both blink now and then.
        const winkWindow = stage === "pop" ? u > 0.85 && u < 1.35 : t > 0.7 && t < 1.15;
        const wink = i === 1 && winkWindow && !reduced;
        const blinkPhase = (clock + i * 0.9) % 2.8;
        const blink = !reduced && blinkPhase < 0.12 ? 0.12 : 1;
        rig.eyeL.scale.y = wink ? 1 : blink;
        rig.eyeR.scale.y = blink;
        const winkMat = rig.eyeL.material as THREE.MeshBasicMaterial;
        const want = wink ? rig.closedEye : rig.openEye;
        if (winkMat.map !== want) {
          winkMat.map = want;
          winkMat.needsUpdate = true;
        }

        rig.root.updateMatrixWorld();
        placeBubble(bubble, rig, side, bubbleK, bubbleA);
      });

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
          const p = peekFromPop ? last[i] : null;
          from[i] = p ? { ...p } : offPose(side, peekPose(side));
        });
      }
      if (next === "pop") last.fill(null);
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
        まって〜！
        <Tail />
      </div>
      <div ref={bubbleR} className={BUBBLE} style={{ borderColor: INK, color: INK }}>
        それ、作れるよ！
        <Tail />
      </div>
    </div>
  );
}

function Tail() {
  return (
    <span
      className="absolute -bottom-[11px] h-5 w-5 -translate-x-1/2 rotate-45 border-b-[3px] border-r-[3px] bg-white"
      style={{ left: "var(--tail, 50%)", borderColor: INK }}
    />
  );
}
