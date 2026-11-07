import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { BlueprintSchema, DEMO_BLUEPRINT } from "@/lib/blueprint";

const SYSTEM = `あなたは「BAKERU（化ける）」というアップサイクル設計士です。
ユーザーは、ゴミやいらなくなった物の写真と、生活の中の困りごと（任意）を送ってきます。
写真に写っている物と一般的な家庭の道具だけで、その困りごとを解決する「役に立つ物」を1つ考えてください。
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

export async function POST(request: Request) {
  const { image, mediaType, problem } = (await request.json()) as {
    image?: string;
    mediaType?: string;
    problem?: string;
  };

  if (!image || !MEDIA_TYPES.includes(mediaType as MediaType)) {
    return Response.json({ error: "JPEG・PNG・WebP・GIFの写真を添付してください。" }, { status: 400 });
  }

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
            { type: "image", source: { type: "base64", media_type: mediaType as MediaType, data: image } },
            {
              type: "text",
              text: problem?.trim()
                ? `困りごと: ${problem.trim()}`
                : "特に困りごとはありません。驚くような役に立つ物を考えてください。",
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return Response.json({ error: "この写真からは作品を考えられませんでした。別の写真を試してください。" }, { status: 422 });
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
      return Response.json({ error: `AIエラー ${error.status}: ${error.message}` }, { status: 502 });
    }
    throw error;
  }
}
