"use client";

import { useEffect, useRef, useState } from "react";
import type { Part } from "@/lib/blueprint";
import { ViewerEngine, type ViewName } from "./viewer/engine";

export type ViewerProps = {
  parts: Part[];
  /** 1..N = building step N, N+1 = finished. */
  step: number;
  exploded: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /**
   * The AI is still streaming parts in. Every part is shown solid and each new
   * part pops in where it belongs; the camera re-frames as the model grows.
   */
  building?: boolean;
  /** Show the view buttons / hints overlay. Default true. */
  controls?: boolean;
  /** AR: transparent background (a camera feed sits behind), no floor, Shift+drag moves the model. */
  ar?: boolean;
};

const VIEW_BUTTONS: { view: ViewName; label: string; title: string }[] = [
  { view: "front", label: "正面", title: "正面から見る" },
  { view: "side", label: "横", title: "横から見る" },
  { view: "top", label: "上", title: "上から見る" },
  { view: "iso", label: "斜め", title: "斜めから見る" },
];

/** Tiny isometric cube with the face you'll be looking at highlighted. */
function CubeIcon({ view }: { view: ViewName }) {
  const on = "rgba(255,255,255,0.95)";
  const off = "rgba(255,255,255,0.14)";
  const top = view === "top" || view === "iso" ? on : off;
  const front = view === "front" || view === "iso" ? on : off;
  const side = view === "side" || view === "iso" ? on : off;
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden className="block">
      <g stroke="rgba(255,255,255,0.7)" strokeWidth="1" strokeLinejoin="round">
        <path d="M12 3 L20 7.5 L12 12 L4 7.5 Z" fill={top} fillOpacity={view === "iso" ? 0.55 : 1} />
        <path d="M4 7.5 L12 12 L12 21 L4 16.5 Z" fill={front} fillOpacity={view === "iso" ? 0.85 : 1} />
        <path d="M12 12 L20 7.5 L20 16.5 L12 21 Z" fill={side} fillOpacity={view === "iso" ? 0.3 : 1} />
      </g>
    </svg>
  );
}

/**
 * Tinkercad-style 3D viewer on a dark cutting-mat workplane.
 *
 * - Parts from finished steps are solid. Parts of the current step fly in along
 *   a dashed guide to a dashed "goes here" outline and snap into place, on a loop.
 *   Future parts are faint ghosts. Labels show the current step's parts.
 * - Click a part to select it: it gets a white outline and width / height /
 *   depth callouts in cm. Hover shows its name.
 * - `exploded` spreads every part apart and labels them.
 * - `building`: parts stream in and pop into place without rebuilding the scene.
 */
export default function Viewer3D({
  parts,
  step,
  exploded,
  selectedId,
  onSelect,
  building = false,
  controls = true,
  ar = false,
}: ViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ViewerEngine | null>(null);
  const onSelectRef = useRef(onSelect);
  const [view, setView] = useState<ViewName | null>("iso");
  const [touched, setTouched] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let engine: ViewerEngine;
    try {
      engine = new ViewerEngine(mount, {
        onSelect: (id) => onSelectRef.current(id),
        onInteract: () => {
          setView(null);
          setTouched(true);
        },
      });
    } catch {
      // No WebGL (old device, disabled GPU): the step list still works without the model.
      const id = setTimeout(() => setFailed(true));
      return () => clearTimeout(id);
    }
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // State first so the engine knows whether it's building when the first parts arrive.
  useEffect(() => {
    engineRef.current?.setState({ step, exploded, selectedId, building });
  }, [step, exploded, selectedId, building]);

  useEffect(() => {
    engineRef.current?.setParts(parts);
  }, [parts]);

  // AR mode on/off. The offset (Shift+drag) starts centred each time.
  const offset = useRef({ x: 0, y: 0 });
  useEffect(() => {
    offset.current = { x: 0, y: 0 };
    engineRef.current?.setAR(ar);
  }, [ar]);

  /** AR: Shift+drag (or right-drag) slides the model over the camera image. Runs before the orbit controls. */
  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (!ar || !(e.shiftKey || e.button === 2)) return;
    e.stopPropagation();
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, ox: offset.current.x, oy: offset.current.y };
    const move = (ev: PointerEvent) => {
      offset.current = { x: start.ox + ev.clientX - start.x, y: start.oy + ev.clientY - start.y };
      engineRef.current?.setScreenOffset(offset.current.x, offset.current.y);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const goto = (v: ViewName) => {
    engineRef.current?.setView(v);
    setView(v);
  };
  const reset = () => {
    engineRef.current?.resetView();
    setView("iso");
  };

  const showHint = controls && !ar && !building && !touched && selectedId === null && parts.length > 0;

  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black px-8 text-center text-sm text-white/55">
        この端末では3D表示を使えません。手順と部品リストで作り方を確認できます。
      </div>
    );
  }
  return (
    <div
      className={`relative h-full w-full overflow-hidden ${ar ? "" : "bg-black"}`}
      style={ar ? undefined : { background: "radial-gradient(120% 95% at 50% 38%, #121212 0%, #060606 55%, #000 100%)" }}
    >
      <div
        ref={mountRef}
        onPointerDownCapture={onPointerDownCapture}
        onContextMenu={ar ? (e) => e.preventDefault() : undefined}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
      />

      {controls && (
        <div className="font-pop absolute right-3 top-1/2 flex -translate-y-1/2 flex-col gap-0.5 rounded-xl border border-white/10 bg-[#0a0a0a]/85 p-1 text-white shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur">
          {VIEW_BUTTONS.map((b) => (
            <button
              key={b.view}
              type="button"
              title={b.title}
              aria-label={b.title}
              aria-pressed={view === b.view}
              onClick={() => goto(b.view)}
              className={`flex w-[52px] flex-col items-center gap-1 whitespace-nowrap rounded-lg px-1 pb-1.5 pt-1.5 text-[10px] leading-none transition ${
                view === b.view ? "bg-white/15 text-white" : "text-white/55 hover:bg-white/[0.07] hover:text-white"
              }`}
            >
              <CubeIcon view={b.view} />
              {b.label}
            </button>
          ))}
          <div className="mx-2 my-0.5 h-px bg-white/10" />
          <button
            type="button"
            title="全体が見えるように戻す"
            aria-label="視点をリセット"
            onClick={reset}
            className="flex w-[52px] flex-col items-center gap-1 whitespace-nowrap rounded-lg px-1 pb-1.5 pt-1.5 text-[10px] leading-none text-white/55 transition hover:bg-white/[0.07] hover:text-white"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="block">
              <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
              <path d="M4.5 4.5v3.2h3.2" />
              <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
            </svg>
            リセット
          </button>
        </div>
      )}

      {controls && building && (
        <div className="font-pop pointer-events-none absolute bottom-[76px] left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-white/10 bg-[#0a0a0a]/85 px-3.5 py-1.5 text-xs text-white/80 backdrop-blur">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
          </span>
          部品を組み立て中
          <span className="tabular-nums text-white/45">{parts.length} 個</span>
        </div>
      )}

      {showHint && (
        <div className="font-pop pointer-events-none absolute bottom-[76px] left-1/2 hidden -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full border border-white/10 bg-[#0a0a0a]/80 px-3.5 py-1.5 text-[11px] text-white/55 backdrop-blur sm:flex">
          <span>ドラッグで回す</span>
          <span className="h-3 w-px bg-white/15" />
          <span>スクロールで拡大</span>
          <span className="h-3 w-px bg-white/15" />
          <span>部品をクリックでサイズ表示</span>
        </div>
      )}
    </div>
  );
}
