/*
 * BAKERU 化けるボタン — runs on a real shop page (Amazon, eBay, 楽天, Yahoo!, anything).
 * Reads the product from the page, plays the 化ける sequence on top of the shop itself,
 * then sends the user to BAKERU with that product as the goal.
 *
 * The same file is the bookmarklet (served from /button) and the Chrome extension's
 * content script (copied by scripts/build-extension.mjs). No innerHTML and no <style>
 * tags: everything goes through the CSSOM and the Web Animations API, which shop
 * Content-Security-Policies don't block.
 */
(() => {
  const ORIGIN = "__BAKERU_ORIGIN__";
  const IS_EXTENSION = typeof chrome !== "undefined" && !!(chrome.runtime && chrome.runtime.id);

  // Clicking the bookmarklet again just replays.
  if (window.__bakeru) {
    if (!IS_EXTENSION) window.__bakeru.run();
    return;
  }

  /* ---------------------------------------------------------------- */
  /* Read the product from the page                                    */
  /* ---------------------------------------------------------------- */

  const RATES = { JPY: 1, USD: 150, EUR: 160, GBP: 190, CAD: 110, AUD: 100 };
  const $ = (s) => document.querySelector(s);
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const meta = (n) =>
    ($(`meta[property="${n}"]`) || $(`meta[name="${n}"]`) || $(`meta[itemprop="${n}"]`) || {}).content || "";

  function jsonLdProduct() {
    let found = null;
    const walk = (o) => {
      if (found || !o || typeof o !== "object") return;
      if (Array.isArray(o)) return o.forEach(walk);
      if ([].concat(o["@type"] || []).includes("Product")) return void (found = o);
      if (o["@graph"]) walk(o["@graph"]);
    };
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        walk(JSON.parse(s.textContent));
      } catch {}
    }
    return found;
  }

  /** "￥2,980" / "US $12.99" / "12.99" + "USD" → yen. */
  function toYen(text, currency) {
    if (text == null || text === "") return 0;
    const s = String(text);
    const cur = (
      currency || (/US\s?\$|\$|USD/.test(s) ? "USD" : /€|EUR/.test(s) ? "EUR" : /£|GBP/.test(s) ? "GBP" : "JPY")
    ).toUpperCase();
    const m = s.replace(/[,\s]/g, "").match(/\d+(\.\d+)?/);
    if (!m) return 0;
    const n = parseFloat(m[0]);
    return cur === "JPY" ? Math.round(n) : Math.round((n * (RATES[cur] || 150)) / 10) * 10;
  }

  function extract() {
    const ld = jsonLdProduct();
    const offer = ld && [].concat(ld.offers || [])[0];
    const amazonPrice = $(
      "#corePrice_feature_div .a-offscreen, #corePriceDisplay_desktop_feature_div .a-offscreen, #apex_desktop .a-offscreen, #price_inside_buybox, #priceblock_ourprice",
    );
    const ebayPrice = $(".x-price-primary");
    const itempropPrice = $('[itemprop="price"]');

    let price = 0;
    if (amazonPrice) price = toYen(amazonPrice.textContent);
    else if (ebayPrice) price = toYen(ebayPrice.textContent);
    else if (offer && (offer.price ?? offer.lowPrice) != null)
      price = toYen(offer.price ?? offer.lowPrice, offer.priceCurrency);
    else {
      const amount =
        meta("product:price:amount") ||
        meta("og:price:amount") ||
        (itempropPrice && (itempropPrice.getAttribute("content") || itempropPrice.textContent));
      price = toYen(amount, meta("product:price:currency") || meta("og:price:currency") || meta("priceCurrency"));
    }

    const name =
      clean($("#productTitle")?.textContent) ||
      clean($(".x-item-title__mainTitle")?.textContent) ||
      clean(ld?.name) ||
      clean(meta("og:title")) ||
      clean(document.title);

    const landing = $("#landingImage") || $("#imgBlkFront");
    let ldImage = ld && [].concat(ld.image || [])[0];
    if (ldImage && typeof ldImage === "object") ldImage = ldImage.url || ldImage.contentUrl;
    let image =
      landing?.getAttribute("data-old-hires") || landing?.src || ldImage || meta("og:image") || meta("twitter:image");
    try {
      image = image ? new URL(image, location.href).href : "";
    } catch {
      image = "";
    }
    if (image.startsWith("data:")) image = "";

    const isProduct = !!(ld || amazonPrice || ebayPrice || meta("og:type") === "product" || price > 0);
    return { name: name.slice(0, 90), price, image, isProduct };
  }

  /* ---------------------------------------------------------------- */
  /* Little DOM helpers (no innerHTML, no stylesheets)                 */
  /* ---------------------------------------------------------------- */

  const Z = "2147483647";
  const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",system-ui,sans-serif';
  const AMBER = "#ba6a36";
  const yen = (n) => "¥" + Math.max(0, Math.round(n)).toLocaleString("ja-JP");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function el(tag, css, text) {
    const e = document.createElement(tag);
    e.style.cssText = "all:initial;box-sizing:border-box;font-family:" + FONT + ";" + css;
    if (text != null) e.textContent = text;
    return e;
  }

  const animations = [];
  function play(target, keyframes, options) {
    const a = target.animate(keyframes, { fill: "both", ...options });
    animations.push(a);
    return a;
  }

  function rise(target, delay) {
    play(
      target,
      [
        { opacity: 0, transform: "translateY(24px)", filter: "blur(6px)" },
        { opacity: 1, transform: "none", filter: "none" },
      ],
      { duration: 800, delay, easing: "cubic-bezier(.2,.7,.2,1)" },
    );
  }

  /** Mid-sized visible blocks of the page: the pieces that will fall. */
  function chunks(root) {
    const vw = innerWidth;
    const vh = innerHeight;
    const big = vw * vh * 0.18;
    const out = [];
    const visit = (node) => {
      for (const c of node.children) {
        if (out.length > 140) return;
        if (c === root || c.tagName === "SCRIPT" || c.tagName === "STYLE") continue;
        const r = c.getBoundingClientRect();
        const area = r.width * r.height;
        if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw || area < 300) continue;
        if (area > big && c.children.length) visit(c);
        else out.push(c);
      }
    };
    visit(document.body);
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* The 化ける sequence: glitch → the shop falls apart → reveal        */
  /* ---------------------------------------------------------------- */

  let running = false;
  let root = null;
  let fab = null;

  function restore() {
    for (const a of animations.splice(0)) a.cancel();
    root?.remove();
    root = null;
    running = false;
    if (fab) fab.style.display = "flex";
    document.removeEventListener("keydown", onKey, true);
  }

  function onKey(e) {
    if (e.key === "Escape") restore();
  }

  async function run() {
    if (running) return;
    running = true;
    if (fab) fab.style.display = "none";
    document.addEventListener("keydown", onKey, true);

    const product = extract();
    root = el("div", `position:fixed;inset:0;z-index:${Z};pointer-events:none;overflow:hidden;`);
    document.documentElement.appendChild(root);

    // 1. Glitch the whole shop.
    play(
      document.body,
      [
        { transform: "none", filter: "none" },
        { transform: "translate(-6px,2px) skewX(-2deg)", filter: "hue-rotate(90deg) saturate(3)" },
        { transform: "translate(5px,-3px)", filter: "invert(1)" },
        { transform: "translate(-3px,4px) skewX(3deg)", filter: "hue-rotate(-120deg) contrast(2)" },
        { transform: "translate(8px,0)", filter: "grayscale(1) contrast(3)" },
        { transform: "translate(-4px,-2px) skewX(-4deg)", filter: "invert(1) hue-rotate(45deg)" },
        { transform: "none", filter: "grayscale(1)" },
      ],
      { duration: 900, easing: "steps(7, end)" },
    );
    for (let i = 0; i < 7; i++) {
      const bar = el(
        "div",
        `position:absolute;left:0;right:0;top:${Math.random() * 100}%;height:${4 + Math.random() * 40}px;` +
          `background:${["#ff0050", "#00f0ff", "#fff"][i % 3]};mix-blend-mode:difference;opacity:0;`,
      );
      root.appendChild(bar);
      play(
        bar,
        [
          { opacity: 0, transform: "translateX(0)" },
          { opacity: 0.9, transform: `translateX(${(Math.random() - 0.5) * 120}px)` },
          { opacity: 0, transform: "translateX(0)" },
        ],
        { duration: 300, delay: Math.random() * 600, iterations: 2, easing: "steps(3, end)" },
      );
    }
    await wait(900);

    // 2. Everything falls; the product stays, its price melting to ¥0.
    chunks(root).forEach((c, i) => {
      const tilt = ((i * 53) % 61) - 30;
      play(c, [{ transform: "none", opacity: 1 }, { transform: `translateY(120vh) rotate(${tilt}deg)`, opacity: 0 }], {
        duration: 1000,
        delay: (i % 10) * 50,
        easing: "cubic-bezier(.55,0,.9,.4)",
      });
    });
    play(document.body, [{ opacity: 1 }, { opacity: 0 }], { duration: 400, delay: 900 });

    const card = el(
      "div",
      "position:absolute;left:50%;top:50%;width:280px;margin:-170px 0 0 -140px;background:#fff;border-radius:18px;" +
        "padding:16px;box-shadow:0 30px 80px rgba(0,0,0,.35);display:flex;flex-direction:column;align-items:center;",
    );
    if (product.image) {
      card.appendChild(
        Object.assign(el("img", "width:180px;height:180px;object-fit:contain;display:block;"), {
          src: product.image,
          alt: "",
        }),
      );
    }
    card.appendChild(
      el(
        "div",
        "margin-top:10px;font-size:13px;line-height:1.4;color:#222;text-align:center;max-height:3.6em;overflow:hidden;",
        product.name,
      ),
    );
    const price = el("div", "margin-top:8px;font-size:26px;font-weight:600;color:#111;", yen(product.price));
    card.appendChild(price);
    root.appendChild(card);
    play(card, [{ opacity: 0, transform: "scale(.85)" }, { opacity: 1, transform: "scale(1)" }], {
      duration: 400,
      easing: "cubic-bezier(.2,.7,.2,1)",
    });

    const start = performance.now();
    await new Promise((done) => {
      const tick = (t) => {
        if (!running) return done();
        const k = Math.min(1, (t - start) / 1100);
        price.textContent = yen(product.price * (1 - k * k));
        if (k < 1) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    if (!running) return;
    price.style.color = AMBER;
    await wait(300);
    if (!running) return;

    // 3. Reveal.
    const stage = el(
      "div",
      "position:absolute;inset:0;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;" +
        "padding:24px;pointer-events:auto;",
    );
    play(stage, [{ opacity: 0 }, { opacity: 1 }], { duration: 600, easing: "ease-out" });
    const col = el("div", "display:block;width:100%;max-width:560px;text-align:center;color:#fff;");
    stage.appendChild(col);

    const wait1 = el(
      "div",
      "display:block;font-size:clamp(44px,9vw,76px);font-weight:300;letter-spacing:-.02em;color:#fff;",
      "待って。",
    );
    const wait2 = el(
      "div",
      "display:block;margin-top:24px;font-size:clamp(17px,3vw,24px);font-weight:300;color:rgba(255,255,255,.7);",
      "それ、家にあるゴミで作れます。",
    );
    col.append(wait1, wait2);

    const mini = el(
      "div",
      "display:flex;align-items:center;gap:16px;margin:40px auto 0;max-width:380px;padding:16px;text-align:left;" +
        "border:1px solid rgba(255,255,255,.15);border-radius:16px;",
    );
    if (product.image) {
      mini.appendChild(
        Object.assign(
          el("img", "width:64px;height:64px;flex-shrink:0;border-radius:10px;background:#fff;object-fit:contain;padding:4px;"),
          { src: product.image, alt: "" },
        ),
      );
    }
    const info = el("div", "display:block;min-width:0;");
    info.appendChild(
      el(
        "div",
        "display:block;font-size:14px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;",
        product.name,
      ),
    );
    const prices = el("div", "display:block;margin-top:6px;");
    if (product.price > 0) {
      prices.appendChild(
        el("span", "font-size:14px;color:rgba(255,255,255,.4);text-decoration:line-through;", yen(product.price)),
      );
    }
    prices.appendChild(el("span", "margin-left:12px;font-size:20px;color:#fff;", "¥0"));
    info.appendChild(prices);
    mini.appendChild(info);
    col.appendChild(mini);

    const actions = el("div", "display:flex;flex-direction:column;align-items:center;gap:16px;margin-top:40px;");
    const params = new URLSearchParams({
      want: product.name,
      price: String(product.price),
      img: product.image,
      from: location.hostname,
    });
    const go = el(
      "a",
      "display:inline-flex;align-items:center;height:48px;padding:0 32px;border-radius:999px;background:#fff;color:#000;" +
        "font-size:14px;font-weight:500;cursor:pointer;text-decoration:none;transition:background .2s;",
      "作り方を見る →",
    );
    go.href = `${ORIGIN}/?${params}#input`;
    go.addEventListener("mouseenter", () => (go.style.background = "rgba(255,255,255,.85)"));
    go.addEventListener("mouseleave", () => (go.style.background = "#fff"));
    const buy = el(
      "button",
      "font-size:12px;color:rgba(255,255,255,.4);background:none;border:0;cursor:pointer;text-underline-offset:4px;",
      "それでも買う",
    );
    buy.addEventListener("mouseenter", () => (buy.style.textDecoration = "underline"));
    buy.addEventListener("mouseleave", () => (buy.style.textDecoration = "none"));
    buy.addEventListener("click", restore);
    actions.append(go, buy);
    col.appendChild(actions);

    root.appendChild(stage);
    play(card, [{ opacity: 1 }, { opacity: 0 }], { duration: 300 });
    rise(wait1, 0);
    rise(wait2, 600);
    rise(mini, 1100);
    rise(actions, 1500);
  }

  window.__bakeru = { run };

  /* ---------------------------------------------------------------- */
  /* Extension: a floating 化ける button on product pages              */
  /* Bookmarklet: just run                                             */
  /* ---------------------------------------------------------------- */

  if (!IS_EXTENSION) return void run();
  if (!extract().isProduct) return;

  fab = el(
    "button",
    `position:fixed;right:24px;bottom:24px;z-index:${Z};display:flex;align-items:center;gap:10px;height:56px;` +
      "padding:0 24px 0 20px;border-radius:999px;border:0;background:#261311;color:#f9edf0;cursor:pointer;" +
      "box-shadow:0 12px 40px rgba(38,19,17,.35);transition:transform .2s;",
  );
  fab.append(
    el("span", `font-size:20px;color:${AMBER};`, "✦"),
    el("span", "font-size:17px;font-weight:600;letter-spacing:.08em;color:#f9edf0;", "化ける"),
    el("span", "font-size:11px;color:rgba(249,237,240,.6);", "ゴミで作る"),
  );
  fab.title = "BAKERU — 買う前に、ゴミで作れるか見てみる";
  fab.addEventListener("mouseenter", () => (fab.style.transform = "scale(1.05)"));
  fab.addEventListener("mouseleave", () => (fab.style.transform = "none"));
  fab.addEventListener("click", run);
  document.documentElement.appendChild(fab);
  fab.animate(
    [
      { boxShadow: "0 12px 40px rgba(38,19,17,.35), 0 0 0 0 rgba(186,106,54,.6)" },
      { boxShadow: "0 12px 40px rgba(38,19,17,.35), 0 0 0 16px rgba(186,106,54,0)" },
    ],
    { duration: 1800, iterations: Infinity },
  );
})();
