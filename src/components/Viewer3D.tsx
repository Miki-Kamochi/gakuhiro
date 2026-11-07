"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Part } from "@/lib/blueprint";

const DEG = Math.PI / 180;
const ESPRESSO = 0x261311;
const EMERALD = new THREE.Color("#1c3934");
const AMBER = new THREE.Color("#ba6a36");

function geometryFor(part: Part): THREE.BufferGeometry {
  const { x, y, z } = part.size;
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
  }
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

type Built = {
  part: Part;
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  home: THREE.Vector3;
  /** Direction the part flies in from (away from the model's center). */
  away: THREE.Vector3;
};

export type ViewerProps = {
  parts: Part[];
  /** 1..N = building step N, N+1 = finished. */
  step: number;
  exploded: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

/**
 * Parts from finished steps are solid. Parts from the current step fly in from
 * outside and snap into place on a loop, so you can see how they fit together.
 * Future parts are faint ghosts. "exploded" spreads every part apart.
 */
export default function Viewer3D({ parts, step, exploded, selectedId, onSelect }: ViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const state = useRef({ step, exploded, selectedId, stepStart: -1 });
  const [failed, setFailed] = useState(false);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const s = state.current;
    if (s.step !== step) s.stepStart = performance.now() / 1000;
    s.step = step;
    s.exploded = exploded;
    s.selectedId = selectedId;
  }, [step, exploded, selectedId]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      // No WebGL (old device, disabled GPU): the step list still works without the model.
      const id = setTimeout(() => setFailed(true));
      return () => clearTimeout(id);
    }
    if (state.current.stepStart < 0) state.current.stepStart = performance.now() / 1000;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xfff6f2, 0xe6c8b7, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(30, 50, 40);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 6;
    key.shadow.bias = -0.0005;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffe0cc, 0.5);
    fill.position.set(-40, 20, -30);
    scene.add(fill);

    const group = new THREE.Group();
    scene.add(group);

    const meshes: Built[] = parts.map((part) => {
      const geometry = geometryFor(part);
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: part.color, roughness: 0.6, metalness: 0.02, transparent: true }),
      );
      const home = new THREE.Vector3(part.position.x, part.position.y, part.position.z);
      mesh.position.copy(home);
      mesh.rotation.set(part.rotation.x * DEG, part.rotation.y * DEG, part.rotation.z * DEG);
      mesh.userData.id = part.id;
      mesh.castShadow = true;
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 25),
        new THREE.LineBasicMaterial({ color: ESPRESSO, transparent: true }),
      );
      mesh.add(edges);
      group.add(mesh);
      return { part, mesh, edges, home, away: new THREE.Vector3() };
    });

    // Fit camera and work out fly-in directions.
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 1);
    for (const b of meshes) {
      const dir = b.home.clone().sub(center);
      dir.y *= 0.6;
      if (dir.lengthSq() < 0.01 * radius * radius) dir.set(0, 1, 0);
      b.away.copy(dir.normalize().add(new THREE.Vector3(0, 0.2, 0)).normalize());
    }

    // Soft contact shadow under the model.
    const shadowCam = key.shadow.camera;
    shadowCam.left = shadowCam.bottom = -radius * 2;
    shadowCam.right = shadowCam.top = radius * 2;
    shadowCam.near = 0.1;
    shadowCam.far = radius * 12;
    key.position.set(center.x + radius * 1.5, center.y + radius * 4, center.z + radius * 2);
    key.target.position.copy(center);
    scene.add(key.target);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 8, radius * 8),
      new THREE.ShadowMaterial({ color: 0x5a2e1a, opacity: 0.16 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(center.x, box.min.y + 0.01, center.z);
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(radius * 6, 24, 0xc3955b, 0xe6c8b7);
    grid.position.y = box.min.y;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.7;
    scene.add(grid);

    camera.position.set(center.x + radius * 2.7, center.y + radius * 1.5, center.z + radius * 3.2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.9;
    controls.update();

    // Click (not drag) to select a part.
    const raycaster = new THREE.Raycaster();
    let down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const visible = meshes.filter((b) => b.part.step <= state.current.step).map((b) => b.mesh);
      const hit = raycaster.intersectObjects(visible, false)[0];
      const id = (hit?.object.userData.id as string | undefined) ?? null;
      onSelectRef.current(id === state.current.selectedId ? null : id);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    // Stop rendering while the viewer is scrolled out of view.
    let visible = true;
    const io = new IntersectionObserver(([entry]) => {
      const was = visible;
      visible = entry.isIntersecting;
      if (visible && !was) frame = requestAnimationFrame(tick);
    });
    io.observe(mount);

    let frame = 0;
    let explode = 0;
    const tmp = new THREE.Vector3();
    const tick = () => {
      const now = performance.now() / 1000;
      const { step: s, exploded: ex, selectedId: sel, stepStart } = state.current;
      explode += ((ex ? 1 : 0) - explode) * 0.08;

      // Assembly loop for the current step: wait, fly in, hold.
      const cycle = 3.4;
      const t = (now - stepStart) % cycle;
      const assemble = ease(THREE.MathUtils.clamp((t - 0.5) / 1.4, 0, 1));
      const pulse = 0.5 + 0.5 * Math.sin(now * 4);

      for (const b of meshes) {
        const mat = b.mesh.material as THREE.MeshStandardMaterial;
        const line = b.edges.material as THREE.LineBasicMaterial;
        const current = b.part.step === s;
        const future = b.part.step > s;
        const selected = sel === b.part.id;
        const dimmed = sel !== null && !selected;

        let fly = explode * radius * 0.4;
        if (current && !ex) fly += (1 - assemble) * radius * 1.1;
        b.mesh.position.copy(tmp.copy(b.away).multiplyScalar(fly).add(b.home));

        if (future) {
          mat.opacity = 0.05;
          line.opacity = 0.12;
        } else {
          mat.opacity = dimmed ? 0.18 : 1;
          line.opacity = dimmed ? 0.08 : current || selected ? 0.9 : 0.25;
        }
        mat.depthWrite = mat.opacity === 1;
        b.mesh.castShadow = !future;

        if (selected) mat.emissive.copy(EMERALD).multiplyScalar(0.6 + 0.4 * pulse);
        else if (current) mat.emissive.copy(AMBER).multiplyScalar(0.15 + 0.2 * pulse * assemble);
        else mat.emissive.setHex(0x000000);
      }
      controls.autoRotate = sel === null;
      controls.update();
      renderer.render(scene, camera);
      if (visible) frame = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      io.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      for (const { mesh, edges } of meshes) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        edges.geometry.dispose();
        (edges.material as THREE.Material).dispose();
      }
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [parts]);

  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center px-8 text-center text-sm text-espresso/55">
        この端末では3D表示を使えません。右側の手順と部品リストで作り方を確認できます。
      </div>
    );
  }
  return <div ref={mountRef} className="h-full w-full cursor-grab active:cursor-grabbing" />;
}
