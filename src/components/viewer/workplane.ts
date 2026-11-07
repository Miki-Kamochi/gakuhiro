import * as THREE from "three";

/** Width of the ruler band around the grid, in cm. */
const MARGIN = 3;

const vertexShader = /* glsl */ `
  varying vec2 vP;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vP = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Anti-aliased procedural grid (1cm minor, 5cm major) so it stays crisp at any zoom.
const fragmentShader = /* glsl */ `
  uniform vec2 uCenter;
  uniform float uHalf;
  uniform float uOuter;
  uniform vec3 uBase;
  uniform vec3 uBand;
  uniform vec3 uMinor;
  uniform vec3 uMajor;
  uniform vec3 uBorder;
  uniform sampler2D uMap;
  varying vec2 vP;

  float gridLine(vec2 p, float spacing, float width) {
    vec2 q = p / spacing;
    vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
    return 1.0 - min(min(g.x, g.y) / width, 1.0);
  }

  void main() {
    vec2 d = vP - uCenter;
    float box = max(abs(d.x), abs(d.y));
    float inside = step(box, uHalf);
    vec2 fw = fwidth(vP);
    float density = max(fw.x, fw.y);

    vec3 c = mix(uBand, uBase, inside);
    float minor = gridLine(vP, 1.0, 1.0) * (1.0 - smoothstep(0.1, 0.28, density));
    float major = gridLine(vP, 5.0, 1.25);
    c = mix(c, uMinor, minor * inside);
    c = mix(c, uMajor, major * inside);

    float edge = abs(box - uHalf) / density;
    c = mix(c, uBorder, 1.0 - min(edge / 1.25, 1.0));

    vec2 uv = vec2((d.x + uOuter) / (2.0 * uOuter), 1.0 - (d.y + uOuter) / (2.0 * uOuter));
    vec4 t = texture2D(uMap, uv);
    c = mix(c, t.rgb, t.a);

    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * A dark, cutting-mat style workplane: a cm grid, a ruler band with cm numbers
 * along the front and left edges, and a shadow catcher on top.
 */
export class Workplane {
  readonly group = new THREE.Group();
  private mat: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  private texture: THREE.CanvasTexture | null = null;
  private key = "";
  private maxAnisotropy: number;

  constructor(maxAnisotropy: number) {
    this.maxAnisotropy = maxAnisotropy;
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uCenter: { value: new THREE.Vector2() },
        uHalf: { value: 15 },
        uOuter: { value: 15 + MARGIN },
        uBase: { value: new THREE.Color("#0e0e0f") },
        uBand: { value: new THREE.Color("#161617") },
        uMinor: { value: new THREE.Color("#1f1f21") },
        uMajor: { value: new THREE.Color("#323235") },
        uBorder: { value: new THREE.Color("#505054") },
        uMap: { value: null },
      },
    });
    this.mat = new THREE.Mesh(geometry, material);
    this.mat.renderOrder = -2;
    this.group.add(this.mat);

    const shadowGeometry = new THREE.PlaneGeometry(1, 1);
    shadowGeometry.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(
      shadowGeometry,
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.6, depthWrite: false }),
    );
    this.shadow.position.y = 0.02;
    this.shadow.receiveShadow = true;
    this.shadow.renderOrder = -1;
    this.group.add(this.shadow);
  }

  /** Centre (snapped to 5cm), half-size of the grid area (multiple of 5cm) and ground height. */
  setExtent(cx: number, cz: number, half: number, groundY: number) {
    const key = `${cx}|${cz}|${half}`;
    this.group.position.y = groundY;
    if (key === this.key) return;
    this.key = key;
    const outer = half + MARGIN;
    const u = this.mat.material.uniforms;
    (u.uCenter.value as THREE.Vector2).set(cx, cz);
    u.uHalf.value = half;
    u.uOuter.value = outer;
    this.mat.position.set(cx, 0, cz);
    this.mat.scale.set(outer * 2, 1, outer * 2);
    this.shadow.position.set(cx, 0.02, cz);
    this.shadow.scale.set(outer * 2, 1, outer * 2);

    this.texture?.dispose();
    this.texture = this.rulerTexture(half, outer);
    u.uMap.value = this.texture;
  }

  /** Cm numbers and ticks along the front (+z) and left (-x) bands, like a cutting mat. */
  private rulerTexture(half: number, outer: number): THREE.CanvasTexture {
    const span = outer * 2;
    const ppc = Math.max(8, Math.min(40, Math.floor(2048 / span))); // pixels per cm
    const size = Math.ceil(span * ppc);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext("2d")!;
    // Canvas (0,0) = back-left corner of the mat; +x right, +y towards the viewer (front).
    const px = (cmFromLeft: number) => cmFromLeft * ppc;
    const left = MARGIN; // grid starts here (cm from mat edge)
    const front = MARGIN + half * 2; // front edge of grid
    const step = half * 2 <= 50 ? 5 : 10;

    g.strokeStyle = "rgba(150,150,155,0.55)";
    g.lineWidth = Math.max(1, ppc * 0.06);
    g.beginPath();
    for (let i = 0; i <= half * 2; i++) {
      const len = i % step === 0 ? 0.8 : i % 5 === 0 ? 0.55 : 0.3;
      // front band ticks (pointing out from the grid edge)
      g.moveTo(px(left + i), px(front));
      g.lineTo(px(left + i), px(front + len));
      // left band ticks
      g.moveTo(px(left), px(front - i));
      g.lineTo(px(left - len), px(front - i));
    }
    g.stroke();

    g.fillStyle = "rgba(170,170,176,0.9)";
    g.font = `500 ${Math.round(ppc * 0.95)}px ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;
    g.textBaseline = "middle";
    for (let i = 0; i <= half * 2; i += step) {
      g.textAlign = "center";
      g.fillText(String(i), px(left + i), px(front + 1.85));
      if (i === 0) continue;
      g.textAlign = "right";
      g.fillText(String(i), px(left - 1.0), px(front - i));
    }
    g.textAlign = "left";
    g.fillStyle = "rgba(170,170,176,0.7)";
    g.font = `500 ${Math.round(ppc * 0.8)}px ui-sans-serif, system-ui, sans-serif`;
    g.fillText("cm", px(left + half * 2 + 0.6), px(front + 1.85));

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.maxAnisotropy;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    return texture;
  }

  /** AR: hide the cutting mat so the camera image shows through; keep the contact shadow. */
  setFloorVisible(visible: boolean) {
    this.mat.visible = visible;
    this.shadow.material.opacity = visible ? 0.6 : 0.42;
  }

  dispose() {
    this.texture?.dispose();
    this.mat.geometry.dispose();
    this.mat.material.dispose();
    this.shadow.geometry.dispose();
    this.shadow.material.dispose();
  }
}
