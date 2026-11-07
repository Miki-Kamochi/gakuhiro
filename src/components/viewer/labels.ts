import * as THREE from "three";

/**
 * Lightweight HTML labels pinned to 3D points (like CSS2DRenderer), plus
 * screen-space de-cluttering: when labels overlap, the higher-priority one wins
 * and the other fades out.
 */
export type Label = {
  el: HTMLDivElement;
  /** World-space anchor; owners update it every frame. */
  world: THREE.Vector3;
  /** Set by the owner each frame: should this label be shown at all? */
  want: boolean;
  /** Lower = more important. */
  priority: number;
  /** Where the anchor sits on the element: 1 = bottom edge (label above point), 0.5 = centered. */
  anchorY: number;
  // Internal state.
  shown: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
};

const _v = new THREE.Vector3();
const byPriority = (a: Label, b: Label) => a.priority - b.priority || a.depth - b.depth;

export class LabelLayer {
  readonly root: HTMLDivElement;
  private labels: Label[] = [];
  private active: Label[] = [];
  private placed: Label[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "absolute",
      inset: "0",
      overflow: "hidden",
      pointerEvents: "none",
      userSelect: "none",
    });
    parent.appendChild(this.root);
    // Widths measured before web fonts load are slightly off; re-measure once they're in.
    document.fonts?.ready.then(() => {
      for (const l of this.labels) l.w = 0;
    });
  }

  add(el: HTMLDivElement, priority = 1, anchorY = 1): Label {
    el.style.position = "absolute";
    el.style.left = "0";
    el.style.top = "0";
    el.style.opacity = "0";
    el.style.transition = "opacity 180ms ease-out";
    el.style.willChange = "transform, opacity";
    this.root.appendChild(el);
    const label: Label = {
      el,
      world: new THREE.Vector3(),
      want: false,
      priority,
      anchorY,
      shown: false,
      x: -1e4,
      y: -1e4,
      w: 0,
      h: 0,
      depth: 0,
    };
    this.labels.push(label);
    return label;
  }

  remove(label: Label) {
    const i = this.labels.indexOf(label);
    if (i >= 0) this.labels.splice(i, 1);
    label.el.remove();
  }

  /** Re-measure on next show (e.g. after the text changed or fonts loaded). */
  invalidate(label: Label) {
    label.w = 0;
  }

  update(camera: THREE.Camera, width: number, height: number) {
    const active = this.active;
    active.length = 0;
    for (const l of this.labels) {
      if (!l.want) {
        this.setShown(l, false);
        continue;
      }
      _v.copy(l.world).project(camera);
      if (_v.z > 1 || _v.z < -1) {
        this.setShown(l, false);
        continue;
      }
      if (l.w === 0) {
        l.w = l.el.offsetWidth;
        l.h = l.el.offsetHeight;
      }
      const x = Math.round((_v.x * 0.5 + 0.5) * width * 2) / 2;
      const y = Math.round((-_v.y * 0.5 + 0.5) * height * 2) / 2;
      if (x !== l.x || y !== l.y) {
        l.x = x;
        l.y = y;
        l.el.style.transform = `translate3d(${x - l.w / 2}px,${y - l.h * l.anchorY}px,0)`;
      }
      l.depth = _v.z;
      active.push(l);
    }

    // Greedy de-clutter: most important first, skip anything that overlaps.
    active.sort(byPriority);
    const placed = this.placed;
    placed.length = 0;
    const pad = 3;
    for (const l of active) {
      const top = l.y - l.h * l.anchorY;
      let ok = l.x > -l.w && l.x < width + l.w && top > -l.h && top < height;
      for (let i = 0; ok && i < placed.length; i++) {
        const o = placed[i];
        const otop = o.y - o.h * o.anchorY;
        if (
          Math.abs(l.x - o.x) * 2 < l.w + o.w + pad * 2 &&
          top < otop + o.h + pad &&
          otop < top + l.h + pad
        ) {
          ok = false;
        }
      }
      if (ok) placed.push(l);
      this.setShown(l, ok);
    }
  }

  private setShown(l: Label, shown: boolean) {
    if (l.shown === shown) return;
    l.shown = shown;
    l.el.style.opacity = shown ? "1" : "0";
  }

  dispose() {
    for (const l of this.labels) l.el.remove();
    this.labels.length = 0;
    this.root.remove();
  }
}
