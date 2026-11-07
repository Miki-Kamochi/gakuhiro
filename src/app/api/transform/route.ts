import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { BlueprintSchema, DEMO_BLUEPRINT, type Blueprint } from "@/lib/blueprint";

const SYSTEM = `あなたは「BAKERU（化ける）」というアップサイクル設計士です。
ユーザーは、家にあるゴミのリストや写真と、「買おうとしていた物」または生活の中の困りごとを送ってきます。
リストや写真にあるゴミと一般的な家庭の道具だけで作れる「役に立つ物」を1つ考えてください。
「買おうとしていた物」がある場合は、それと同じ役割を果たす物をゴミで作る設計にしてください（買わずに済むように）。
リストや写真にあるゴミをすべて使う必要はありません。作りやすさと完成度を優先してください。
ありきたりではなく、驚きのある変身を優先してください。ただし1時間以内で作れるものにします。

出力はすべて日本語で書いてください（色の16進数とidを除く）。

部品 (parts):
- 切り出す・用意する1枚1枚を別の部品にする（例: 段ボールの前面パネルと背面パネルは別々）。
- 各部品に、切り出すサイズ (dimensions) と作り方 (make) を具体的に書く。
- 3Dモデルは単純な形（box, cylinder, sphere, cone, torus）の組み合わせで、単位はcm、Yが上、地面は y=0。
- 部品は4〜12個。部品同士は接するか重なり、1つの物に見えるようにする。色は実際の素材に近づける。
- step には、その部品を取り付ける手順の番号を入れる。

手順 (steps):
- 3〜5手順。前半で素材を切り出す・準備する手順を入れる。
- 各手順の actions には、寸法・位置・道具を含めた具体的な作業を2〜4個、短く書く。
- 安全に作れるように注意点を書く。

速さが大切です。考えすぎず、文章は短く簡潔に。`;

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

export async function POST(request: Request) {
  const { image, mediaType, problem, trash, extra, want } = (await request.json()) as {
    image?: string;
    mediaType?: string;
    problem?: string;
    trash?: string[];
    extra?: string;
    want?: { name?: string; price?: number };
  };

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
      const send: Send = (event) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        await run(send);
      } catch (error) {
        send({ t: "e", error: errorMessage(error) });
      }
      controller.close();
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}

/** Model and speed knobs, so the team can trade quality for latency without code changes. */
const MODEL = process.env.BAKERU_MODEL || "claude-opus-5-5";
const EFFORT = (process.env.BAKERU_EFFORT || "low") as "low" | "medium" | "high";
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
      output_config: { effort: EFFORT, format: betaZodOutputFormat(BlueprintSchema) },
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
  const result = BlueprintSchema.safeParse(parsed);
  if (!result.success) {
    return send({ t: "e", error: "AIの出力が不完全でした。もう一度お試しください。" });
  }
  send({ t: "final", blueprint: result.data, demo: false, ms });
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
  if (error instanceof Anthropic.APIError) return `AIエラー ${error.status}: ${error.message}`;
  console.error(error);
  return "エラーが発生しました。もう一度お試しください。";
}
