"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Part } from "@/lib/blueprint";

const DEG = Math.PI / 180;

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

type Built = { part: Part; mesh: THREE.Mesh; edges: THREE.LineSegments };

/**
 * Renders the AI's primitive-based blueprint. Parts from finished steps are solid,
 * parts from the current step glow, and future parts are faint wireframe ghosts.
 */
export default function Viewer3D({ parts, step }: { parts: Part[]; step: number }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const builtRef = useRef<Built[]>([]);
  const stepRef = useRef(step);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(30, 50, 40);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fb4ff, 0.8);
    rim.position.set(-40, 20, -30);
    scene.add(rim);

    const group = new THREE.Group();
    scene.add(group);

    builtRef.current = parts.map((part) => {
      const geometry = geometryFor(part);
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: part.color, roughness: 0.55, metalness: 0.05, transparent: true }),
      );
      mesh.position.set(part.position.x, part.position.y, part.position.z);
      mesh.rotation.set(part.rotation.x * DEG, part.rotation.y * DEG, part.rotation.z * DEG);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 25),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true }),
      );
      mesh.add(edges);
      group.add(mesh);
      return { part, mesh, edges };
    });

    // Fit the camera to the model.
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 1);

    const grid = new THREE.GridHelper(radius * 6, 24, 0x3a3a3a, 0x1c1c1c);
    grid.position.y = box.min.y;
    scene.add(grid);

    camera.position.set(center.x + radius * 2.2, center.y + radius * 1.3, center.z + radius * 2.6);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
    controls.update();

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    let frame = 0;
    const clock = new THREE.Clock();
    const tick = () => {
      const t = clock.getElapsedTime();
      for (const { part, mesh, edges } of builtRef.current) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const line = edges.material as THREE.LineBasicMaterial;
        const s = stepRef.current;
        if (part.step < s) {
          mat.opacity = 1;
          mat.emissive.setHex(0x000000);
          line.opacity = 0.18;
          mat.wireframe = false;
        } else if (part.step === s) {
          const pulse = 0.5 + 0.5 * Math.sin(t * 3);
          mat.opacity = 1;
          mat.wireframe = false;
          mat.emissive.set(part.color).multiplyScalar(0.25 + 0.25 * pulse);
          line.opacity = 0.6 + 0.4 * pulse;
        } else {
          mat.opacity = 0.04;
          mat.wireframe = false;
          mat.emissive.setHex(0x000000);
          line.opacity = 0.12;
        }
        mat.depthWrite = part.step <= s;
      }
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      for (const { mesh, edges } of builtRef.current) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        edges.geometry.dispose();
        (edges.material as THREE.Material).dispose();
      }
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [parts]);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  return <div ref={mountRef} className="h-full w-full cursor-grab active:cursor-grabbing" />;
}
