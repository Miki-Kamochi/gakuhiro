"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { YokaiStage } from "@/components/YokaiPop";
import type { Product } from "@/lib/products";
import { HOUSEHOLD_TRASH, MAKE_REQUEST_KEY, toJpegBase64, type MakeRequest } from "@/lib/trash";

// three.js + the yokai stay out of the shop's first load; they are mounted
// (and their shaders warmed up) once the page is idle.
const YokaiPop = dynamic(() => import("@/components/YokaiPop"), { ssr: false });

type Phase = "idle" | "wait" | "glitch" | "fall" | "reveal" | "ask" | "extra";

/** Click → reveal timeline (ms). The reveal's buttons finish rising ~1.4s after REVEAL. */
const T = { glitch: 1200, fall: 1600, reveal: 2400 };

// Card shake and the 「待って！」 stamp (kept here so globals.css stays untouched).
const PAGE_CSS = `
@keyframes bake-shake {
  0%, 100% { transform: none; }
  10% { transform: translate(-8px, 1px) rotate(-3deg); }
  20% { transform: translate(8px, -2px) rotate(3deg); }
  30% { transform: translate(-7px, 2px) rotate(-2.5deg); }
  40% { transform: translate(6px, -1px) rotate(2deg); }
  55% { transform: translate(-4px, 1px) rotate(-1.2deg); }
  70% { transform: translate(3px, 0) rotate(0.8deg); }
  85% { transform: translate(-1px, 0) rotate(-0.3deg); }
}
.bake-shake { animation: bake-shake 0.6s cubic-bezier(.36,.07,.19,.97) both; }
@keyframes bake-stamp {
  0% { opacity: 0; transform: scale(2.4) rotate(-16deg); }
  55% { opacity: 1; transform: scale(0.9) rotate(-6deg); }
  100% { opacity: 1; transform: scale(1) rotate(-8deg); }
}
.bake-stamp { animation: bake-stamp 0.4s cubic-bezier(.2,.9,.3,1.25) both; }
@media (prefers-reduced-motion: reduce) {
  .bake-shake, .bake-stamp { animation: none; }
  .bake-stamp { transform: rotate(-8deg); }
}
`;

const yokaiStage = (phase: Phase): YokaiStage =>
  phase === "wait" || phase === "glitch" || phase === "fall" ? "pop" : phase === "reveal" ? "peek" : "hidden";

const yen = (n: number) => `¥${Math.max(0, Math.round(n)).toLocaleString("ja-JP")}`;

export default function ShopPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<{ slug: string; label: string }[]>([]);
  const [source, setSource] = useState<"dummyjson" | "yahoo">("dummyjson");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [target, setTarget] = useState<Product | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [shownPrice, setShownPrice] = useState(0);
  const [yokaiArmed, setYokaiArmed] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Mount the yokai overlay once the shop is idle, so the click has no load delay.
  useEffect(() => {
    const arm = () => setYokaiArmed(true);
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(arm, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(arm, 1200);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Questions after the reveal.
  const [qIndex, setQIndex] = useState(0);
  const [have, setHave] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [photo, setPhoto] = useState<{ data: string; url: string } | null>(null);
  const [extraError, setExtraError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Arriving from the 化けるボタン (bookmarklet / extension) on another shop:
  // /?want=…&price=…&img=… skips our shop and goes straight to the reveal.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const name = params.get("want");
    if (!name) return;
    const id = setTimeout(() => {
      setTarget({
        id: "external",
        name,
        category: "",
        price: Number(params.get("price") ?? 0),
        image: params.get("img") ?? "",
        shop: params.get("from") ?? "",
        rating: 0,
        reviews: 0,
      });
      setYokaiArmed(true);
      setPhase("reveal");
    });
    return () => clearTimeout(id);
  }, []);

  function answer(yes: boolean) {
    const item = HOUSEHOLD_TRASH[qIndex];
    const next = yes ? [...have, item.name] : have;
    setHave(next);
    if (qIndex + 1 < HOUSEHOLD_TRASH.length) setQIndex(qIndex + 1);
    else setPhase("extra");
  }

  async function pickPhoto(file?: File) {
    if (!file || !file.type.startsWith("image/")) return;
    setExtraError(null);
    setPhoto(await toJpegBase64(file));
  }

  function goMake() {
    if (have.length === 0 && !extra.trim() && !photo) {
      setExtraError("使えるゴミを書くか、写真を追加してください。");
      return;
    }
    const req: MakeRequest = {
      want: target ? { name: target.name, price: target.price, img: target.image } : undefined,
      trash: have,
      extra: extra.trim(),
      photo: photo ?? undefined,
    };
    try {
      sessionStorage.setItem(MAKE_REQUEST_KEY, JSON.stringify(req));
    } catch {
      // Storage full or blocked: try again without the photo.
      try {
        sessionStorage.setItem(MAKE_REQUEST_KEY, JSON.stringify({ ...req, photo: undefined }));
      } catch {
        /* nothing more we can do; /make shows its manual form */
      }
    }
    router.push("/make");
  }

  function reset() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase("idle");
    setTarget(null);
    setQIndex(0);
    setHave([]);
    setExtra("");
    setPhoto(null);
    setExtraError(null);
    if (window.location.search) window.history.replaceState(null, "", "/");
  }

  // Search (debounced).
  useEffect(() => {
    const id = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ q: query, category });
        const res = await fetch(`/api/products?${params}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        setProducts(json.products);
        setCategories(json.categories);
        setSource(json.source);
      } catch (e) {
        setError(e instanceof Error ? e.message : "読み込みに失敗しました。");
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [query, category]);

  // The 化ける sequence: the card shakes and the yokai pop in (待って！) → glitch →
  // everything falls → reveal. Reduced motion skips straight from 待って！ to the reveal.
  function addToCart(p: Product) {
    if (phase !== "idle") return;
    setTarget(p);
    setShownPrice(p.price);
    setYokaiArmed(true);
    setPhase("wait");
    const later = (ms: number, next: Phase) => timers.current.push(setTimeout(() => setPhase(next), ms));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      later(1100, "reveal");
      return;
    }
    later(T.glitch, "glitch");
    later(T.fall, "fall");
    later(T.reveal, "reveal");
  }

  // Price counts down to ¥0 during the fall.
  useEffect(() => {
    if (phase !== "fall" || !target) return;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / (T.reveal - T.fall));
      setShownPrice(target.price * (1 - k * k));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, target]);

  // Stable random tilt per card for the fall.
  const tilt = useMemo(() => products.map((_, i) => ((i * 53) % 61) - 30), [products]);

  // Once the shop has broken apart it stays gone through the reveal and the questions.
  const gone = phase !== "idle" && phase !== "wait" && phase !== "glitch";
  const question = HOUSEHOLD_TRASH[qIndex];

  return (
    <>
      <div
        style={{ colorScheme: "light", animationDuration: phase === "glitch" ? `${T.fall - T.glitch}ms` : undefined }}
        className={`min-h-screen overflow-x-hidden bg-[#f6f5f2] text-neutral-900 ${phase === "glitch" ? "bake-glitch" : ""}`}
      >
        <style>{PAGE_CSS}</style>
        {/* Header */}
        <header
          className={`sticky top-0 z-10 border-b border-neutral-200 bg-white transition duration-700 ${
            gone ? "translate-y-[-120%] opacity-0" : ""
          }`}
        >
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:gap-6">
            <button
              onClick={() => {
                setQuery("");
                setCategory("");
              }}
              className="shrink-0 text-left leading-none"
            >
              <span className="block text-xl font-semibold tracking-tight text-emerald-700">KURASU</span>
              <span className="block text-[10px] tracking-[0.2em] text-neutral-500">くらしの道具店</span>
            </button>
            <div className="flex flex-1 items-center rounded-full border border-neutral-300 bg-neutral-50 px-4 focus-within:border-emerald-600">
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={source === "yahoo" ? "商品を検索（例：スマホスタンド）" : "Search (e.g. plant, rack, tray)"}
                className="h-10 w-full bg-transparent px-3 text-sm outline-none placeholder:text-neutral-400"
              />
            </div>
            <div className="relative shrink-0 text-neutral-700" aria-label="カート">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20 8H6.2" />
                <circle cx="9.5" cy="20" r="1.3" />
                <circle cx="17" cy="20" r="1.3" />
              </svg>
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] text-white">
                0
              </span>
            </div>
          </div>
          {source === "dummyjson" && (
            <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 pb-3">
              <Chip active={!category} onClick={() => setCategory("")}>
                すべて
              </Chip>
              {categories.map((c) => (
                <Chip key={c.slug} active={category === c.slug} onClick={() => setCategory(c.slug)}>
                  {c.label}
                </Chip>
              ))}
            </div>
          )}
        </header>

        {/* Banner */}
        <section
          className={`mx-auto max-w-6xl px-4 pt-6 transition duration-700 ${
            gone ? "translate-y-[60vh] rotate-6 opacity-0" : ""
          }`}
        >
          <div className="flex items-center justify-between rounded-2xl bg-emerald-700 px-6 py-5 text-white">
            <div>
              <p className="text-xs tracking-[0.2em] text-emerald-100">AUTUMN SALE</p>
              <p className="mt-1 text-lg font-semibold sm:text-2xl">暮らしを整える、秋の新生活セール</p>
            </div>
            <p className="hidden text-sm text-emerald-100 sm:block">全品送料無料 ・ 最大30%OFF</p>
          </div>
        </section>

        {/* Grid */}
        <main className="mx-auto max-w-6xl px-4 py-6">
          {error && <p className="py-20 text-center text-sm text-red-600">{error}</p>}
          {!error && !loading && products.length === 0 && (
            <p className="py-20 text-center text-sm text-neutral-500">該当する商品が見つかりませんでした。</p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            {loading && products.length === 0
              ? Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="aspect-[3/4] animate-pulse rounded-xl bg-neutral-200" />
                ))
              : products.map((p, i) => {
                  const chosen = target?.id === p.id;
                  const falling = gone && !chosen;
                  return (
                    <article
                      key={p.id}
                      style={
                        falling
                          ? {
                              transform: `translateY(120vh) rotate(${tilt[i]}deg)`,
                              transition: `transform 1s cubic-bezier(.55,0,.9,.4) ${(i % 8) * 60}ms, opacity 1s ${(i % 8) * 60}ms`,
                              opacity: 0,
                            }
                          : undefined
                      }
                      className={`flex flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-neutral-200 ${
                        chosen && phase !== "idle" ? "relative z-20 ring-2 ring-emerald-600" : ""
                      } ${chosen && phase === "wait" ? "bake-shake" : ""}`}
                    >
                      <div className="relative aspect-square bg-neutral-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.image} alt={p.name} loading="lazy" className="h-full w-full object-contain p-3" />
                        {chosen && (phase === "wait" || phase === "glitch") && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/75 px-2 text-center backdrop-blur-[1px]">
                            <p className="bake-stamp whitespace-nowrap font-brush text-4xl leading-none text-neutral-900 sm:text-6xl">待って！</p>
                            <p className="bake-rise mt-3 font-pop text-xs font-bold text-neutral-700 [animation-delay:250ms] [animation-duration:400ms] sm:text-sm">
                              それ、材料から作れるかも…！
                            </p>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col p-3">
                        <p className="line-clamp-2 text-sm leading-snug">{p.name}</p>
                        <p className="mt-1 truncate text-[11px] text-neutral-500">{p.shop}</p>
                        <p className="mt-1 text-xs text-amber-500">
                          {"★".repeat(Math.round(p.rating))}
                          <span className="text-neutral-300">{"★".repeat(5 - Math.round(p.rating))}</span>
                          <span className="ml-1 text-neutral-500">({p.reviews})</span>
                        </p>
                        <p className="mt-auto pt-2 text-lg font-semibold">
                          {chosen && phase !== "idle" ? yen(shownPrice) : yen(p.price)}
                          <span className="ml-1 text-[10px] font-normal text-neutral-500">税込</span>
                        </p>
                        <button
                          onClick={() => addToCart(p)}
                          className="mt-2 h-9 rounded-full bg-emerald-600 text-sm font-medium text-white transition hover:bg-emerald-700 active:scale-[0.98]"
                        >
                          カートに入れる
                        </button>
                      </div>
                    </article>
                  );
                })}
          </div>
        </main>

        <footer
          className={`border-t border-neutral-200 bg-white px-4 py-8 text-center text-xs text-neutral-500 transition duration-700 ${
            gone ? "opacity-0" : ""
          }`}
        >
          <p>© KURASU くらしの道具店</p>
          {source === "yahoo" ? (
            <a href="https://developer.yahoo.co.jp/sitemap/" className="mt-2 inline-block underline">
              Web Services by Yahoo! JAPAN
            </a>
          ) : (
            <p className="mt-2">Product data: DummyJSON</p>
          )}
        </footer>

        {/* Reveal */}
        {phase === "reveal" && target && (
          <div className="bake-fade fixed inset-0 z-30 flex items-center justify-center bg-black px-6 text-white">
            <div className="w-full max-w-xl text-center">
              <p className="bake-rise font-brush text-6xl tracking-tight sm:text-8xl">待って。</p>
              <p className="bake-rise mt-6 font-pop text-lg text-white/70 [animation-delay:250ms] sm:text-2xl">
                それ、家にあるゴミで作れます。
              </p>
              <div className="bake-rise mx-auto mt-10 flex max-w-sm items-center gap-4 rounded-2xl border border-white/15 p-4 text-left [animation-delay:500ms]">
                {target.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={target.image} alt="" className="h-16 w-16 shrink-0 rounded-lg bg-white object-contain p-1" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm">{target.name}</p>
                  <p className="mt-1 text-sm">
                    <span className="text-white/40 line-through">{yen(target.price)}</span>
                    <span className="ml-3 text-xl">¥0</span>
                  </p>
                </div>
              </div>
              <div className="bake-rise mt-10 flex flex-col items-center gap-4 [animation-delay:700ms]">
                <button
                  onClick={() => setPhase("ask")}
                  className="inline-flex h-12 items-center rounded-full bg-white px-8 text-sm font-medium text-black transition hover:bg-white/85"
                >
                  作り方を見る →
                </button>
                <button onClick={reset} className="text-xs text-white/40 underline-offset-4 hover:underline">
                  それでも買う
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Questions: household trash, one at a time */}
        {phase === "ask" && (
          <div className="fixed inset-0 z-30 flex items-center justify-center bg-black px-6 text-white">
            <div key={qIndex} className="bake-rise w-full max-w-md text-center">
              <p className="text-xs tracking-[0.3em] text-white/40">
                家にあるか教えてください　{qIndex + 1} / {HOUSEHOLD_TRASH.length}
              </p>
              <div className="mx-auto mt-6 flex justify-center gap-1.5">
                {HOUSEHOLD_TRASH.map((t, i) => (
                  <span key={t.id} className={`h-1 w-8 rounded-full ${i <= qIndex ? "bg-white" : "bg-white/15"}`} />
                ))}
              </div>
              <p className="mt-12 text-7xl" aria-hidden>
                {question.emoji}
              </p>
              <p className="mt-8 text-3xl font-light sm:text-4xl">{question.name}は</p>
              <p className="mt-2 text-3xl font-light sm:text-4xl">ありますか？</p>
              <p className="mt-4 text-sm text-white/45">{question.detail}</p>
              <div className="mt-12 grid grid-cols-2 gap-3">
                <button
                  onClick={() => answer(false)}
                  className="h-14 rounded-full border border-white/25 text-base transition hover:border-white"
                >
                  ない
                </button>
                <button
                  onClick={() => answer(true)}
                  className="h-14 rounded-full bg-white text-base font-medium text-black transition hover:bg-white/85"
                >
                  ある
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Anything else? Optional photo or text, then go build */}
        {phase === "extra" && (
          <div className="fixed inset-0 z-30 overflow-y-auto bg-black px-6 py-12 text-white">
            <div className="bake-rise mx-auto flex min-h-full w-full max-w-md flex-col justify-center text-center">
              <p className="text-3xl font-light sm:text-4xl">他に使えそうな</p>
              <p className="mt-2 text-3xl font-light sm:text-4xl">ゴミはありますか？</p>
              <p className="mt-4 text-sm text-white/45">写真を撮るか、書いてください（なくてもOK）</p>

              {have.length > 0 && (
                <div className="mt-8 flex flex-wrap justify-center gap-2">
                  {have.map((t) => (
                    <span key={t} className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/70">
                      ✓ {t}
                    </span>
                  ))}
                </div>
              )}

              <button
                onClick={() => fileInput.current?.click()}
                className="mt-8 flex h-40 w-full items-center justify-center overflow-hidden rounded-2xl border border-dashed border-white/30 transition hover:border-white"
              >
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo.url} alt="追加したゴミの写真" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-sm text-white/60">
                    <span className="mb-2 block text-3xl">📷</span>
                    写真を撮る・選ぶ
                  </span>
                )}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => pickPhoto(e.target.files?.[0])}
              />

              <input
                value={extra}
                onChange={(e) => {
                  setExtra(e.target.value);
                  setExtraError(null);
                }}
                placeholder="例：古いTシャツ、空き瓶、卵パック"
                className="mt-4 h-12 w-full rounded-full border border-white/20 bg-transparent px-5 text-center text-sm outline-none placeholder:text-white/30 focus:border-white"
              />

              {extraError && <p className="mt-4 text-sm text-red-400">{extraError}</p>}

              <button
                onClick={goMake}
                className="mt-8 h-14 w-full rounded-full bg-white text-base font-medium text-black transition hover:bg-white/85"
              >
                {photo || extra.trim() ? "化けさせる →" : "これで化けさせる →"}
              </button>
              <button onClick={reset} className="mt-6 text-xs text-white/40 underline-offset-4 hover:underline">
                やっぱり買う
              </button>
            </div>
          </div>
        )}
      </div>
      {/* Outside the glitching wrapper: its transform/filter would break position: fixed. */}
      {yokaiArmed && <YokaiPop stage={yokaiStage(phase)} />}
    </>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1 text-xs transition ${
        active ? "border-emerald-700 bg-emerald-700 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
      }`}
    >
      {children}
    </button>
  );
}
