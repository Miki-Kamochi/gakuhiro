"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { Blueprint } from "@/lib/blueprint";

const Viewer3D = dynamic(() => import("@/components/Viewer3D"), { ssr: false });

const EXAMPLES = [
  "My plants die when I travel",
  "My desk cables are a mess",
  "I need a phone stand for video calls",
  "Birds keep visiting my balcony",
];

const LOADING_LINES = [
  "Scanning the photo",
  "Identifying materials",
  "Imagining what it could become",
  "Designing the build",
  "Generating the 3D model",
];

/** Downscale to keep the upload small and fast. */
async function toJpegBase64(file: File, max = 1024): Promise<{ data: string; url: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { data: url.split(",")[1], url };
}

export default function Home() {
  const [photo, setPhoto] = useState<{ data: string; url: string } | null>(null);
  const [problem, setProblem] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingLine, setLoadingLine] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blueprint: Blueprint; demo: boolean } | null>(null);
  const [step, setStep] = useState(1);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => setLoadingLine((i) => (i + 1) % LOADING_LINES.length), 1600);
    return () => clearInterval(id);
  }, [loading]);

  async function pick(file?: File) {
    if (!file || !file.type.startsWith("image/")) return;
    setError(null);
    setPhoto(await toJpegBase64(file));
  }

  async function transform() {
    if (!photo) return;
    setLoading(true);
    setLoadingLine(0);
    setError(null);
    try {
      const res = await fetch("/api/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: photo.data, mediaType: "image/jpeg", problem }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      setResult(json);
      setStep(json.blueprint.steps.length + 1);
      setTimeout(() => outputRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const bp = result?.blueprint;
  const total = bp?.steps.length ?? 0;
  const finished = step > total;

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Nav */}
      <header className="fixed inset-x-0 top-0 z-20 border-b border-white/10 bg-black/70 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <span className="text-sm font-medium tracking-[0.35em]">BAKERU</span>
          <nav className="hidden gap-10 text-xs uppercase tracking-[0.2em] text-white/50 sm:flex">
            <a href="#input" className="transition hover:text-white">Input</a>
            <a href="#output" className="transition hover:text-white">Output</a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative flex min-h-[92vh] flex-col justify-end overflow-hidden px-6 pb-20 pt-32">
        <div className="hero-glow pointer-events-none absolute inset-0" />
        <div className="relative mx-auto w-full max-w-7xl">
          <p className="mb-8 text-xs uppercase tracking-[0.3em] text-white/50">Theme — 化ける / Transform</p>
          <h1 className="max-w-5xl text-5xl font-light leading-[1.05] tracking-tight sm:text-7xl lg:text-8xl">
            いらないものが、
            <br />
            <span className="text-white/45">使えるものに</span>化ける。
          </h1>
          <div className="mt-14 flex flex-col gap-8 border-t border-white/15 pt-8 sm:flex-row sm:items-end sm:justify-between">
            <p className="max-w-md text-base font-light leading-relaxed text-white/60">
              Photograph your trash. Tell us a problem. AI sees the materials, invents something useful, and hands you a
              step-by-step 3D build.
            </p>
            <a
              href="#input"
              className="inline-flex h-12 items-center justify-center rounded-full border border-white px-8 text-sm tracking-wide transition hover:bg-white hover:text-black"
            >
              Start transforming
            </a>
          </div>
        </div>
      </section>

      {/* Input */}
      <section id="input" className="scroll-mt-16 border-t border-white/10 px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <SectionHead index="01" title="Input" sub="A photo of something you don't need, and a problem you have." />

          <div className="grid gap-px overflow-hidden rounded-sm border border-white/10 bg-white/10 lg:grid-cols-2">
            {/* Photo */}
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
              className={`relative flex aspect-[4/3] cursor-pointer items-center justify-center overflow-hidden bg-[#0a0a0a] transition ${
                dragging ? "bg-[#141414]" : "hover:bg-[#0f0f0f]"
              }`}
            >
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.url} alt="Your item" className="h-full w-full object-cover" />
              ) : (
                <div className="text-center">
                  <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-white/30 text-2xl font-light">
                    +
                  </div>
                  <p className="text-sm tracking-wide">Drop a photo or click to upload</p>
                  <p className="mt-2 text-xs text-white/40">Bottles, boxes, old clothes, broken things</p>
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

            {/* Problem */}
            <div className="flex flex-col bg-[#0a0a0a] p-8 sm:p-10">
              <label htmlFor="problem" className="text-xs uppercase tracking-[0.25em] text-white/50">
                Your problem (optional)
              </label>
              <textarea
                id="problem"
                value={problem}
                onChange={(e) => setProblem(e.target.value)}
                placeholder="e.g. My plants die when I travel"
                rows={4}
                className="mt-6 w-full resize-none border-b border-white/20 bg-transparent pb-4 text-2xl font-light leading-snug outline-none placeholder:text-white/25 focus:border-white"
              />
              <div className="mt-6 flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => setProblem(ex)}
                    className="rounded-full border border-white/15 px-4 py-1.5 text-xs text-white/60 transition hover:border-white/60 hover:text-white"
                  >
                    {ex}
                  </button>
                ))}
              </div>

              <div className="mt-auto pt-10">
                {error && <p className="mb-4 text-sm text-[#ff6b5e]">{error}</p>}
                <button
                  onClick={transform}
                  disabled={!photo || loading}
                  className="group flex h-14 w-full items-center justify-between rounded-full bg-white px-8 text-sm font-medium text-black transition enabled:hover:bg-white/85 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/40"
                >
                  <span>{loading ? `${LOADING_LINES[loadingLine]}…` : photo ? "Transform  化ける" : "Add a photo first"}</span>
                  <span className={loading ? "animate-pulse" : "transition group-enabled:group-hover:translate-x-1"}>
                    →
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Output */}
      <section id="output" ref={outputRef} className="scroll-mt-16 border-t border-white/10 px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <SectionHead index="02" title="Output" sub="What your trash becomes." />

          {!bp ? (
            <div className="flex aspect-[21/9] items-center justify-center rounded-sm border border-dashed border-white/15 text-sm text-white/30">
              Your 3D blueprint will appear here.
            </div>
          ) : (
            <>
              {result?.demo && (
                <p className="mb-6 text-xs uppercase tracking-[0.2em] text-white/40">
                  Demo mode — set ANTHROPIC_API_KEY to analyse your own photo
                </p>
              )}

              <div className="mb-14 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
                <div>
                  <p className="mb-3 text-sm text-white/50">{bp.detected.items.join(" · ")} →</p>
                  <h3 className="text-4xl font-light tracking-tight sm:text-6xl">{bp.title}</h3>
                  <p className="mt-2 text-xl font-light text-white/45">{bp.title_ja}</p>
                  <p className="mt-6 max-w-2xl text-lg font-light text-white/70">{bp.tagline}</p>
                </div>
                <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-white/10 bg-white/10">
                  <Stat label="Difficulty" value={`${bp.difficulty}/5`} />
                  <Stat label="Time" value={`${bp.time_minutes}m`} />
                  <Stat label="CO₂ saved" value={`${bp.co2_saved_g}g`} />
                </dl>
              </div>

              <div className="grid gap-px overflow-hidden rounded-sm border border-white/10 bg-white/10 lg:grid-cols-[1.4fr_1fr]">
                {/* Viewer */}
                <div className="relative aspect-square bg-[radial-gradient(ellipse_at_center,#161616_0%,#050505_70%)] lg:aspect-auto lg:min-h-[640px]">
                  <Viewer3D parts={bp.parts} step={step} />
                  <div className="pointer-events-none absolute left-6 top-6 text-xs uppercase tracking-[0.25em] text-white/50">
                    {finished ? "Complete — 化けた" : `Step ${step} / ${total}`}
                  </div>
                  <div className="absolute inset-x-6 bottom-6 flex items-center gap-3">
                    <button
                      onClick={() => setStep((s) => Math.max(1, s - 1))}
                      className="h-10 w-10 rounded-full border border-white/25 text-sm transition hover:border-white"
                      aria-label="Previous step"
                    >
                      ←
                    </button>
                    <div className="flex flex-1 gap-1">
                      {Array.from({ length: total + 1 }, (_, i) => (
                        <button
                          key={i}
                          onClick={() => setStep(i + 1)}
                          aria-label={i === total ? "Finished" : `Step ${i + 1}`}
                          className={`h-0.5 flex-1 transition ${i + 1 <= step ? "bg-white" : "bg-white/20"}`}
                        />
                      ))}
                    </div>
                    <button
                      onClick={() => setStep((s) => Math.min(total + 1, s + 1))}
                      className="h-10 w-10 rounded-full border border-white/25 text-sm transition hover:border-white"
                      aria-label="Next step"
                    >
                      →
                    </button>
                  </div>
                </div>

                {/* Steps */}
                <div className="flex flex-col bg-[#0a0a0a]">
                  <div className="border-b border-white/10 p-8">
                    <p className="text-xs uppercase tracking-[0.25em] text-white/50">Solves</p>
                    <p className="mt-3 font-light leading-relaxed text-white/80">{bp.problem_solved}</p>
                  </div>
                  <ol className="flex-1">
                    {bp.steps.map((s, i) => (
                      <li key={i}>
                        <button
                          onClick={() => setStep(i + 1)}
                          className={`flex w-full gap-6 border-b border-white/10 p-8 text-left transition ${
                            step === i + 1 ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
                          }`}
                        >
                          <span className={`font-mono text-xs ${step === i + 1 ? "text-white" : "text-white/35"}`}>
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span>
                            <span className="block font-medium">{s.title}</span>
                            <span className="mt-1 block text-sm font-light leading-relaxed text-white/55">{s.detail}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                  <div className="grid grid-cols-2 gap-8 p-8 text-sm">
                    <div>
                      <p className="mb-3 text-xs uppercase tracking-[0.25em] text-white/50">Materials</p>
                      <ul className="space-y-1 font-light text-white/70">
                        {bp.detected.materials.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-3 text-xs uppercase tracking-[0.25em] text-white/50">Tools</p>
                      <ul className="space-y-1 font-light text-white/70">
                        {bp.tools.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      <footer className="border-t border-white/10 px-6 py-10 text-xs tracking-[0.2em] text-white/30">
        <div className="mx-auto max-w-7xl">BAKERU — 化ける</div>
      </footer>
    </div>
  );
}

function SectionHead({ index, title, sub }: { index: string; title: string; sub: string }) {
  return (
    <div className="mb-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-baseline gap-6">
        <span className="font-mono text-xs text-white/40">{index}</span>
        <h2 className="text-3xl font-light tracking-tight sm:text-5xl">{title}</h2>
      </div>
      <p className="max-w-sm text-sm font-light text-white/50">{sub}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0a0a0a] px-6 py-5">
      <dt className="text-[10px] uppercase tracking-[0.25em] text-white/45">{label}</dt>
      <dd className="mt-2 text-2xl font-light">{value}</dd>
    </div>
  );
}
