import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { AIBlueprintSchema, DEMO_BLUEPRINT, PartSchema, type Blueprint } from "@/lib/blueprint";
import { resolveParts } from "@/lib/placement";
import { findIssues, settle } from "@/lib/geometry-check";

const SYSTEM = `あなたは「化けラボ」というアップサイクル設計士です。
ユーザーは、家にあるゴミのリストや写真と、「買おうとしていた物」または生活の中の困りごとを送ってきます。
リストや写真にあるゴミと一般的な家庭の道具だけで作れる「役に立つ物」を1つ考えてください。
「買おうとしていた物」がある場合は、それと同じ役割を果たす物をゴミで作る設計にしてください（買わずに済むように）。
リストや写真にあるゴミをすべて使う必要はありません。作りやすさと完成度を優先してください。
ありきたりではなく、驚きのある変身を優先してください。ただし1時間以内で作れるものにします。

出力はすべて日本語で書いてください（色の16進数とidを除く）。

部品 (parts):
- 切り出す・用意する1枚1枚を別の部品にする（例: 段ボールの前面パネルと背面パネルは別々）。
- 各部品に、切り出すサイズ (dimensions) と作り方 (make) を具体的に書く。
- step には、その部品を取り付ける手順の番号を入れる。部品は5〜12個。

3Dモデル（とても重要。そのまま3D表示されます）:
- 単位はcm、Yが上、+Zが手前（front）、+Xが右（right）。
- 座標は書かない。各部品の place で「どの部品の上・中・横に置くか」を言えば、位置はプログラムが正確に計算する。
  - ground: 地面に置く。最初の部品（土台）は必ず ground。
  - on: ref の上面に載せる。align で上面の中央か、front/back/left/right の辺にぴったりそろえる。
  - inside: ref（cup・tray・tube）の内側の底に入れる。中身は容器の内側に合わせて自動で小さくなる。
  - beside: ref の横（align の側）に、すき間なくくっつけて同じ床に置く。
  - under: ref の下面にくっつける（つり下げる物）。
  - ref には必ず、この部品より前に書いた部品の id を書く。土台 → 壁 → 中身 → 飾り の順に書く。
  - offset は、そろえた位置からさらにずらすときだけ使う（普通は 0,0,0）。例: 板の上で中央から右へ3cm → x=3。
- 向き: cylinder・cup・tube・cone は upright で縦向き。横に寝かせるなら lying_x（左右に寝かせる）か lying_z（前後に寝かせる）。逆さのボトル上半分は upside_down。立てかける板は tilt_deg（後ろへの傾き、10〜30度）。
- 形の選び方: 切ったペットボトル・缶・コップは cup（上が開いた円筒）、トイレットペーパーの芯は tube、切った牛乳パックやふたのない箱は tray、段ボールの板は box、中身の詰まった物だけ cylinder。容器を cylinder や box で塗りつぶさない。
- 実物の大きさを使う: 500mlペットボトル 直径6.5×高さ20、2Lペットボトル 直径10.5×高さ30、1L牛乳パック 7×7×19.5、トイレットペーパーの芯 直径4×高さ11、350ml缶 直径6.6×高さ12.2。
- 板の厚さ: 段ボール 0.5、牛乳パック 0.1、ペットボトルの壁 0.1（cup・tube の size.z）。板(box)は size で向きを表す（立てた前面パネル: x=幅, y=高さ, z=厚さ0.5）。
- 箱を板で組むとき: 底板の上に、前後の板を align front/back で載せ（幅は底板と同じ）、左右の板を align left/right で載せる（奥行きは 底板 − 板の厚さ×2 にして前後の板の内側にはめる）。
- 色は実際の素材に近づける（段ボール #c69a6a、ペットボトル #cfe8f5、牛乳パック #f4f1ea、缶 #b9bec4、芯 #d9c4a3）。

置き方の例（形・size・orientation・place だけ抜き出したもの）:
- 段ボールの箱: base box 13×0.5×13 ground ／ front box 13×12×0.5 on base front ／ back box 13×12×0.5 on base back ／ left box 0.5×12×12 on base left ／ right box 0.5×12×12 on base right
- 缶と芯のペン立て: can cup 6.6×12.2×0.1 ground ／ roll_l tube 4×11×0.1 beside can left ／ roll_r tube 4×11×0.1 beside can right ／ pens cylinder 1×14 inside can center
- スマホスタンド: base box 10×0.5×9 ground ／ back box 10×12×0.5 on base back tilt_deg 20 ／ lip box 10×1.5×0.5 on base front ／ roll tube 4×11×0.1 orientation lying_x, on base center, offset z=1（手前に1cm）
- 自動給水プランター: tank cup 10.5×12×0.1 ground ／ water cylinder 10×5 inside tank ／ top cone 10.5×12 upside_down on tank ／ herb sphere 7 on top center

手順 (steps):
- 7〜10手順。初めて作る人が、説明だけを見て迷わず完成できるように細分化する。1つの手順では1つのまとまった作業だけをする。
- 手順1は必ず「材料を切り出す」: 最初の action でゴミを洗う・乾かす・ラベルをはがすことを書き、続けて使う部品をすべて、1部品につき1つの action で「どのゴミから・何cm×何cmを・何枚・どの道具で切り出すか」を書く。この手順では組み立てない。
- 手順2以降の流れ: 印をつける → 穴をあける・折る・曲げる → 仮組みして確かめる → 1か所ずつ固定する → 乾かす・補強する → 仕上げ・使い方。組み立ては、部品1〜2個ずつ別の手順に分ける。
- 各手順の actions は2〜5個。1つの action は1つの動作だけにし、次を具体的に書く:
  - どの部品に・どこから何cmの位置に（例:「底から12cmの位置に油性ペンで1周線を引く」）
  - どの道具で・どうやって（例:「カッターで切れ目を入れてから、ハサミで線に沿って切る」）
  - 向き・合わせる位置（例:「切り口を上にして、缶の中央に立てる」）
  - 固定のしかたと量（例:「角の内側にガムテープを5cmずつ2か所貼る」「木工用ボンドを塗って10分押さえる」）
  - できたかどうかの確認（例:「ぐらつかないか、軽く押して確かめる」）
- 部品の step は、その部品を取り付ける（組み込む）手順の番号にする（切り出すだけの手順1ではなく、2以降）。
- tip にはうまくいくコツ、caution には刃物・切り口・キリなどの安全上の注意を書く。

文章は1文ずつ短く。考える時間は、3Dモデルの寸法と位置の正確さと、手順の具体さに使ってください。`;

/** Second, faster pass: fix only the coordinates of a model whose geometry check failed. */
const REPAIR_SYSTEM = `あなたは3Dモデルの寸法チェック担当です。アップサイクル作品の3Dモデル（部品の形・寸法・位置・回転）と、自動チェックで見つかった問題点が渡されます。
問題点がすべて解消されるように、部品の shape・size・position・rotation を直してください。
- 単位はcm、Yが上、地面は y=0。position は部品の中心。地面に置く部品は position.y = size.y/2、上に載せる部品は 下の部品の上端 + 自分の高さ/2。
- 部品同士は面で接するように置き、宙に浮かせない。容器（cup・tube・tray）の中身は容器の内側に収める。
- 板で箱を組むときは、左右の板を前後の板の内側に入れ、角でめり込ませない。
- 作品のデザイン・部品の数・大きさの比率はできるだけ変えない。問題のない部品はそのまま返す。
- すべての部品を id 付きで返す。`;

const RepairSchema = z.object({
  parts: z.array(
    PartSchema.pick({ id: true, shape: true, size: true, position: true, rotation: true }),
  ),
});

/** Hard ceiling for the whole request, so the build always appears within two minutes. */
const TOTAL_BUDGET_MS = 115_000;
/** A repair pass is only worth starting if this much time is left. */
const REPAIR_MIN_MS = 25_000;

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

/** Generating a full blueprint can take a minute; don't let the platform cut it off. */
export const maxDuration = 300;

type Body = {
  image?: string;
  mediaType?: string;
  problem?: string;
  trash?: string[];
  extra?: string;
  want?: { name?: string; price?: number };
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });
  }
  const { image, mediaType, problem, trash, extra, want } = body;

  const trashList = (Array.isArray(trash) ? trash : []).map((t) => String(t).slice(0, 50)).slice(0, 20);
  const extraText = extra?.trim().slice(0, 300) ?? "";

  if (image && !MEDIA_TYPES.includes(mediaType as MediaType)) {
    return Response.json({ error: "JPEG・PNG・WebP・GIFの写真を添付してください。" }, { status: 400 });
  }
  if (!image && trashList.length === 0 && !extraText) {
    return Response.json({ error: "使えるゴミを1つ以上選ぶか、写真を追加してください。" }, { status: 400 });
  }

  const lines = [
    want?.name ? `買おうとしていた物: ${String(want.name).slice(0, 200)}${want.price ? `（¥${want.price}）` : ""}` : "",
    trashList.length ? `家にあるゴミ: ${trashList.join("、")}` : "",
    extraText ? `その他に使えそうな物: ${extraText}` : "",
    image ? "写真にも使えそうなゴミが写っています。" : "",
    problem?.trim() ? `困りごと: ${problem.trim().slice(0, 500)}` : "",
  ].filter(Boolean);
  if (!want?.name && !problem?.trim()) lines.push("特に困りごとはありません。驚くような役に立つ物を考えてください。");

  const content = [
    ...(image
      ? [{ type: "image" as const, source: { type: "base64" as const, media_type: mediaType as MediaType, data: image } }]
      : []),
    { type: "text" as const, text: lines.join("\n") },
  ];

  return streamResponse(async (send) => {
    // APIキーが無い場合はデモを返す（UIを常に見せられるように）
    if (!process.env.ANTHROPIC_API_KEY) return streamDemo(send);
    return streamClaude(send, content);
  });
}

/* ------------------------------------------------------------------ */
/* Streaming                                                           */
/*                                                                     */
/* The response is NDJSON, one event per line:                         */
/*   {"t":"d","d":"<json text delta>"}  preview while the AI writes    */
/*   {"t":"reset"}                      a fallback model took over     */
/*   {"t":"final","blueprint":{…},"demo":bool,"ms":n}  authoritative   */
/*   {"t":"e","error":"…"}                                             */
/* ------------------------------------------------------------------ */

type Send = (event: Record<string, unknown>) => void;

function streamResponse(run: (send: Send) => Promise<void>) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      let open = true;
      // The visitor may leave mid-generation; writing to a closed stream must not crash the request.
      const send: Send = (event) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          open = false;
        }
      };
      try {
        await run(send);
      } catch (error) {
        send({ t: "e", error: errorMessage(error) });
      }
      if (open) {
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
      }
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}

/** Model and speed knobs, so the team can trade quality for latency without code changes. */
const MODEL = process.env.BAKERU_MODEL || "claude-opus-5-5";
const EFFORT = (process.env.BAKERU_EFFORT || "medium") as "low" | "medium" | "high";
/** Fast mode (Claude Opus only, research preview, premium price): BAKERU_FAST=1. */
const FAST = process.env.BAKERU_FAST === "1";

type Content = Anthropic.Beta.BetaContentBlockParam[];

async function streamClaude(send: Send, content: Content) {
  const client = new Anthropic();
  const started = Date.now();
  let firstToken = 0;

  const open = (fast: boolean) =>
    client.beta.messages.stream({
      model: MODEL,
      max_tokens: 12000,
      betas: fast ? ["server-side-fallback-2026-07-01", "fast-mode-2026-02-01"] : ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      ...(fast ? { speed: "fast" as const } : {}),
      output_config: { effort: EFFORT, format: betaZodOutputFormat(AIBlueprintSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });

  let stream = open(FAST);
  let sent = false;
  const pump = async () => {
    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "fallback") {
        send({ t: "reset" });
      } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        if (!firstToken) firstToken = Date.now() - started;
        sent = true;
        send({ t: "d", d: event.delta.text });
      }
    }
    return stream.finalMessage();
  };

  let message: Anthropic.Beta.BetaMessage;
  try {
    message = await pump();
  } catch (error) {
    // Fast mode not enabled for this key, or its separate rate limit: retry at standard speed.
    if (!FAST || sent || !(error instanceof Anthropic.APIError)) throw error;
    stream = open(false);
    message = await pump();
  }

  const ms = Date.now() - started;
  console.log(`[transform] ${MODEL} effort=${EFFORT} fast=${FAST} first-token=${firstToken}ms total=${ms}ms out=${message.usage.output_tokens}`);

  if (message.stop_reason === "refusal") {
    return send({ t: "e", error: "この内容からは作品を考えられませんでした。別のゴミで試してください。" });
  }
  if (message.stop_reason === "max_tokens") {
    return send({ t: "e", error: "設計図が長くなりすぎました。もう一度お試しください。" });
  }

  // Use the text written after the last fallback switch, if any.
  const lastFallback = message.content.map((b) => b.type).lastIndexOf("fallback");
  const text = message.content
    .slice(lastFallback + 1)
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return send({ t: "e", error: "AIの出力を読み取れませんでした。もう一度お試しください。" });
  }
  const result = AIBlueprintSchema.safeParse(parsed);
  if (!result.success) {
    return send({ t: "e", error: "AIの出力が不完全でした。もう一度お試しください。" });
  }

  // The AI says where parts go; work out the exact coordinates here.
  const placed: Blueprint = { ...result.data, parts: resolveParts(result.data.parts) };
  const { blueprint, quality } = await polishGeometry(client, placed, started);
  send({ t: "final", blueprint, demo: false, ms: Date.now() - started, quality });
}

/** How clean the AI's model was, for logs and scripts/eval-models.mjs. */
type Quality = { raw_issues: number; final_issues: number; repaired: boolean };

/**
 * Check the model for overlaps / floating parts. If there are problems and
 * time left, ask for a quick coordinate-only repair; then always settle the
 * model onto the ground. Never throws: on any failure the original is used.
 */
async function polishGeometry(
  client: Anthropic,
  bp: Blueprint,
  started: number,
): Promise<{ blueprint: Blueprint; quality: Quality }> {
  let parts = bp.parts;
  // Floating parts alone don't need the AI: settle() drops them into place.
  const issues = findIssues(parts);
  const left = TOTAL_BUDGET_MS - (Date.now() - started);
  let repaired = false;

  if (issues.some((i) => i.kind !== "floating") && left > REPAIR_MIN_MS) {
    const t0 = Date.now();
    try {
      const model = parts.map(({ id, name, shape, size, position, rotation }) => ({ id, name, shape, size, position, rotation }));
      const response = await client.beta.messages.parse(
        {
          model: MODEL,
          max_tokens: 6000,
          output_config: { effort: "low", format: betaZodOutputFormat(RepairSchema) },
          system: REPAIR_SYSTEM,
          messages: [
            {
              role: "user",
              content: `作品: ${bp.title}\n\n部品:\n${JSON.stringify(model)}\n\n問題点:\n${issues.map((i) => `- ${i.text}`).join("\n")}`,
            },
          ],
        },
        { timeout: left - 3000, maxRetries: 0 },
      );
      const fixes = new Map((response.parsed_output?.parts ?? []).map((p) => [p.id, p]));
      const candidate = parts.map((p) => {
        const f = fixes.get(p.id);
        return f ? { ...p, shape: f.shape, size: f.size, position: f.position, rotation: f.rotation } : p;
      });
      // Keep the repair only if it actually reduced the problems.
      if (findIssues(candidate).length < issues.length) {
        parts = candidate;
        repaired = true;
      }
    } catch (error) {
      console.warn("[transform] repair skipped:", error instanceof Error ? error.message : error);
    }
    console.log(`[transform] repair ${repaired ? "applied" : "discarded"} in ${Date.now() - t0}ms (${issues.length} issues)`);
  }

  parts = settle(parts);
  console.log(`[transform] geometry: ${issues.length} issues before, ${findIssues(parts).length} after`);
  return { blueprint: { ...bp, parts }, quality: { raw_issues: issues.length, final_issues: findIssues(parts).length, repaired } };
}

/** Without an API key: replay the demo blueprint as a fake stream so the UI looks the same. */
async function streamDemo(send: Send) {
  const started = Date.now();
  const ordered: Blueprint = {
    title: DEMO_BLUEPRINT.title,
    tagline: DEMO_BLUEPRINT.tagline,
    detected: DEMO_BLUEPRINT.detected,
    problem_solved: DEMO_BLUEPRINT.problem_solved,
    difficulty: DEMO_BLUEPRINT.difficulty,
    time_minutes: DEMO_BLUEPRINT.time_minutes,
    tools: DEMO_BLUEPRINT.tools,
    co2_saved_g: DEMO_BLUEPRINT.co2_saved_g,
    parts: DEMO_BLUEPRINT.parts,
    steps: DEMO_BLUEPRINT.steps,
  };
  const json = JSON.stringify(ordered);
  const chunk = 60;
  for (let i = 0; i < json.length; i += chunk) {
    send({ t: "d", d: json.slice(i, i + chunk) });
    await new Promise((r) => setTimeout(r, 25));
  }
  send({ t: "final", blueprint: ordered, demo: true, ms: Date.now() - started });
}

function errorMessage(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "APIキーが無効です。";
  if (error instanceof Anthropic.RateLimitError) return "リクエストが多すぎます。少し待ってから再度お試しください。";
  if (error instanceof Anthropic.APIError) {
    console.error("[transform] API error", error.status, error.message);
    const busy = error.status === 529 || error.status === 503;
    return busy ? "AIが混み合っています。少し待ってからもう一度お試しください。" : "AIとの通信に失敗しました。もう一度お試しください。";
  }
  console.error("[transform] unexpected error", error);
  return "予期しないエラーが発生しました。もう一度お試しください。";
}
