"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Blueprint, Part } from "@/lib/blueprint";
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
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blueprint: Blueprint; demo: boolean } | null>(null);
  const [step, setStep] = useState(1);
  const [exploded, setExploded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
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
      if (cached?.blueprint) setResult(cached);
      else if (req) run(req);
    });
    return () => clearTimeout(id);
  }, []);

  // Loading copy walks forward through the stages and stops on the last one.
  useEffect(() => {
    if (!loading) return;
    const start = Date.now();
    const id = setInterval(() => {
      const s = (Date.now() - start) / 1000;
      setElapsed(Math.floor(s));
      setLoadingLine(Math.min(LOADING_LINES.length - 1, Math.floor(s / 7)));
    }, 500);
    return () => clearInterval(id);
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
    setElapsed(0);
    setError(null);
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
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "エラーが発生しました。");
      setResult(json);
      try {
        sessionStorage.setItem(MAKE_RESULT_KEY, JSON.stringify(json));
      } catch {
        /* storage full: the result just won't survive a reload */
      }
      setStep(1);
      setExploded(false);
      setSelectedId(null);
      setTimeout(() => outputRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  }

  const bp = result?.blueprint;
  const total = bp?.steps.length ?? 0;
  const finished = step > total;
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
    if (!bp) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea")) return;
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      setSelectedId(null);
      setStep((s) => Math.max(1, Math.min(total + 1, s + (e.key === "ArrowRight" ? 1 : -1))));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bp, total]);

  function regenerate() {
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
      "BAKERU — いらないものが、使えるものに化ける。",
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
      <header className="sticky top-0 z-20 border-b border-champagne/70 bg-blush/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="text-sm font-medium tracking-[0.35em]">
            BAKERU <span className="ml-1 tracking-[0.2em] text-amber">化ける</span>
          </Link>
          <nav className="flex gap-6 text-xs tracking-[0.2em] text-espresso/60 sm:gap-8">
            <a href="#input" className="transition hover:text-espresso">入力</a>
            <a href="#output" className="transition hover:text-espresso">結果</a>
            <Link href="/" className="transition hover:text-espresso">ショップ</Link>
          </nav>
        </div>
      </header>

      <main className="relative mx-auto max-w-7xl px-6">
        {/* Motto */}
        <section className="pb-10 pt-12">
          <p className="mb-4 text-xs tracking-[0.3em] text-espresso/50">テーマ — 化ける / TRANSFORM</p>
          <h1 className="text-3xl font-light leading-tight tracking-tight sm:text-5xl">
            いらないものが、<span className="text-amber">使えるものに</span>化ける。
          </h1>
          <p className="mt-4 max-w-2xl text-sm font-light leading-relaxed text-espresso/65">
            いらない物の写真と、困っていることを入れてください。AIが素材を見分けて、役に立つ物に変身させます。部品の切り出し方から組み立てまで、3Dで手順を案内します。
          </p>
        </section>

        {/* Input */}
        <section id="input" className="scroll-mt-20 pb-20">
          {wanted && (
            <div className="mb-5 flex items-center gap-4 rounded-2xl border border-champagne bg-white/60 p-4">
              {wanted.img && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={wanted.img} alt="" className="h-14 w-14 shrink-0 rounded-xl bg-white object-contain p-1" />
              )}
              <div className="min-w-0">
                <p className="text-xs tracking-[0.25em] text-espresso/50">買おうとしていたもの</p>
                <p className="mt-1 truncate">{wanted.name}</p>
              </div>
              <p className="ml-auto shrink-0 text-sm">
                <span className="text-espresso/40 line-through">¥{wanted.price.toLocaleString("ja-JP")}</span>
                <span className="ml-3 text-lg text-amber">¥0</span>
              </p>
            </div>
          )}

          {request && (
            <div className="rounded-2xl border border-champagne bg-white/60 p-5">
              <Label n="01" text="使うゴミ" />
              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                {request.trash.map((t) => (
                  <span key={t} className="rounded-full border border-champagne bg-blush px-3 py-1">
                    {t}
                  </span>
                ))}
                {request.extra && (
                  <span className="rounded-full border border-champagne bg-blush px-3 py-1">{request.extra}</span>
                )}
                {request.photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={request.photo.url} alt="追加したゴミの写真" className="h-12 w-12 rounded-lg object-cover" />
                )}
              </div>

              <div className="mt-6 flex items-center gap-4 rounded-xl bg-blush p-4">
                {loading ? (
                  <>
                    <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-champagne border-t-amber" />
                    <span className="flex-1 text-base">{LOADING_LINES[loadingLine]}…</span>
                    <span className="font-mono text-xs text-espresso/45">{elapsed}秒</span>
                  </>
                ) : error ? (
                  <>
                    <span className="flex-1 text-sm text-amber">{error}</span>
                    <button
                      onClick={() => run(request)}
                      className="shrink-0 rounded-full bg-amber px-5 py-2 text-sm text-blush transition hover:bg-[#a55c2d]"
                    >
                      もう一度
                    </button>
                  </>
                ) : (
                  <span className="text-base text-emerald">化けました ↓</span>
                )}
              </div>
            </div>
          )}

          {!request && (
          <div className="grid gap-5 lg:grid-cols-2">
            {/* Photo */}
            <div className="flex flex-col rounded-2xl border border-champagne bg-white/60 p-5">
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
                  dragging ? "border-amber bg-champagne/40" : "border-cognac/50 bg-blush hover:bg-champagne/25"
                }`}
              >
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo.url} alt="アップロードした写真" className="h-full w-full object-cover" />
                ) : (
                  <div className="px-6 text-center">
                    <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber text-2xl font-light text-blush">
                      +
                    </div>
                    <p className="text-sm">写真をドロップ、またはクリックして選択</p>
                    <p className="mt-2 text-xs text-espresso/50">ペットボトル、段ボール、古着、壊れた物など</p>
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
                  className="mt-3 self-start text-xs text-espresso/55 underline-offset-4 hover:underline"
                >
                  写真を変更する
                </button>
              )}
            </div>

            {/* Problem */}
            <div className="flex flex-col rounded-2xl border border-champagne bg-white/60 p-5">
              <Label n="02" text="困っていること" />
              <p className="mt-4 text-xs text-espresso/55">ジャンルを選ぶか、自由に書いてください（なくてもOK）</p>
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
                        ? "border-emerald bg-emerald text-blush"
                        : "border-champagne bg-blush text-espresso/75 hover:border-cognac"
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
                className="mt-5 w-full flex-1 resize-none rounded-xl border border-champagne bg-blush p-4 text-lg font-light leading-relaxed outline-none placeholder:text-espresso/30 focus:border-amber"
              />

              {error && <p className="mt-4 text-sm text-amber">{error}</p>}
              <button
                onClick={transform}
                disabled={!photo || loading}
                className="group mt-5 flex h-14 w-full items-center justify-between rounded-full bg-amber px-7 text-base font-medium text-blush transition enabled:hover:bg-[#a55c2d] disabled:cursor-not-allowed disabled:bg-champagne disabled:text-espresso/45"
              >
                <span>{loading ? `${LOADING_LINES[loadingLine]}…` : photo ? "化けさせる" : "まず写真を追加してください"}</span>
                <span className={loading ? "animate-pulse" : "transition group-enabled:group-hover:translate-x-1"}>→</span>
              </button>
            </div>
          </div>
          )}
        </section>

        {/* Output */}
        <section id="output" ref={outputRef} className="scroll-mt-16 border-t border-champagne pb-24 pt-16">
          <div className="mb-10 flex items-baseline gap-5">
            <span className="font-mono text-xs text-espresso/45">03</span>
            <h2 className="text-2xl font-light tracking-tight sm:text-3xl">変身結果</h2>
          </div>

          {loading ? (
            <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]" aria-busy="true">
              <div className="viewer-bg relative flex h-[50vh] min-h-[360px] flex-col items-center justify-center overflow-hidden rounded-2xl border border-champagne px-6 text-center">
                <div className="scanline pointer-events-none absolute inset-x-0 h-24" />
                <span className="h-10 w-10 animate-spin rounded-full border-2 border-champagne border-t-amber" />
                <p className="mt-6 text-lg font-light">{LOADING_LINES[loadingLine]}…</p>
                <p className="mt-2 text-xs text-espresso/50">
                  ふつう30〜60秒ほどかかります ・ <span className="font-mono">{elapsed}秒</span>
                </p>
                <div className="mt-6 flex gap-1.5">
                  {LOADING_LINES.map((l, i) => (
                    <span key={l} className={`h-1 w-8 rounded-full transition ${i <= loadingLine ? "bg-amber" : "bg-espresso/10"}`} />
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-4">
                <div className="shimmer h-28 rounded-2xl" />
                <div className="shimmer h-56 rounded-2xl" />
                <div className="shimmer h-40 rounded-2xl" />
              </div>
            </div>
          ) : !bp ? (
            <div className="flex aspect-[21/9] items-center justify-center rounded-2xl border border-dashed border-cognac/50 px-6 text-center text-sm text-espresso/45">
              ここに3Dの設計図と作り方が表示されます
            </div>
          ) : (
            <>
              {result?.demo && (
                <p className="mb-6 inline-block rounded-full bg-champagne/60 px-4 py-1.5 text-xs text-espresso/70">
                  デモモード：ANTHROPIC_API_KEY を設定すると、あなたの写真をAIが解析します
                </p>
              )}

              {/* Title */}
              <div className="mb-10 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
                <div>
                  <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
                    {bp.detected.items.map((it) => (
                      <span key={it} className="rounded-full border border-champagne bg-white/60 px-3 py-1 text-espresso/70">
                        {it}
                      </span>
                    ))}
                    <span className="text-amber">→ 化けると</span>
                  </div>
                  <h3 className="text-3xl font-light tracking-tight sm:text-5xl">{bp.title}</h3>
                  <p className="mt-4 max-w-2xl text-lg font-light text-espresso/70">{bp.tagline}</p>
                  <div className="mt-6 flex flex-wrap gap-2 text-sm">
                    <button
                      onClick={copyInstructions}
                      className="rounded-full border border-espresso/25 bg-white/60 px-4 py-2 transition hover:border-espresso"
                    >
                      {copied ? "コピーしました ✓" : "作り方をコピー"}
                    </button>
                    {(request || photo) && (
                      <button
                        onClick={regenerate}
                        className="rounded-full border border-espresso/25 bg-white/60 px-4 py-2 transition hover:border-espresso"
                      >
                        別の案を出す ↻
                      </button>
                    )}
                    <Link
                      href="/"
                      className="rounded-full border border-espresso/25 bg-white/60 px-4 py-2 transition hover:border-espresso"
                    >
                      ショップに戻る
                    </Link>
                  </div>
                </div>
                <dl className="grid grid-cols-3 overflow-hidden rounded-2xl border border-champagne bg-white/60">
                  <Stat label="難易度" value={`${Math.min(5, Math.max(1, Math.round(bp.difficulty)))}/5`} />
                  <Stat label="所要時間" value={`${Math.round(bp.time_minutes)}分`} />
                  <Stat label="CO₂削減" value={`${Math.round(bp.co2_saved_g).toLocaleString("ja-JP")}g`} />
                </dl>
              </div>

              <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
                {/* Viewer */}
                <div className="lg:sticky lg:top-20 lg:self-start">
                  <div className="viewer-bg relative h-[60vh] min-h-[420px] overflow-hidden rounded-2xl border border-champagne lg:h-[calc(100vh-7rem)]">
                    <Viewer3D
                      parts={bp.parts}
                      step={step}
                      exploded={exploded}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                    />
                    <div className="pointer-events-none absolute left-5 top-5 max-w-[60%]">
                      <p className="text-xs tracking-[0.25em] text-espresso/55">
                        {finished ? "完成" : `STEP ${step} / ${total}`}
                      </p>
                      <p className="mt-1 text-lg font-light">{finished ? "化けた！" : current?.title}</p>
                    </div>
                    <div className="absolute right-5 top-5 flex overflow-hidden rounded-full border border-champagne bg-white/70 text-xs">
                      <button
                        onClick={() => setExploded(false)}
                        className={`px-4 py-2 transition ${!exploded ? "bg-espresso text-blush" : "hover:bg-champagne/50"}`}
                      >
                        組み立て
                      </button>
                      <button
                        onClick={() => setExploded(true)}
                        className={`px-4 py-2 transition ${exploded ? "bg-espresso text-blush" : "hover:bg-champagne/50"}`}
                      >
                        分解図
                      </button>
                    </div>

                    {selected && (
                      <div className="absolute bottom-20 left-5 right-5 max-w-sm rounded-xl border border-emerald/30 bg-white/85 p-4 backdrop-blur">
                        <div className="flex items-start justify-between gap-4">
                          <p className="font-medium text-emerald">{selected.name}</p>
                          <button onClick={() => setSelectedId(null)} className="text-espresso/45 hover:text-espresso" aria-label="閉じる">
                            ×
                          </button>
                        </div>
                        <p className="mt-1 text-sm text-espresso/70">
                          {selected.source} ・ {selected.dimensions}
                        </p>
                        <p className="mt-2 text-sm font-light leading-relaxed">{selected.make}</p>
                      </div>
                    )}

                    <div className="absolute inset-x-5 bottom-5 flex items-center gap-3">
                      <RoundBtn onClick={() => goToStep(Math.max(1, step - 1))} label="前の手順">←</RoundBtn>
                      <div className="flex flex-1 gap-1">
                        {Array.from({ length: total + 1 }, (_, i) => (
                          <button
                            key={i}
                            onClick={() => goToStep(i + 1)}
                            aria-label={i === total ? "完成" : `手順 ${i + 1}`}
                            className={`h-1 flex-1 rounded-full transition ${i + 1 <= step ? "bg-amber" : "bg-espresso/15"}`}
                          />
                        ))}
                      </div>
                      <RoundBtn onClick={() => goToStep(Math.min(total + 1, step + 1))} label="次の手順">→</RoundBtn>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-espresso/50">
                    ドラッグで回転・スクロールで拡大・← → キーで手順を移動。部品をクリックすると作り方が表示されます。
                  </p>
                </div>

                {/* Detail column */}
                <div className="flex flex-col gap-6">
                  <div className="rounded-2xl bg-emerald p-6 text-blush">
                    <p className="text-xs tracking-[0.25em] text-blush/60">解決すること</p>
                    <p className="mt-3 font-light leading-relaxed">{bp.problem_solved}</p>
                  </div>

                  {/* Current step */}
                  {current ? (
                    <div className="rounded-2xl border border-champagne bg-white/70 p-6">
                      <div className="flex items-baseline gap-4">
                        <span className="font-mono text-4xl font-light text-amber">{String(step).padStart(2, "0")}</span>
                        <div>
                          <h4 className="text-xl font-medium">{current.title}</h4>
                          <p className="mt-1 text-sm font-light text-espresso/65">{current.summary}</p>
                        </div>
                      </div>
                      <ol className="mt-6 space-y-3">
                        {current.actions.map((a, i) => (
                          <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
                            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-champagne text-xs font-medium">
                              {i + 1}
                            </span>
                            <span>{a}</span>
                          </li>
                        ))}
                      </ol>

                      {bp.parts.some((p) => p.step === step) && (
                        <div className="mt-6">
                          <p className="text-xs tracking-[0.2em] text-espresso/55">この手順で使う部品</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {bp.parts
                              .filter((p) => p.step === step)
                              .map((p) => (
                                <button
                                  key={p.id}
                                  onClick={() => selectPart(p)}
                                  className={`rounded-full border px-3 py-1 text-sm transition ${
                                    selectedId === p.id
                                      ? "border-emerald bg-emerald text-blush"
                                      : "border-champagne bg-blush hover:border-cognac"
                                  }`}
                                >
                                  {p.name}
                                  <span className="ml-2 text-xs opacity-60">{p.dimensions}</span>
                                </button>
                              ))}
                          </div>
                        </div>
                      )}

                      {(current.tip || current.caution) && (
                        <div className="mt-6 grid gap-3 sm:grid-cols-2">
                          {current.tip && (
                            <div className="rounded-xl bg-cognac/20 p-4 text-sm leading-relaxed">
                              <p className="mb-1 text-xs font-medium tracking-[0.2em] text-[#8a6330]">コツ</p>
                              {current.tip}
                            </div>
                          )}
                          {current.caution && (
                            <div className="rounded-xl bg-amber/15 p-4 text-sm leading-relaxed">
                              <p className="mb-1 text-xs font-medium tracking-[0.2em] text-amber">注意</p>
                              {current.caution}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="mt-6 flex justify-between">
                        <button
                          onClick={() => goToStep(Math.max(1, step - 1))}
                          disabled={step === 1}
                          className="text-sm text-espresso/60 hover:text-espresso disabled:invisible"
                        >
                          ← 前へ
                        </button>
                        <button
                          onClick={() => goToStep(step + 1)}
                          className="rounded-full bg-espresso px-5 py-2 text-sm text-blush transition hover:bg-espresso/85"
                        >
                          {step === total ? "完成を見る →" : "次の手順 →"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-champagne bg-white/70 p-6">
                      <p className="text-xl font-medium">完成！</p>
                      <p className="mt-2 text-sm font-light leading-relaxed text-espresso/70">
                        「分解図」で全部品の位置関係を確認できます。部品をクリックすると、その作り方が表示されます。
                      </p>
                      <button
                        onClick={() => goToStep(1)}
                        className="mt-4 rounded-full border border-espresso px-5 py-2 text-sm transition hover:bg-espresso hover:text-blush"
                      >
                        最初から見る
                      </button>
                    </div>
                  )}

                  {/* All steps */}
                  <div className="overflow-hidden rounded-2xl border border-champagne bg-white/60">
                    <p className="border-b border-champagne px-6 py-4 text-xs tracking-[0.25em] text-espresso/55">手順一覧</p>
                    <ol>
                      {bp.steps.map((s, i) => (
                        <li key={i}>
                          <button
                            onClick={() => goToStep(i + 1)}
                            className={`flex w-full items-baseline gap-4 border-b border-champagne/60 px-6 py-3 text-left transition last:border-b-0 ${
                              step === i + 1 ? "bg-champagne/45" : "hover:bg-champagne/20"
                            }`}
                          >
                            <span className={`font-mono text-xs ${step === i + 1 ? "text-amber" : "text-espresso/40"}`}>
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <span className="text-sm">{s.title}</span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* Cut list */}
                  <div className="overflow-hidden rounded-2xl border border-champagne bg-white/60">
                    <div className="border-b border-champagne px-6 py-4">
                      <p className="text-xs tracking-[0.25em] text-espresso/55">部品リスト（切り出し表）</p>
                    </div>
                    {partsBySource.map(([source, list]) => (
                      <div key={source} className="border-b border-champagne/60 px-6 py-4 last:border-b-0">
                        <p className="mb-2 text-sm font-medium text-amber">{source}</p>
                        <ul className="space-y-1">
                          {list.map((p) => (
                            <li key={p.id}>
                              <button
                                onClick={() => selectPart(p)}
                                className={`grid w-full grid-cols-[auto_1fr_auto] items-baseline gap-3 rounded-lg px-2 py-2 text-left text-sm transition ${
                                  selectedId === p.id ? "bg-emerald text-blush" : "hover:bg-champagne/30"
                                }`}
                              >
                                <span
                                  className="h-3 w-3 translate-y-0.5 rounded-sm border border-espresso/20"
                                  style={{ background: p.color }}
                                />
                                <span>
                                  {p.name}
                                  <span className={`ml-2 text-xs ${selectedId === p.id ? "text-blush/75" : "text-espresso/55"}`}>
                                    {p.dimensions}
                                  </span>
                                </span>
                                <span className={`font-mono text-xs ${selectedId === p.id ? "text-blush/75" : "text-espresso/40"}`}>
                                  手順{p.step}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>

                  {/* Tools & materials */}
                  <div className="grid grid-cols-2 gap-6 rounded-2xl border border-champagne bg-white/60 p-6 text-sm">
                    <div>
                      <p className="mb-3 text-xs tracking-[0.25em] text-espresso/55">道具</p>
                      <ul className="space-y-1 font-light">
                        {bp.tools.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-3 text-xs tracking-[0.25em] text-espresso/55">素材</p>
                      <ul className="space-y-1 font-light">
                        {bp.detected.materials.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </main>

      <footer className="border-t border-champagne px-6 py-8 text-xs tracking-[0.2em] text-espresso/45">
        <div className="mx-auto max-w-7xl">BAKERU — いらないものが、使えるものに化ける。</div>
      </footer>
    </div>
  );
}

function Label({ n, text }: { n: string; text: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-xs text-amber">{n}</span>
      <span className="text-base font-medium">{text}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-champagne px-6 py-4 last:border-r-0">
      <dt className="text-[11px] tracking-[0.2em] text-espresso/55">{label}</dt>
      <dd className="mt-1 text-2xl font-light">{value}</dd>
    </div>
  );
}

function RoundBtn({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="h-10 w-10 shrink-0 rounded-full border border-espresso/25 bg-white/70 text-sm transition hover:border-espresso"
    >
      {children}
    </button>
  );
}
