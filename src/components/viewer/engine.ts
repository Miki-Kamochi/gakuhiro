import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { Part } from "@/lib/blueprint";
import { DEG, cm, dimSpecs, geometryFor, isRound, sanitize, signature, sizeText } from "./geometry";
import { LabelLayer, type Label } from "./labels";
import { Workplane } from "./workplane";

export type ViewName = "front" | "side" | "top" | "iso";

export type ViewerState = {
  /** 1..N = building step N, N+1 = finished. */
  step: number;
  exploded: boolean;
  selectedId: string | null;
  /** Parts are still streaming in: show everything solid and pop new parts in. */
  building: boolean;
};

export type EngineCallbacks = {
  onSelect: (id: string | null) => void;
  /** The user dragged / zoomed the camera themselves. */
  onInteract: () => void;
};

const VIEWS: Record<ViewName, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0.1, 1).normalize(),
  side: new THREE.Vector3(1, 0.1, 0).normalize(),
  top: new THREE.Vector3(0, 1, 0.012).normalize(),
  iso: new THREE.Vector3(1, 0.78, 1.35).normalize(),
};

// Fly-in loop timings (seconds).
const WAIT = 0.55;
const MOVE = 1.15;
const STAGGER = 0.4;
const HOLD = 2.1;
const FADE = 0.28;
const POP = 0.5;
const SNAP = 0.45;

const WHITE = new THREE.Color(0xffffff);

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

type Entry = {
  part: Part;
  sig: string;
  index: number;
  geometry: THREE.BufferGeometry;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  edgeGeometry: THREE.EdgesGeometry;
  fatGeometry: LineSegmentsGeometry;
  edges: LineSegments2;
  edgeBase: THREE.Color;
  ghost: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  ghostLines: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineDashedMaterial>;
  guide: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>;
  arrow: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  label: Label;
  labelSub: HTMLDivElement;
  labelChip: HTMLDivElement;
  labelMode: "full" | "name" | "selected";
  /** World-space extent of the part relative to its centre (rotation applied). */
  ext: THREE.Box3;
  size: number;
  home: THREE.Vector3;
  away: THREE.Vector3;
  start: THREE.Vector3;
  explode: THREE.Vector3;
  flyIndex: number;
  bornAt: number;
  opacity: number;
  hover: number;
};

type Dims = {
  entry: Entry;
  group: THREE.Group;
  lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  labels: { label: Label; local: THREE.Vector3 }[];
};

// Scratch objects (no per-frame allocation).
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _box = new THREE.Box3();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _ndc = new THREE.Vector2();
const _c = new THREE.Color();

export class ViewerEngine {
  private mount: HTMLElement;
  private cb: EngineCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.1, 3000);
  private controls: OrbitControls;
  private envTexture: THREE.Texture;
  private key: THREE.DirectionalLight;
  private rim: THREE.DirectionalLight;
  private workplane: Workplane;
  private labels: LabelLayer;
  private partsGroup = new THREE.Group();
  private fxGroup = new THREE.Group();
  private arrowGeometry = new THREE.ConeGeometry(0.5, 1.4, 20);
  private entries = new Map<string, Entry>();
  private list: Entry[] = [];
  private pickables: THREE.Object3D[] = [];
  private hits: THREE.Intersection[] = [];
  private raycaster = new THREE.Raycaster();
  private dims: Dims | null = null;

  private state: ViewerState = { step: 1, exploded: false, selectedId: null, building: false };
  private stepStart = 0;
  private currentCount = 0;
  private hoverId: string | null = null;

  private center = new THREE.Vector3(0, 8, 0);
  private radius = 15;
  private groundY = 0;
  private explodeT = 0;
  private flyT = 1;

  private framing = { active: false, target: new THREE.Vector3(0, 8, 0), dist: 60, dir: new THREE.Vector3(), turn: false };
  private userMoved = false;
  private spin = true;
  /** Screen-space shift of the rendered image (px), for placing the model over a camera feed. */
  private offsetX = 0;
  private offsetY = 0;
  private hasFramed = false;

  private width = 1;
  private height = 1;
  private running = false;
  private visible = true;
  private raf = 0;
  private last = 0;
  private down = { x: 0, y: 0, t: 0 };
  private resizeObserver: ResizeObserver;
  private intersectionObserver: IntersectionObserver;

  constructor(mount: HTMLElement, cb: EngineCallbacks) {
    this.mount = mount;
    this.cb = cb;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    mount.appendChild(renderer.domElement);
    this.renderer = renderer;

    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.envTexture = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.4;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x202020, 0.35));
    this.key = new THREE.DirectionalLight(0xffffff, 1.25);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.radius = 4;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.04;
    this.scene.add(this.key, this.key.target);
    // Rim light from behind so dark parts still separate from the black background.
    this.rim = new THREE.DirectionalLight(0xdfe8ff, 0.9);
    this.scene.add(this.rim, this.rim.target);

    this.workplane = new Workplane(renderer.capabilities.getMaxAnisotropy());
    this.scene.add(this.workplane.group, this.partsGroup, this.fxGroup);

    this.labels = new LabelLayer(mount);

    const controls = new OrbitControls(this.camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.rotateSpeed = 0.8;
    controls.zoomSpeed = 0.9;
    controls.minDistance = 4;
    controls.maxDistance = 900;
    controls.maxPolarAngle = Math.PI / 2 - 0.01;
    controls.autoRotateSpeed = 0.7;
    controls.addEventListener("start", this.onControlStart);
    this.controls = controls;
    this.camera.position.copy(this.center).addScaledVector(VIEWS.iso, 60);
    controls.target.copy(this.center);
    controls.update();

    this.applyLayout();

    const el = renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerleave", this.onPointerLeave);

    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(mount);
    this.resize();

    // Don't burn GPU when the viewer is scrolled off-screen.
    this.intersectionObserver = new IntersectionObserver((entries) => {
      // Entries can arrive batched (e.g. during a smooth scroll): the last one is current.
      this.visible = entries[entries.length - 1]?.isIntersecting ?? true;
      this.setRunning(this.visible);
    });
    this.intersectionObserver.observe(mount);
    this.setRunning(true);
  }

  // ---------------------------------------------------------------- public API

  setParts(parts: Part[]) {
    const now = performance.now() / 1000;
    const prevCount = this.entries.size;
    const seen = new Set<string>();
    let reused = 0;
    let added = 0;

    parts.forEach((raw, index) => {
      if (!raw || seen.has(raw.id)) return;
      const part = sanitize(raw);
      seen.add(part.id);
      const sig = signature(part);
      const existing = this.entries.get(part.id);
      if (existing && existing.sig === sig) {
        existing.part = part;
        existing.index = index;
        reused++;
        return;
      }
      if (existing) this.removeEntry(existing);
      // Stagger parts that arrive together; the very first load gets a quick cascade.
      const delay = prevCount === 0 && !this.state.building ? index * 0.035 : added * 0.12;
      const entry = this.build(part, index, now + delay);
      this.entries.set(part.id, entry);
      added++;
    });

    for (const entry of [...this.entries.values()]) {
      if (!seen.has(entry.part.id)) this.removeEntry(entry);
    }

    this.list = [...this.entries.values()].sort((a, b) => a.index - b.index);
    const fresh = reused === 0 && prevCount > 0; // a whole new model replaced the old one
    if (fresh || prevCount === 0) {
      this.userMoved = false;
      this.spin = true;
    }
    this.applyLayout();
    this.syncDims();
    if (this.list.length > 0 && (!this.userMoved || fresh)) this.fit(!this.hasFramed || fresh || prevCount === 0);
  }

  setState(next: ViewerState) {
    const prev = this.state;
    if (next.step !== prev.step || next.building !== prev.building) this.stepStart = performance.now() / 1000;
    this.state = { ...next };
    this.countCurrent();
    if (next.selectedId !== prev.selectedId) {
      this.syncDims();
      if (next.selectedId) this.spin = false;
    }
    if (next.exploded !== prev.exploded && this.list.length > 0) this.fit(false, next.exploded);
  }

  setView(view: ViewName) {
    this.framing.dir.copy(VIEWS[view]);
    this.framing.turn = true;
    this.spin = false;
    this.fit(false);
  }

  /** Back to the default angle, re-frame, resume the slow turntable. */
  resetView() {
    this.userMoved = false;
    this.framing.dir.copy(VIEWS.iso);
    this.framing.turn = true;
    this.spin = true;
    this.fit(false);
  }

  /** AR: no floor, no turntable, so the model sits still over the camera image. */
  setAR(on: boolean) {
    this.workplane.setFloorVisible(!on);
    this.spin = on ? false : !this.userMoved;
    if (!on) this.setScreenOffset(0, 0);
    else if (!this.running) this.render(performance.now() / 1000, 0);
  }

  /** Move the rendered model on screen by (dx, dy) px without moving the camera. */
  setScreenOffset(dx: number, dy: number) {
    this.offsetX = dx;
    this.offsetY = dy;
    this.applyProjection();
    if (!this.running) this.render(performance.now() / 1000, 0);
  }

  private applyProjection() {
    const w = Math.max(this.width, 1);
    const h = Math.max(this.height, 1);
    this.camera.aspect = w / h;
    if (this.offsetX || this.offsetY) this.camera.setViewOffset(w, h, -this.offsetX, -this.offsetY, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.setRunning(false);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerleave", this.onPointerLeave);
    this.controls.removeEventListener("start", this.onControlStart);
    this.controls.dispose();
    this.clearDims();
    for (const entry of [...this.entries.values()]) this.removeEntry(entry);
    this.arrowGeometry.dispose();
    this.workplane.dispose();
    this.labels.dispose();
    this.envTexture.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    el.remove();
  }

  // ---------------------------------------------------------------- building

  private build(part: Part, index: number, bornAt: number): Entry {
    const geometry = geometryFor(part);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const size = Math.max(geometry.boundingSphere?.radius ?? 1, 0.3);

    const material = new THREE.MeshStandardMaterial({
      color: part.color,
      roughness: 0.58,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.set(part.rotation.x * DEG, part.rotation.y * DEG, part.rotation.z * DEG);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.id = part.id;
    mesh.visible = false;

    const edgeGeometry = new THREE.EdgesGeometry(geometry, 25);
    const fatGeometry = new LineSegmentsGeometry().fromEdgesGeometry(edgeGeometry);
    const edgeBase = new THREE.Color(part.color).multiplyScalar(0.32);
    const edgeMaterial = new LineMaterial({ color: edgeBase.getHex(), linewidth: 1.5, transparent: true });
    edgeMaterial.resolution.set(this.width, this.height);
    const edges = new LineSegments2(fatGeometry, edgeMaterial);
    edges.raycast = () => {};
    mesh.add(edges);
    this.partsGroup.add(mesh);

    // "Goes here" target outline shown at the destination while the part flies in.
    const dash = THREE.MathUtils.clamp(size * 0.14, 0.25, 1.2);
    const ghost = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }),
    );
    ghost.rotation.copy(mesh.rotation);
    ghost.raycast = () => {};
    ghost.visible = false;
    const ghostLines = new THREE.LineSegments(
      edgeGeometry,
      new THREE.LineDashedMaterial({
        color: 0xffffff,
        dashSize: dash,
        gapSize: dash * 0.7,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      }),
    );
    ghostLines.computeLineDistances();
    ghostLines.renderOrder = 5;
    ghost.add(ghostLines);
    this.fxGroup.add(ghost);

    const guideGeometry = new THREE.BufferGeometry();
    guideGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const guide = new THREE.Line(
      guideGeometry,
      new THREE.LineDashedMaterial({
        color: 0xffffff,
        dashSize: 0.6,
        gapSize: 0.45,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      }),
    );
    guide.renderOrder = 4;
    guide.visible = false;
    guide.raycast = () => {};
    const arrow = new THREE.Mesh(
      this.arrowGeometry,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
    );
    arrow.renderOrder = 4;
    arrow.visible = false;
    arrow.raycast = () => {};
    this.fxGroup.add(guide, arrow);

    // World-space extent (rotation applied) relative to the part's centre.
    _m.makeRotationFromEuler(_e.copy(mesh.rotation));
    const ext = new THREE.Box3().copy(geometry.boundingBox!).applyMatrix4(_m);

    const { el, chip, sub } = this.makePartLabel(part);
    const label = this.labels.add(el, 1, 1);

    return {
      part,
      sig: signature(part),
      index,
      geometry,
      mesh,
      edgeGeometry,
      fatGeometry,
      edges,
      edgeBase,
      ghost,
      ghostLines,
      guide,
      arrow,
      label,
      labelSub: sub,
      labelChip: chip,
      labelMode: "full",
      ext,
      size,
      home: new THREE.Vector3(part.position.x, part.position.y, part.position.z),
      away: new THREE.Vector3(0, 1, 0),
      start: new THREE.Vector3(),
      explode: new THREE.Vector3(),
      flyIndex: 0,
      bornAt,
      opacity: 0,
      hover: 0,
    };
  }

  private makePartLabel(part: Part) {
    const el = document.createElement("div");
    el.className = "font-pop";
    Object.assign(el.style, { display: "flex", flexDirection: "column", alignItems: "center" });
    const chip = document.createElement("div");
    Object.assign(chip.style, {
      padding: "4px 9px 5px",
      borderRadius: "7px",
      background: "rgba(10,10,10,0.86)",
      border: "1px solid rgba(255,255,255,0.16)",
      boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
      textAlign: "center",
      lineHeight: "1.25",
      whiteSpace: "nowrap",
      transition: "border-color 150ms, background 150ms",
    });
    const name = document.createElement("div");
    name.textContent = part.name;
    Object.assign(name.style, { color: "#fff", fontSize: "12px", fontWeight: "600", letterSpacing: "0.02em" });
    const sub = document.createElement("div");
    sub.textContent = sizeText(part);
    Object.assign(sub.style, {
      color: "rgba(255,255,255,0.58)",
      fontSize: "10.5px",
      fontVariantNumeric: "tabular-nums",
      marginTop: "1px",
    });
    chip.append(name, sub);
    const stem = document.createElement("div");
    Object.assign(stem.style, { width: "1px", height: "12px", background: "rgba(255,255,255,0.5)" });
    const dot = document.createElement("div");
    Object.assign(dot.style, {
      width: "5px",
      height: "5px",
      borderRadius: "999px",
      background: "#fff",
      marginBottom: "-2.5px",
      boxShadow: "0 0 0 2px rgba(0,0,0,0.5)",
    });
    el.append(chip, stem, dot);
    return { el, chip, sub };
  }

  private removeEntry(entry: Entry) {
    if (this.dims?.entry === entry) this.clearDims();
    this.entries.delete(entry.part.id);
    this.partsGroup.remove(entry.mesh);
    this.fxGroup.remove(entry.ghost, entry.guide, entry.arrow);
    entry.geometry.dispose();
    entry.mesh.material.dispose();
    entry.edgeGeometry.dispose();
    entry.fatGeometry.dispose();
    (entry.edges.material as LineMaterial).dispose();
    entry.ghost.material.dispose();
    entry.ghostLines.material.dispose();
    entry.guide.geometry.dispose();
    entry.guide.material.dispose();
    entry.arrow.material.dispose();
    this.labels.remove(entry.label);
    if (this.hoverId === entry.part.id) this.hoverId = null;
  }

  /** Model bounds, fly-in paths, exploded offsets, workplane size, lights. */
  private applyLayout() {
    const list = this.list;
    _box.makeEmpty();
    for (const e of list) {
      _box.expandByPoint(_v.copy(e.home).add(e.ext.min));
      _box.expandByPoint(_v.copy(e.home).add(e.ext.max));
    }
    if (_box.isEmpty()) _box.set(_v.set(-6, 0, -6), _v2.set(6, 12, 6));
    _box.getCenter(this.center);
    const r = Math.max(_box.getSize(_v).length() / 2, 6);
    this.radius = r;
    this.groundY = Math.min(0, _box.min.y);

    const stepCounts = new Map<number, number>();
    for (const e of list) {
      e.flyIndex = stepCounts.get(e.part.step) ?? 0;
      stepCounts.set(e.part.step, e.flyIndex + 1);

      // Fly in from the side the part faces (and a bit above); central parts drop from above.
      _v.copy(e.home).sub(this.center);
      _v.y = 0;
      if (_v.length() < r * 0.18) {
        // Central parts: things sitting on the floor slide in from the front, the rest drop in from above.
        if (e.home.y + e.ext.min.y < this.groundY + 1) e.away.set(0.45, 0.12, 1).normalize();
        else e.away.set(0, 1, 0);
      } else e.away.copy(_v.normalize()).add(_v2.set(0, 0.6, 0)).normalize();
      const fly = Math.max(r * 0.65, 6);
      e.start.copy(e.home).addScaledVector(e.away, fly);

      // Exploded: spread from the centre, never through the floor.
      e.explode.copy(e.home).sub(this.center).multiplyScalar(0.8).addScaledVector(e.away, r * 0.28);
      const bottom = e.home.y + e.explode.y + e.ext.min.y;
      if (bottom < this.groundY) e.explode.y += this.groundY - bottom;

      const pos = e.guide.geometry.getAttribute("position") as THREE.BufferAttribute;
      // Stop the guide just short of the part so the arrow tip touches its outline.
      const reach = Math.min(e.size * 0.9 + 0.6, fly * 0.6);
      _v.copy(e.home).addScaledVector(e.away, reach);
      pos.setXYZ(0, e.start.x, e.start.y, e.start.z);
      pos.setXYZ(1, _v.x, _v.y, _v.z);
      pos.needsUpdate = true;
      e.guide.geometry.computeBoundingSphere();
      e.guide.computeLineDistances();
      const dash = THREE.MathUtils.clamp(r * 0.035, 0.35, 1.5);
      e.guide.material.dashSize = dash;
      e.guide.material.gapSize = dash * 0.75;
      e.arrow.position.copy(_v);
      e.arrow.quaternion.setFromUnitVectors(_v2.set(0, 1, 0), _offset.copy(e.away).negate());
      e.arrow.scale.setScalar(THREE.MathUtils.clamp(r * 0.045, 0.5, 2.2));
      e.ghost.position.copy(e.home);
    }

    // Workplane: covers the model and its exploded spread, snapped to 5cm.
    const cx = Math.round(this.center.x / 5) * 5;
    const cz = Math.round(this.center.z / 5) * 5;
    let foot = 6;
    for (const e of list) {
      foot = Math.max(foot, Math.abs(e.home.x + e.ext.max.x - cx), Math.abs(e.home.x + e.ext.min.x - cx));
      foot = Math.max(foot, Math.abs(e.home.z + e.ext.max.z - cz), Math.abs(e.home.z + e.ext.min.z - cz));
    }
    const half = Math.max(15, Math.ceil((foot * 1.4 + 4) / 5) * 5);
    this.workplane.setExtent(cx, cz, half, this.groundY);

    // Lights follow the model so the shadow map stays tight.
    const span = half * 1.45;
    this.key.position.copy(this.center).add(_v.set(span * 0.7, span * 1.6, span * 0.9));
    this.key.target.position.copy(this.center);
    const sc = this.key.shadow.camera;
    sc.left = -span;
    sc.right = span;
    sc.top = span;
    sc.bottom = -span;
    sc.near = 0.5;
    sc.far = span * 5;
    sc.updateProjectionMatrix();
    this.rim.position.copy(this.center).add(_v.set(-span, span * 0.8, -span * 1.2));
    this.rim.target.position.copy(this.center);

    this.countCurrent();
  }

  private countCurrent() {
    let n = 0;
    for (const e of this.list) if (e.part.step === this.state.step) n++;
    this.currentCount = n;
  }

  // ---------------------------------------------------------------- dimensions

  private syncDims() {
    const id = this.state.selectedId;
    const entry = id ? this.entries.get(id) : undefined;
    if (this.dims?.entry === entry) return;
    this.clearDims();
    if (entry) this.buildDims(entry);
  }

  private clearDims() {
    if (!this.dims) return;
    const d = this.dims;
    d.group.removeFromParent();
    d.lines.geometry.dispose();
    d.lines.material.dispose();
    for (const { label } of d.labels) this.labels.remove(label);
    this.dims = null;
  }

  /** Width / height / depth callouts with arrows, in the part's local frame. */
  private buildDims(entry: Entry) {
    const b = entry.geometry.boundingBox!;
    const sx = b.max.x - b.min.x;
    const sy = b.max.y - b.min.y;
    const sz = b.max.z - b.min.z;
    const big = Math.max(sx, sy, sz);
    const o = THREE.MathUtils.clamp(big * 0.14, 0.8, 3);
    const a = THREE.MathUtils.clamp(big * 0.045, 0.25, 0.8);
    const round = isRound(entry.part);
    const pts: number[] = [];
    const seg = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) =>
      pts.push(x1, y1, z1, x2, y2, z2);
    // A double-headed arrow from p to q along a unit axis, with 3D arrowheads.
    const arrow = (p: THREE.Vector3, q: THREE.Vector3, axis: "x" | "y" | "z") => {
      seg(p.x, p.y, p.z, q.x, q.y, q.z);
      const len = p.distanceTo(q);
      const h = Math.min(a, len * 0.3);
      const perps = axis === "y" ? [_v.set(1, 0, 0), _v2.set(0, 0, 1)] : [_v.set(0, 1, 0), axis === "x" ? _v2.set(0, 0, 1) : _v2.set(1, 0, 0)];
      const d = new THREE.Vector3().subVectors(q, p).normalize();
      for (const [end, sign] of [
        [p, 1],
        [q, -1],
      ] as const) {
        for (const u of perps) {
          for (const s of [1, -1]) {
            seg(
              end.x,
              end.y,
              end.z,
              end.x + d.x * h * sign + u.x * h * 0.45 * s,
              end.y + d.y * h * sign + u.y * h * 0.45 * s,
              end.z + d.z * h * sign + u.z * h * 0.45 * s,
            );
          }
        }
      }
    };

    const labels: Dims["labels"] = [];
    const addLabel = (text: string, local: THREE.Vector3) => {
      const el = document.createElement("div");
      el.className = "font-pop";
      el.textContent = text;
      Object.assign(el.style, {
        padding: "2px 7px",
        borderRadius: "999px",
        background: "#fff",
        color: "#000",
        fontSize: "11px",
        fontWeight: "700",
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
        boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
      });
      labels.push({ label: this.labels.add(el, -1, 0.5), local });
    };

    const y0 = b.min.y;
    for (const spec of dimSpecs(entry.part)) {
      if (spec.axis === "x") {
        const z = b.max.z + o;
        seg(b.min.x, y0, b.max.z, b.min.x, y0, z + o * 0.35);
        seg(b.max.x, y0, b.max.z, b.max.x, y0, z + o * 0.35);
        arrow(new THREE.Vector3(b.min.x, y0, z), new THREE.Vector3(b.max.x, y0, z), "x");
        addLabel(`${spec.label} ${cm(sx)}cm`, new THREE.Vector3((b.min.x + b.max.x) / 2, y0, z));
      } else if (spec.axis === "z") {
        const x = b.max.x + o;
        seg(b.max.x, y0, b.min.z, x + o * 0.35, y0, b.min.z);
        seg(b.max.x, y0, b.max.z, x + o * 0.35, y0, b.max.z);
        arrow(new THREE.Vector3(x, y0, b.min.z), new THREE.Vector3(x, y0, b.max.z), "z");
        addLabel(`${spec.label} ${cm(sz)}cm`, new THREE.Vector3(x, y0, (b.min.z + b.max.z) / 2));
      } else {
        const zc = round ? (b.min.z + b.max.z) / 2 : b.max.z;
        const x = b.max.x + o;
        seg(b.max.x, b.min.y, zc, x + o * 0.35, b.min.y, zc);
        seg(b.max.x, b.max.y, zc, x + o * 0.35, b.max.y, zc);
        arrow(new THREE.Vector3(x, b.min.y, zc), new THREE.Vector3(x, b.max.y, zc), "y");
        addLabel(`${spec.label} ${cm(sy)}cm`, new THREE.Vector3(x, (b.min.y + b.max.y) / 2, zc));
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }),
    );
    lines.renderOrder = 10;
    lines.raycast = () => {};
    const group = new THREE.Group();
    group.add(lines);
    entry.mesh.add(group);
    this.dims = { entry, group, lines, labels };
  }

  // ---------------------------------------------------------------- camera

  /** Smoothly frame the model (or snap). Keeps the current viewing direction unless a view was requested. */
  private fit(snap: boolean, exploded = this.state.exploded) {
    _box.makeEmpty();
    for (const e of this.list) {
      const k = exploded ? 1 : 0;
      _v.copy(e.home).addScaledVector(e.explode, k);
      _box.expandByPoint(_v2.copy(_v).add(e.ext.min));
      _box.expandByPoint(_v2.copy(_v).add(e.ext.max));
    }
    if (_box.isEmpty()) return;
    const target = this.framing.target;
    _box.getCenter(target);
    const r = Math.max(_box.getSize(_v).length() / 2, 9);
    const vfov = this.camera.fov * DEG;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    // Leave room for the overlay UI around the edges.
    this.framing.dist = (r / Math.sin(Math.min(vfov, hfov) / 2)) * (exploded ? 1.2 : 1.42);
    this.framing.active = true;
    if (!this.framing.turn) {
      this.framing.dir.copy(this.camera.position).sub(this.controls.target).normalize();
    }
    if (snap) {
      this.controls.target.copy(target);
      const dir = this.hasFramed ? this.framing.dir : VIEWS.iso;
      this.camera.position.copy(target).addScaledVector(dir, this.framing.dist);
      this.framing.active = false;
      this.framing.turn = false;
      this.controls.update();
    }
    this.hasFramed = true;
  }

  private updateFraming(dt: number) {
    const f = this.framing;
    if (!f.active) return;
    const k = 1 - Math.exp(-dt * 4.5);
    _offset.copy(this.camera.position).sub(this.controls.target);
    let dist = _offset.length();
    _offset.divideScalar(dist || 1);
    if (f.turn) {
      if (_offset.dot(f.dir) < -0.9) _offset.y += 0.2;
      _offset.lerp(f.dir, k).normalize();
    }
    dist += (f.dist - dist) * k;
    this.controls.target.lerp(f.target, k);
    this.camera.position.copy(this.controls.target).addScaledVector(_offset, dist);
    const done =
      this.controls.target.distanceToSquared(f.target) < 1e-4 &&
      Math.abs(dist - f.dist) < 0.02 &&
      (!f.turn || _offset.dot(f.dir) > 0.99999);
    if (done) {
      f.active = false;
      f.turn = false;
    }
  }

  // ---------------------------------------------------------------- input

  private onControlStart = () => {
    this.framing.active = false;
    this.framing.turn = false;
    this.userMoved = true;
    this.spin = false;
    this.cb.onInteract();
  };

  private onPointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private onPointerUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) return;
    const id = this.pick(e.clientX, e.clientY);
    this.cb.onSelect(id === this.state.selectedId ? null : id);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (e.buttons !== 0 || e.pointerType === "touch") return;
    const id = this.pick(e.clientX, e.clientY);
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.renderer.domElement.style.cursor = id ? "pointer" : "";
    }
  };

  private onPointerLeave = () => {
    this.hoverId = null;
    this.renderer.domElement.style.cursor = "";
  };

  private pick(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(_ndc, this.camera);
    const p = this.pickables;
    p.length = 0;
    for (const e of this.list) if (e.mesh.visible && e.opacity > 0.5) p.push(e.mesh);
    this.hits.length = 0;
    this.raycaster.intersectObjects(p, false, this.hits);
    return (this.hits[0]?.object.userData.id as string | undefined) ?? null;
  }

  // ---------------------------------------------------------------- loop

  private resize = () => {
    const w = Math.max(this.mount.clientWidth, 1);
    const h = Math.max(this.mount.clientHeight, 1);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h);
    this.applyProjection();
    for (const e of this.list) (e.edges.material as LineMaterial).resolution.set(w, h);
    if (!this.running) this.render(performance.now() / 1000, 0);
  };

  private setRunning(on: boolean) {
    if (on === this.running) return;
    this.running = on;
    if (on) {
      this.last = performance.now() / 1000;
      this.raf = requestAnimationFrame(this.tick);
    } else {
      cancelAnimationFrame(this.raf);
    }
  }

  private tick = () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const now = performance.now() / 1000;
    const dt = Math.min(now - this.last, 0.1);
    this.last = now;
    this.render(now, dt);
  };

  private render(now: number, dt: number) {
    const s = this.state;
    const kFade = 1 - Math.exp(-dt * 9);
    this.explodeT += ((s.exploded ? 1 : 0) - this.explodeT) * (1 - Math.exp(-dt * 5));
    const flyOn = !s.exploded && !s.building && s.selectedId === null ? 1 : 0;
    this.flyT += (flyOn - this.flyT) * (1 - Math.exp(-dt * 6));
    const explode = easeInOut(clamp01(this.explodeT));
    const fly = this.flyT;

    // Assembly loop for the current step.
    const n = Math.max(this.currentCount, 1);
    const cycle = WAIT + MOVE + STAGGER * (n - 1) + HOLD;
    const tc = (now - this.stepStart) % cycle;
    const loopAlpha = Math.min(clamp01(tc / FADE), clamp01((cycle - tc) / FADE));
    const pulse = 0.5 + 0.5 * Math.sin(now * 5);
    const sel = s.selectedId;

    for (const e of this.list) {
      const p = e.part;
      const role = s.building || s.exploded ? "solid" : p.step < s.step ? "done" : p.step === s.step ? "current" : "future";
      const selected = sel === p.id;
      const hovered = this.hoverId === p.id;
      const dimmed = sel !== null && !selected;

      // Pop-in when the part arrives (streaming) or on first load.
      const age = now - e.bornAt;
      if (age < 0) {
        e.mesh.visible = false;
        e.label.want = false;
        e.ghost.visible = e.guide.visible = e.arrow.visible = false;
        continue;
      }
      const popT = clamp01(age / POP);
      const pop = popT >= 1 ? 1 : Math.max(easeOutBack(popT), 0.001);
      const drop = (1 - easeOutCubic(popT)) * THREE.MathUtils.clamp(this.radius * 0.18, 1.5, 6);

      // Fly-in progress (1 = in place).
      let prog = 1;
      let snap = 0;
      if (role === "current") {
        const lt = tc - WAIT - e.flyIndex * STAGGER;
        prog = easeInOut(clamp01(lt / MOVE));
        const since = lt - MOVE;
        if (since >= 0 && since < SNAP) snap = Math.sin((since / SNAP) * Math.PI) * (1 - since / SNAP);
        snap *= fly;
      }
      const awayT = (1 - prog) * fly;

      const m = e.mesh;
      m.visible = true;
      m.position.copy(e.home).addScaledVector(e.explode, explode);
      if (awayT > 0) m.position.addScaledVector(_v.subVectors(e.start, e.home), awayT);
      m.position.y += drop;
      const scale = pop * (1 + 0.07 * snap);
      m.scale.setScalar(scale);

      // Opacity: ghosts for future steps, dim others while one part is selected.
      let target = role === "future" ? 0.07 : dimmed ? 0.2 : 1;
      if (selected) target = 1;
      e.opacity += (target - e.opacity) * kFade;
      if (Math.abs(target - e.opacity) < 0.002) e.opacity = target;
      const loopFade = role === "current" ? 1 - fly * (1 - loopAlpha) : 1;
      const op = e.opacity * loopFade;
      const mat = m.material;
      const transparent = op < 0.995;
      if (mat.transparent !== transparent) {
        mat.transparent = transparent;
        mat.depthWrite = !transparent;
        mat.needsUpdate = true;
      }
      mat.opacity = op;
      m.castShadow = op > 0.6;

      e.hover += ((hovered ? 1 : 0) - e.hover) * kFade;
      const glow = selected ? 0.03 + 0.04 * pulse : 0;
      mat.emissive.copy(WHITE).multiplyScalar(glow + 0.05 * e.hover + 0.25 * snap);

      const edgeMat = e.edges.material as LineMaterial;
      if (role === "future") {
        edgeMat.color.copy(WHITE);
        edgeMat.opacity = 0.12 * loopFade;
      } else {
        _c.copy(e.edgeBase).lerp(WHITE, selected ? 1 : Math.max(0.55 * e.hover, snap));
        edgeMat.color.copy(_c);
        edgeMat.opacity = (dimmed ? 0.2 : 1) * op;
      }
      edgeMat.linewidth = selected ? 2.6 : 1.5;

      // Destination outline + dashed guide while the part is on its way.
      const ghostT = role === "current" ? awayT * loopFade : 0;
      const showGhost = ghostT > 0.01;
      e.ghost.visible = e.guide.visible = e.arrow.visible = showGhost;
      if (showGhost) {
        e.ghost.material.opacity = 0.07 * ghostT;
        e.ghostLines.material.opacity = (0.55 + 0.35 * pulse) * ghostT;
        e.guide.material.opacity = 0.55 * ghostT;
        e.arrow.material.opacity = 0.8 * ghostT;
      }

      // Labels: selected / hovered always; otherwise the current step (or new arrivals, or exploded).
      let want = selected || hovered;
      if (!want && sel === null) {
        if (s.building) want = age < 2.6;
        else if (s.exploded) want = true;
        else want = role === "current" && loopAlpha > 0.5;
      }
      e.label.want = want && pop > 0.5;
      if (want) {
        const mode = selected ? "selected" : s.exploded && !hovered ? "name" : "full";
        if (mode !== e.labelMode) this.setLabelMode(e, mode);
        e.label.priority = selected ? 0 : hovered ? 0.5 : role === "current" ? 1 : 2 - Math.min(e.size / 100, 0.5);
        e.label.world.copy(m.position);
        e.label.world.y += e.ext.max.y * scale + 0.25;
      }
    }

    this.updateDims();
    this.controls.autoRotate = this.spin && sel === null && !this.framing.turn;
    this.updateFraming(dt);
    this.controls.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.labels.update(this.camera, this.width, this.height);
  }

  private setLabelMode(e: Entry, mode: Entry["labelMode"]) {
    e.labelMode = mode;
    e.labelSub.style.display = mode === "name" ? "none" : "";
    e.labelChip.style.borderColor = mode === "selected" ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.16)";
    e.labelChip.style.background = mode === "selected" ? "rgba(0,0,0,0.92)" : "rgba(10,10,10,0.86)";
    this.labels.invalidate(e.label);
  }

  /** Keep the callouts on the camera-facing sides and pin their labels. */
  private updateDims() {
    const d = this.dims;
    if (!d) return;
    const mesh = d.entry.mesh;
    const show = mesh.visible && d.entry.opacity > 0.5;
    d.group.visible = show;
    mesh.updateMatrixWorld();
    _v.copy(this.camera.position);
    mesh.worldToLocal(_v);
    const b = d.entry.geometry.boundingBox!;
    const sx = _v.x < (b.min.x + b.max.x) / 2 ? -1 : 1;
    const sz = _v.z < (b.min.z + b.max.z) / 2 ? -1 : 1;
    d.group.scale.set(sx, 1, sz);
    for (const { label, local } of d.labels) {
      label.want = show;
      label.world.set(local.x * sx, local.y, local.z * sz);
      mesh.localToWorld(label.world);
    }
  }
}
