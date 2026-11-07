// Measures 3D model quality and speed against a running dev server.
//
//   npm run dev            (in another terminal)
//   npm run eval           (or: node scripts/eval-models.mjs http://localhost:3000)
//
// For each fixed input it records the total time, how many geometry problems
// the AI's own model had (before any repair), and how many are left in the
// model the user sees. Uses your ANTHROPIC_API_KEY through the server, so each
// run costs about 8 Opus requests.

import { findIssues } from "../src/lib/geometry-check.ts";

const BASE = process.argv[2] ?? "http://localhost:3000";
const LIMIT_S = 120;

const CASES = [
  { name: "スマホスタンド", want: { name: "スマホスタンド", price: 1980 }, trash: ["段ボール", "トイレットペーパーの芯"] },
  { name: "ペン立て", want: { name: "ペン立て", price: 1200 }, trash: ["空き缶", "牛乳パック", "トイレットペーパーの芯"] },
  { name: "自動給水プランター", trash: ["ペットボトル", "段ボール"], problem: "旅行に行くと植物が枯れてしまう" },
  { name: "引き出し収納", want: { name: "デスク収納ボックス", price: 2480 }, trash: ["段ボール", "牛乳パック"] },
  { name: "小物トレー", want: { name: "アクセサリートレー", price: 1500 }, trash: ["牛乳パック", "ペットボトル"] },
  { name: "ケーブル整理", trash: ["トイレットペーパーの芯", "段ボール"], problem: "机の上のケーブルがぐちゃぐちゃ" },
  { name: "鳥のえさ台", want: { name: "バードフィーダー", price: 2980 }, trash: ["ペットボトル", "空き缶"] },
  { name: "ブックスタンド", want: { name: "ブックスタンド", price: 1680 }, trash: ["段ボール", "空き缶"] },
];

async function run(c) {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/transform`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trash: c.trash, want: c.want, problem: c.problem, extra: "" }),
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let final = null;
  let error = null;
  let firstPart = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.t === "d") {
        text += ev.d;
        if (!firstPart && text.includes('"parts"')) firstPart = Date.now() - started;
      } else if (ev.t === "reset") text = "";
      else if (ev.t === "final") final = ev;
      else if (ev.t === "e") error = ev.error;
    }
    if (done) break;
  }
  const seconds = (Date.now() - started) / 1000;
  if (!final) return { name: c.name, seconds, error: error ?? "no result" };

  const parts = final.blueprint.parts;
  // The server reports the AI's own (pre-repair) issue count; older servers don't, so
  // fall back to checking the raw streamed parts when they carry absolute positions.
  let raw = final.quality?.raw_issues;
  if (raw === undefined) {
    try {
      const rawParts = JSON.parse(text).parts;
      if (rawParts?.every((p) => p.position)) raw = findIssues(rawParts).length;
    } catch {}
  }
  const left = findIssues(parts);
  return {
    name: c.name,
    seconds,
    firstPart: firstPart / 1000,
    parts: parts.length,
    raw,
    left: left.length,
    leftKinds: left.map((i) => i.kind).join(","),
    repaired: final.quality?.repaired,
  };
}

const results = await Promise.all(CASES.map((c) => run(c).catch((e) => ({ name: c.name, error: String(e) }))));

const pad = (s, n) => String(s ?? "—").padEnd(n);
console.log(`\n${pad("case", 14)}${pad("time", 8)}${pad("parts@", 8)}${pad("parts", 7)}${pad("AI issues", 11)}${pad("left", 6)}notes`);
for (const r of results) {
  if (r.error) {
    console.log(`${pad(r.name, 14)}${pad(r.seconds?.toFixed(0) + "s", 8)}ERROR ${r.error}`);
    continue;
  }
  const slow = r.seconds > LIMIT_S ? " OVER 2 MIN" : "";
  console.log(
    `${pad(r.name, 14)}${pad(r.seconds.toFixed(0) + "s", 8)}${pad(r.firstPart.toFixed(0) + "s", 8)}${pad(r.parts, 7)}${pad(r.raw, 11)}${pad(r.left, 6)}${r.leftKinds}${r.repaired ? " repaired" : ""}${slow}`,
  );
}
const ok = results.filter((r) => !r.error);
const sum = (f) => ok.reduce((a, r) => a + (f(r) ?? 0), 0);
console.log(
  `\nok ${ok.length}/${results.length} · avg ${(sum((r) => r.seconds) / ok.length).toFixed(0)}s · max ${Math.max(...ok.map((r) => r.seconds)).toFixed(0)}s · AI issues ${sum((r) => r.raw)} · left ${sum((r) => r.left)}`,
);
