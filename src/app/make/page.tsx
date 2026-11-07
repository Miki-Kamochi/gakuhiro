"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Blueprint, Part } from "@/lib/blueprint";
import { previewBlueprint, readEvents } from "@/lib/streamBlueprint";
import { MAKE_REQUEST_KEY, MAKE_RESULT_KEY, toJpegBase64, type MakeRequest } from "@/lib/trash";

const Viewer3D = dynamic(() => import("@/components/Viewer3D"), { ssr: false });

/** Problem categories: pick one to fill in an example, then edit freely. */
const CATEGORIES = [
  { label: "植物", text: "旅行に行くと、部屋の植物がすぐ枯れてしまう" },
  { label: "収納", text: "引き出しの中で小物がごちゃごちゃになる" },
  { label: "デスク", text: "机の上のケーブルや充電器が散らかっている" },
  { label: "スマホ", text: "オンライン通話のときにスマホを立てる物がない" },
  { label: "キッチン", text: "キッチンで菜箸やおたまの置き場所がない" },
  { label: "ペット", text: "猫が退屈そうにしている" },
];

const LOADING_LINES = [
  "素材を確認しています",
  "ゴミのサイズを測っています",
  "変身先を考えています",
  "部品と手順を設計中",
  "3Dモデルを組み立て中",
];

export default function MakePage() {
  const [photo, setPhoto] = useState<{ data: string; url: string } | null>(null);
  const [problem, setProblem] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingLine, setLoadingLine] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blueprint: Blueprint; demo: boolean } | null>(null);
  const [step, setStep] = useState(1);
  const [exploded, setExploded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /** Seconds since generation started (live), and the final time. */
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<"steps" | "parts" | "info">("steps");

  // Webcam AR: the camera image behind a transparent 3D view.
  const [ar, setAr] = useState(false);
  const [arError, setArError] = useState<string | null>(null);
  const [mirror, setMirror] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setAr(false);
  }

  async function toggleAR() {
    if (ar) return stopCamera();
    setArError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      setAr(true);
      setExploded(false);
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      setArError(denied ? "カメラの使用が許可されていません" : "カメラを起動できませんでした");
      setTimeout(() => setArError(null), 4000);
    }
  }

  // Attach the stream once the <video> exists; release the camera on leave.
  useEffect(() => {
    if (ar && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [ar]);
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLElement>(null);

  // Arriving from the shop: the product they tried to buy and the trash they have.
  // Generation starts straight away — no form to fill in.
  const [request, setRequest] = useState<MakeRequest | null>(null);
  const wanted = request?.want ?? null;
  // A reload shows the last result again instead of paying for a new generation.
  useEffect(() => {
    let req: MakeRequest | null = null;
    let cached: { blueprint: Blueprint; demo: boolean } | null = null;
    try {
      const raw = sessionStorage.getItem(MAKE_REQUEST_KEY);
      if (raw) req = JSON.parse(raw) as MakeRequest;
      const saved = sessionStorage.getItem(MAKE_RESULT_KEY);
      if (saved) cached = JSON.parse(saved) as { blueprint: Blueprint; demo: boolean };
    } catch {
      /* storage unavailable: fall back to the manual form */
    }
    if (!req && !cached) return;
    // Defer so the server-rendered HTML matches on hydration.
    const id = setTimeout(() => {
      if (req) {
        setRequest(req);
        if (req.photo) setPhoto(req.photo);
      }
      if (cached?.blueprint) {
        setResult(cached);
        setStep(1);
      } else if (req) run(req);
    });
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => setLoadingLine((i) => (i + 1) % LOADING_LINES.length), 1600);
    const start = performance.now();
    const timer = setInterval(() => setElapsed((performance.now() - start) / 1000), 100);
    return () => {
      clearInterval(id);
      clearInterval(timer);
    };
  }, [loading]);

  async function pick(file?: File) {
    if (!file || !file.type.startsWith("image/")) return;
    setError(null);
    try {
      setPhoto(await toJpegBase64(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "写真を読み込めませんでした。");
    }
  }

  /** Manual form (direct visit to /make). */
  function transform() {
    if (!photo) return;
    run({ trash: [], extra: "", photo }, problem);
  }

  async function run(req: MakeRequest, problemText = "") {
    setLoading(true);
    setLoadingLine(0);
    setError(null);
    setResult(null);
    setElapsed(0);
    setExploded(false);
    setSelectedId(null);
    let scrolled = false;
    try {
      const res = await fetch("/api/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: req.photo?.data,
          mediaType: req.photo ? "image/jpeg" : undefined,
          problem: problemText,
          trash: req.trash,
          extra: req.extra,
          want: req.want,
        }),
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "エラーが発生しました。");
      }

      // Show the design as it is being written: title first, then 3D parts one by one.
      let text = "";
      let lastPreview = 0;
      let final = false;
      for await (const ev of readEvents(res)) {
        if (ev.t === "e") throw new Error(ev.error);
        if (ev.t === "reset") text = "";
        if (ev.t === "final") {
          final = true;
          setResult({ blueprint: ev.blueprint, demo: ev.demo });
          try {
            sessionStorage.setItem(MAKE_RESULT_KEY, JSON.stringify({ blueprint: ev.blueprint, demo: ev.demo }));
          } catch {
            /* storage full: the result just won't survive a reload */
          }
          setElapsed(ev.ms / 1000);
          // Show the finished model for a moment, then rewind to step 1 so the build starts from the beginning.
          const done = ev.blueprint.steps.length + 1;
          setStep(done);
          setTimeout(() => setStep((s) => (s === done ? 1 : s)), 2500);
          break;
        }
        if (ev.t !== "d") continue;
        text += ev.d;
        const now = performance.now();
        if (now - lastPreview < 120) continue;
        lastPreview = now;
        const preview = previewBlueprint(text);
        if (!preview) continue;
        setResult({ blueprint: preview, demo: false });
        if (!scrolled) {
          scrolled = true;
          setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
        }
      }
      if (!final) throw new Error("接続が途切れました。もう一度お試しください。");
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  }

  const bp = result?.blueprint;
  /** The design is still streaming in. */
  const building = loading && !!bp;
  const total = bp?.steps.length ?? 0;
  const finished = building || step > total;
  const current = bp && !finished ? bp.steps[step - 1] : null;
  const selected = bp?.parts.find((p) => p.id === selectedId) ?? null;

  const partsBySource = useMemo(() => {
    const groups = new Map<string, Part[]>();
    for (const p of bp?.parts ?? []) groups.set(p.source, [...(groups.get(p.source) ?? []), p]);
    return [...groups.entries()];
  }, [bp]);

  function goToStep(n: number) {
    setStep(Math.max(1, Math.min(total + 1, n)));
    setSelectedId(null);
  }

  // ← / → step through the build.
  useEffect(() => {
    if (!bp || building) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea")) return;
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      setSelectedId(null);
      setStep((s) => Math.max(1, Math.min(total + 1, s + (e.key === "ArrowRight" ? 1 : -1))));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bp, building, total]);

  function regenerate() {
    try {
      sessionStorage.removeItem(MAKE_RESULT_KEY);
    } catch {
      /* ignore */
    }
    if (request) run(request);
    else if (photo) run({ trash: [], extra: "", photo }, problem);
  }

  async function copyInstructions() {
    if (!bp) return;
    const text = [
      bp.title,
      bp.tagline,
      "",
      `難易度 ${bp.difficulty}/5 ・ 約${bp.time_minutes}分`,
      `道具: ${bp.tools.join("、")}`,
      "",
      "【部品】",
      ...bp.parts.map((p) => `・${p.name}（${p.source}）${p.dimensions}`),
      "",
      "【作り方】",
      ...bp.steps.flatMap((s, i) =>
        [`${i + 1}. ${s.title}`, ...s.actions.map((a) => `   - ${a}`), s.caution ? `   ⚠ ${s.caution}` : ""].filter(Boolean),
      ),
      "",
      "化けラボ — いらないものが、使えるものに化ける。",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: nothing useful to show */
    }
  }

  function selectPart(p: Part) {
    if (selectedId === p.id) return setSelectedId(null);
    if (p.step > step) setStep(p.step);
    setSelectedId(p.id);
  }

  return (
    <div className="relative min-h-screen">
      <div className="page-glow pointer-events-none absolute inset-x-0 top-0 h-[520px]" />

      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-line/70 bg-paper/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="text-sm font-medium tracking-[0.35em]">
            <span className="font-brush text-lg tracking-[0.15em]">化けラボ</span>
          </Link>
          <nav className="flex gap-6 text-xs tracking-[0.2em] text-ink/60 sm:gap-8">
            {!bp && <a href="#input" className="transition hover:text-ink">入力</a>}
            <Link href="/" className="transition hover:text-ink">ショップ</Link>
          </nav>
        </div>
      </header>

      {!bp && (
      <main className="relative mx-auto max-w-7xl px-6">
        {/* Motto */}
        {!request && (
        <section className="pb-10 pt-12">
          <p className="mb-4 text-xs tracking-[0.3em] text-ink/50">テーマ — 化ける / TRANSFORM</p>
          <h1 className="font-brush text-4xl leading-tight sm:text-6xl">
            いらないものが、<span className="text-accent">使えるものに</span>化ける。
          </h1>
          <p className="mt-4 max-w-2xl text-sm font-light leading-relaxed text-ink/65">
            いらない物の写真と、困っていることを入れてください。AIが素材を見分けて、役に立つ物に変身させます。部品の切り出し方から組み立てまで、3Dで手順を案内します。
          </p>
        </section>
        )}

        {/* Input */}
        <section id="input" className={request ? "" : "scroll-mt-20 pb-20"}>
          {request && (
            <div className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center py-12">
              <div className="w-full max-w-md text-center">
                <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
                  {request.trash.map((t) => (
                    <span key={t} className="rounded-full border border-line bg-panel px-3 py-1">
                      {t}
                    </span>
                  ))}
                  {request.extra && <span className="rounded-full border border-line bg-panel px-3 py-1">{request.extra}</span>}
                  {request.photo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={request.photo.url} alt="追加したゴミの写真" className="h-9 w-9 rounded-lg object-cover" />
                  )}
                </div>

                {error ? (
                  <div className="mt-10">
                    <p className="text-sm text-ink/70">{error}</p>
                    <button
                      onClick={() => run(request)}
                      className="mt-5 rounded-full bg-accent px-6 py-2.5 text-sm text-paper transition hover:bg-accent/85"
                    >
                      もう一度
                    </button>
                  </div>
                ) : (
                  <div className="mt-10 flex flex-col items-center">
                    <span className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
                    <p className="mt-5 text-base">{LOADING_LINES[loadingLine]}…</p>
                    <p className="mt-1 font-mono text-xs tabular-nums text-ink/40">{elapsed.toFixed(1)}秒</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {!request && (
          <div className="grid gap-5 lg:grid-cols-2">
            {/* Photo */}
            <div className="flex flex-col rounded-lg border border-line bg-panel p-5">
              <Label n="01" text="いらない物の写真" />
              <div
                onClick={() => fileInput.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  pick(e.dataTransfer.files[0]);
                }}
                className={`relative mt-4 flex aspect-[4/3] cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed transition ${
                  dragging ? "border-accent bg-line/40" : "border-dim/50 bg-paper hover:bg-line/25"
                }`}
              >
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo.url} alt="アップロードした写真" className="h-full w-full object-cover" />
                ) : (
                  <div className="px-6 text-center">
                    <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-2xl font-light text-paper">
                      +
                    </div>
                    <p className="text-sm">写真をドロップ、またはクリックして選択</p>
                    <p className="mt-2 text-xs text-ink/50">ペットボトル、段ボール、古着、壊れた物など</p>
                  </div>
                )}
                {loading && <div className="scanline pointer-events-none absolute inset-x-0 h-24" />}
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => pick(e.target.files?.[0])}
                />
              </div>
              {photo && (
                <button
                  onClick={() => fileInput.current?.click()}
                  className="mt-3 self-start text-xs text-ink/55 underline-offset-4 hover:underline"
                >
                  写真を変更する
                </button>
              )}
            </div>

            {/* Problem */}
            <div className="flex flex-col rounded-lg border border-line bg-panel p-5">
              <Label n="02" text="困っていること" />
              <p className="mt-4 text-xs text-ink/55">ジャンルを選ぶか、自由に書いてください（なくてもOK）</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.label}
                    onClick={() => {
                      setCategory(c.label);
                      setProblem(c.text);
                    }}
                    className={`rounded-full border px-4 py-1.5 text-sm transition ${
                      category === c.label
                        ? "border-accent bg-accent text-paper"
                        : "border-line bg-paper text-ink/75 hover:border-dim"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <textarea
                value={problem}
                onChange={(e) => {
                  setProblem(e.target.value);
                  setCategory(null);
                }}
                placeholder="例：旅行に行くと植物が枯れてしまう"
                rows={4}
                className="mt-5 w-full flex-1 resize-none rounded-xl border border-line bg-paper p-4 text-lg font-light leading-relaxed outline-none placeholder:text-ink/30 focus:border-accent"
              />

              {error && <p className="mt-4 text-sm text-accent">{error}</p>}
              <button
                onClick={transform}
                disabled={!photo || loading}
                className="group mt-5 flex h-14 w-full items-center justify-between rounded-full bg-accent px-7 text-base font-medium text-paper transition enabled:hover:bg-accent/85 disabled:cursor-not-allowed disabled:bg-line disabled:text-ink/45"
              >
                <span>{loading ? `${LOADING_LINES[loadingLine]}…` : photo ? "化けさせる" : "まず写真を追加してください"}</span>
                <span className={loading ? "animate-pulse" : "transition group-enabled:group-hover:translate-x-1"}>→</span>
              </button>
            </div>
          </div>
          )}
        </section>

        {/* Output placeholder (before a design exists) */}
        {!request && (
        <section id="output" ref={outputRef} className="scroll-mt-16 border-t border-line pb-24 pt-16">
          <div className="flex aspect-[21/9] items-center justify-center rounded-lg border border-dashed border-dim/50 text-sm text-ink/45">
            ここに3Dの設計図と作り方が表示されます
          </div>
        </section>
        )}
      </main>
      )}

      {/* Studio: the 3D model fills the screen, everything else floats on top of it. */}
      {bp && (
        <section
          ref={outputRef}
          className="relative lg:h-[calc(100dvh-3.5rem)] lg:overflow-hidden"
        >
          {/* Viewer */}
          <div
            className={`relative h-[68vh] min-h-[420px] lg:absolute lg:inset-y-0 lg:right-0 lg:h-auto lg:transition-[left] lg:duration-300 ${
              panelOpen ? "lg:left-[372px]" : "lg:left-0"
            }`}
          >
            {ar && (
              <video
                ref={videoRef}
                muted
                playsInline
                className="absolute inset-0 h-full w-full bg-black object-cover"
                style={mirror ? { transform: "scaleX(-1)" } : undefined}
              />
            )}
            <Viewer3D
              parts={bp.parts}
              step={building ? 999 : step}
              exploded={exploded}
              selectedId={selectedId}
              onSelect={setSelectedId}
              building={building}
              ar={ar}
            />

            {/* AR help + camera error */}
            {ar && (
              <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/10 bg-[#0a0a0a]/80 px-4 py-1.5 text-[11px] text-white/75 backdrop-blur">
                ドラッグで回転 ・ ホイールで大きさ ・ Shift+ドラッグで移動
              </div>
            )}
            {arError && (
              <div className="absolute left-1/2 top-14 -translate-x-1/2 rounded-full bg-white px-4 py-2 text-xs text-black">{arError}</div>
            )}

            {/* Top right: view mode + actions */}
            <div className="absolute right-3 top-3 flex flex-wrap items-center justify-end gap-2">
              {result?.demo && (
                <span className="hidden rounded-full border border-white/10 bg-[#0a0a0a]/80 px-3 py-1.5 text-[11px] text-white/60 backdrop-blur md:inline">
                  デモモード
                </span>
              )}
              <div className="flex overflow-hidden rounded-full border border-white/10 bg-[#0a0a0a]/85 text-xs backdrop-blur">
                <button
                  onClick={toggleAR}
                  title="カメラの映像に3Dを重ねる"
                  className={`flex items-center gap-1.5 px-4 py-2 transition ${ar ? "bg-white text-black" : "text-white/85 hover:bg-white/10"}`}
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M3 8V6a2 2 0 0 1 2-2h2M17 4h2a2 2 0 0 1 2 2v2M21 16v2a2 2 0 0 1-2 2h-2M7 20H5a2 2 0 0 1-2-2v-2" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  {ar ? "AR終了" : "AR"}
                </button>
                {ar && (
                  <button
                    onClick={() => setMirror((m) => !m)}
                    title="映像を左右反転"
                    className="border-l border-white/10 px-3 py-2 text-white/75 transition hover:bg-white/10"
                  >
                    ⇋
                  </button>
                )}
              </div>
              <div className="flex overflow-hidden rounded-full border border-white/10 bg-[#0a0a0a]/85 text-xs backdrop-blur">
                <button
                  onClick={() => setExploded(false)}
                  className={`px-4 py-2 transition ${!exploded ? "bg-white text-black" : "text-white/75 hover:bg-white/10"}`}
                >
                  組み立て
                </button>
                <button
                  onClick={() => setExploded(true)}
                  className={`px-4 py-2 transition ${exploded ? "bg-white text-black" : "text-white/75 hover:bg-white/10"}`}
                >
                  分解図
                </button>
              </div>
              {!building && (
                <div className="flex overflow-hidden rounded-full border border-white/10 bg-[#0a0a0a]/85 text-xs text-white/75 backdrop-blur">
                  <button onClick={copyInstructions} className="px-3.5 py-2 transition hover:bg-white/10" title="作り方をテキストでコピー">
                    {copied ? "コピー済 ✓" : "コピー"}
                  </button>
                  {(request || photo) && (
                    <button onClick={regenerate} className="border-l border-white/10 px-3.5 py-2 transition hover:bg-white/10" title="別の案を出す">
                      別の案 ↻
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Panel toggle when collapsed (desktop) */}
            {!panelOpen && (
              <button
                onClick={() => setPanelOpen(true)}
                title="パネルを開く"
                className="absolute left-3 top-3 hidden max-w-[40%] items-center gap-3 rounded-full border border-white/10 bg-[#0a0a0a]/85 py-2 pl-4 pr-3 text-white/80 backdrop-blur transition hover:border-white/30 hover:text-white lg:flex"
              >
                <span className="font-brush truncate text-base">{bp.title}</span>
                <span className="text-white/45">→</span>
              </button>
            )}

            {/* Current step, compact (desktop, panel closed) */}
            {!panelOpen && !building && current && (
              <div className="absolute bottom-20 left-3 hidden w-80 rounded-2xl border border-white/10 bg-[#0a0a0a]/85 p-4 backdrop-blur lg:block">
                <p className="text-sm font-medium">
                  <span className="mr-2 font-mono text-white/40">{String(step).padStart(2, "0")}</span>
                  {current.title}
                </p>
                <ol className="mt-2.5 space-y-1.5">
                  {current.actions.map((a, i) => (
                    <li key={i} className="flex gap-2 text-xs leading-relaxed text-white/80">
                      <span className="text-white/35">{i + 1}.</span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ol>
                {current.caution && <p className="mt-2.5 text-xs text-amber-200/90">⚠ {current.caution}</p>}
              </div>
            )}

            {/* Selected part */}
            {selected && (
              <div className="absolute right-[76px] top-16 w-[min(18rem,calc(100%-6rem))] rounded-2xl border border-white/15 bg-[#0a0a0a]/90 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur">
                <div className="flex items-start justify-between gap-4">
                  <p className="flex items-center gap-2 font-medium">
                    <span className="h-3 w-3 rounded-sm border border-white/20" style={{ background: selected.color }} />
                    {selected.name}
                  </p>
                  <button onClick={() => setSelectedId(null)} className="text-white/45 hover:text-white" aria-label="閉じる">
                    ×
                  </button>
                </div>
                <p className="mt-1 text-xs text-white/55">
                  {selected.source} ・ {selected.dimensions} ・ 手順{selected.step}
                </p>
                <p className="mt-3 text-sm font-light leading-relaxed text-white/85">{selected.make}</p>
              </div>
            )}

            {/* Bottom: step scrubber */}
            {!building && (
              <div
                className="absolute bottom-3 left-3 right-3 flex items-center gap-2 rounded-full border border-white/10 bg-[#0a0a0a]/85 p-1 backdrop-blur sm:left-1/2 sm:right-auto sm:w-[min(26rem,calc(100%-2rem))] sm:-translate-x-1/2"
              >
                <RoundBtn onClick={() => goToStep(step - 1)} label="前の手順">←</RoundBtn>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-center text-xs text-white/85">
                    <span className="mr-2 font-mono text-white/45">{finished ? "完成" : `${step}/${total}`}</span>
                    {finished ? "化けた！" : current?.title}
                  </p>
                  <div className="mt-1.5 flex gap-1">
                    {Array.from({ length: total + 1 }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => goToStep(i + 1)}
                        aria-label={i === total ? "完成" : `手順 ${i + 1}`}
                        title={i === total ? "完成" : `${i + 1}. ${bp.steps[i]?.title ?? ""}`}
                        className={`h-1.5 flex-1 rounded-full transition ${
                          i + 1 === step ? "bg-white" : i + 1 < step ? "bg-white/55" : "bg-white/15 hover:bg-white/30"
                        }`}
                      />
                    ))}
                  </div>
                </div>
                <RoundBtn onClick={() => goToStep(step + 1)} label="次の手順">→</RoundBtn>
              </div>
            )}
          </div>

          {/* Floating side panel (desktop) / stacked below (mobile) */}
          {panelOpen && (
            <aside className="relative flex flex-col border-t border-white/10 bg-[#0a0a0a] [color-scheme:dark] lg:absolute lg:bottom-0 lg:left-0 lg:top-0 lg:w-[372px] lg:border-r lg:border-t-0">
              {/* Header */}
              <div className="border-b border-white/10 px-5 pb-4 pt-5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h1 className="font-brush line-clamp-2 text-2xl leading-snug" title={bp.tagline}>{bp.title}</h1>
                  </div>
                  <button
                    onClick={() => setPanelOpen(false)}
                    className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white lg:flex"
                    aria-label="パネルを閉じる"
                    title="パネルを閉じて3Dを広く見る"
                  >
                    ←
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-white/50">
                  {wanted && (
                    <span className="flex items-center gap-1.5">
                      <span className="line-through">¥{wanted.price.toLocaleString("ja-JP")}</span>
                      <span className="text-sm font-medium text-white">¥0</span>
                    </span>
                  )}
                  {bp.time_minutes > 0 && <span className="text-white">{Math.round(bp.time_minutes)}分</span>}
                  {bp.difficulty > 0 && (
                    <span className="tracking-[0.1em]" title="難易度">
                      <span className="text-white">{"★".repeat(Math.min(5, Math.max(1, Math.round(bp.difficulty))))}</span>
                      {"★".repeat(5 - Math.min(5, Math.max(1, Math.round(bp.difficulty))))}
                    </span>
                  )}
                  {bp.co2_saved_g > 0 && <span>CO₂ -{Math.round(bp.co2_saved_g).toLocaleString("ja-JP")}g</span>}
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-white/10 px-2 text-sm">
                {(
                  [
                    ["steps", "手順"],
                    ["parts", "部品"],
                    ["info", "道具"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={`relative flex-1 px-2 py-2.5 text-[13px] transition ${tab === id ? "text-white" : "text-white/45 hover:text-white/75"}`}
                  >
                    {label}
                    {tab === id && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-white" />}
                  </button>
                ))}
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]">
                {tab === "steps" && (
                  <>
                    {building ? (
                      <div className="rounded-xl border border-white/10 p-4">
                        <div className="flex items-center gap-3">
                          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/15 border-t-white" />
                          <p className="font-medium">設計中…</p>
                          <span className="ml-auto font-mono text-xs tabular-nums text-white/50">{elapsed.toFixed(1)}秒</span>
                        </div>
                      </div>
                    ) : current ? (
                      <div>
                        <div className="flex items-baseline gap-3">
                          <span className="font-mono text-3xl font-light">{String(step).padStart(2, "0")}</span>
                          <div className="min-w-0">
                            <h2 className="text-lg font-medium leading-snug">{current.title}</h2>
                          </div>
                        </div>
                        <ol className="mt-4 space-y-2.5">
                          {current.actions.map((a, i) => (
                            <li key={i} className="flex gap-3 text-sm leading-relaxed">
                              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px]">
                                {i + 1}
                              </span>
                              <span>{a}</span>
                            </li>
                          ))}
                        </ol>
                        {bp.parts.some((p) => p.step === step) && (
                          <div className="mt-4 flex flex-wrap gap-1.5">
                            {bp.parts
                              .filter((p) => p.step === step)
                              .map((p) => (
                                <button
                                  key={p.id}
                                  onClick={() => selectPart(p)}
                                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                                    selectedId === p.id ? "border-white bg-white text-black" : "border-white/15 hover:border-white/40"
                                  }`}
                                >
                                  {p.name}
                                </button>
                              ))}
                          </div>
                        )}
                        {current.caution && <p className="mt-4 text-xs leading-relaxed text-amber-200/90">⚠ {current.caution}</p>}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-white/10 p-4">
                        <p className="font-medium">完成！</p>
                        <button
                          onClick={() => goToStep(1)}
                          className="mt-4 rounded-full bg-white px-4 py-2 text-xs font-medium text-black transition hover:bg-white/85"
                        >
                          最初から見る →
                        </button>
                      </div>
                    )}

                    <ol className="mt-5 border-t border-white/10 pt-3">
                      {bp.steps.map((st, i) => (
                        <li key={i}>
                          <button
                            onClick={() => goToStep(i + 1)}
                            disabled={building}
                            className={`flex w-full items-baseline gap-3 rounded-lg px-2 py-2 text-left text-sm transition ${
                              !building && step === i + 1 ? "bg-white/10" : "hover:bg-white/[0.05]"
                            } ${!building && i + 1 < step ? "text-white/45" : ""}`}
                          >
                            <span className="font-mono text-[11px] text-white/40">{String(i + 1).padStart(2, "0")}</span>
                            <span className="flex-1">{st.title}</span>
                            {!building && i + 1 < step && <span className="text-xs">✓</span>}
                          </button>
                        </li>
                      ))}
                    </ol>
                  </>
                )}

                {tab === "parts" && (
                  <div className="space-y-4">
                    {partsBySource.map(([source, list]) => (
                      <div key={source}>
                        <p className="mb-1 text-[11px] tracking-[0.2em] text-white/45">{source}</p>
                        <ul>
                          {list.map((p) => (
                            <li key={p.id}>
                              <button
                                onClick={() => selectPart(p)}
                                className={`grid w-full grid-cols-[auto_1fr_auto] items-baseline gap-3 rounded-lg px-2 py-2 text-left text-sm transition ${
                                  selectedId === p.id ? "bg-white text-black" : "hover:bg-white/[0.06]"
                                }`}
                              >
                                <span className="h-3 w-3 translate-y-0.5 rounded-sm border border-white/20" style={{ background: p.color }} />
                                <span>
                                  {p.name}
                                  <span className={`ml-2 text-xs ${selectedId === p.id ? "text-black/60" : "text-white/50"}`}>
                                    {p.dimensions}
                                  </span>
                                </span>
                                <span className={`font-mono text-[11px] ${selectedId === p.id ? "text-black/60" : "text-white/35"}`}>
                                  手順{p.step}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}

                {tab === "info" && (
                  <div className="text-sm">
                    <div className="grid grid-cols-2 gap-5">
                      <div>
                        <p className="mb-2 text-[11px] tracking-[0.2em] text-white/45">道具</p>
                        <ul className="space-y-1 font-light">
                          {bp.tools.map((t) => (
                            <li key={t}>{t}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="mb-2 text-[11px] tracking-[0.2em] text-white/45">素材</p>
                        <ul className="space-y-1 font-light">
                          {bp.detected.materials.map((m) => (
                            <li key={m}>{m}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </aside>
          )}
        </section>
      )}

      {!bp && !request && (
        <footer className="border-t border-line px-6 py-8 text-xs tracking-[0.2em] text-ink/45">
          <div className="mx-auto max-w-7xl">化けラボ — いらないものが、使えるものに化ける。</div>
        </footer>
      )}
    </div>
  );
}

function Label({ n, text }: { n: string; text: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-xs text-accent">{n}</span>
      <span className="text-base font-medium">{text}</span>
    </div>
  );
}

function RoundBtn({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="h-9 w-9 shrink-0 rounded-full text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  );
}
