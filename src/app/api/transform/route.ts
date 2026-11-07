import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { BlueprintSchema, DEMO_BLUEPRINT } from "@/lib/blueprint";

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
- 部品は4〜16個。部品同士は接するか重なり、1つの物に見えるようにする。色は実際の素材に近づける。
- step には、その部品を取り付ける手順の番号を入れる。

手順 (steps):
- 3〜7手順。前半で素材を切り出す・準備する手順を入れる。
- 各手順の actions には、寸法・位置・道具を含めた具体的な作業を3〜6個書く。
- 安全に作れるように注意点を書く。`;

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

  // APIキーが無い場合はデモを返す（UIを常に見せられるように）
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ blueprint: DEMO_BLUEPRINT, demo: true });
  }

  const client = new Anthropic();

  try {
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(BlueprintSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            ...(image
              ? [{ type: "image" as const, source: { type: "base64" as const, media_type: mediaType as MediaType, data: image } }]
              : []),
            { type: "text" as const, text: lines.join("\n") },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return Response.json({ error: "この組み合わせからは作品を考えられませんでした。ゴミを変えるか、別の写真を試してください。" }, { status: 422 });
    }

    return Response.json({ blueprint: response.parsed_output, demo: false });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return Response.json({ error: "APIキーが無効です。" }, { status: 500 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "リクエストが多すぎます。少し待ってから再度お試しください。" }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      console.error("[transform] API error", error.status, error.message);
      const busy = error.status === 529 || error.status === 503;
      return Response.json(
        { error: busy ? "AIが混み合っています。少し待ってからもう一度お試しください。" : "AIとの通信に失敗しました。もう一度お試しください。" },
        { status: 502 },
      );
    }
    console.error("[transform] unexpected error", error);
    return Response.json({ error: "予期しないエラーが発生しました。もう一度お試しください。" }, { status: 500 });
  }
}
