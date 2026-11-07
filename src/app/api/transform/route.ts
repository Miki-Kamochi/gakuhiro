import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { BlueprintSchema, DEMO_BLUEPRINT } from "@/lib/blueprint";

const SYSTEM = `You are BAKERU (化ける), an upcycling engineer.
The user shows you a photo of trash or things they no longer need, and optionally a problem in their life.
Invent ONE genuinely useful object they can build from what is in the photo, plus common household tools, that solves their problem.
Prefer clever, surprising transformations over obvious ones, but it must be buildable in under an hour.

Then describe it as a 3D model made of simple primitives (box, cylinder, sphere, cone, torus), in centimeters, Y up, resting on y = 0.
Use 4–14 parts. Parts must touch or overlap so the model reads as one object. Give each part the build step that adds it, and colors that resemble the real material.
Write 3–7 build steps. Be concrete and safe.`;

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

export async function POST(request: Request) {
  const { image, mediaType, problem } = (await request.json()) as {
    image?: string;
    mediaType?: string;
    problem?: string;
  };

  if (!image || !MEDIA_TYPES.includes(mediaType as MediaType)) {
    return Response.json({ error: "Please attach a JPEG, PNG, WebP or GIF photo." }, { status: 400 });
  }

  // No key configured: return the built-in demo so the UI can still be shown.
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
      output_config: { effort: "low", format: betaZodOutputFormat(BlueprintSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType as MediaType, data: image } },
            {
              type: "text",
              text: problem?.trim()
                ? `My problem: ${problem.trim()}`
                : "I have no specific problem. Surprise me with something useful.",
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return Response.json({ error: "The AI could not turn this photo into a build. Try another photo." }, { status: 422 });
    }

    return Response.json({ blueprint: response.parsed_output, demo: false });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return Response.json({ error: "The API key was rejected." }, { status: 500 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "Rate limited. Wait a moment and try again." }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      return Response.json({ error: `AI error ${error.status}: ${error.message}` }, { status: 502 });
    }
    throw error;
  }
}
