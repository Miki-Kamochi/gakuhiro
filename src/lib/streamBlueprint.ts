import { partialParse } from "@anthropic-ai/sdk/_vendor/partial-json-parser/parser";
import { AIPartSchema, PartSchema, StepSchema, type AIPart, type Blueprint, type Part } from "@/lib/blueprint";
import { resolveParts } from "@/lib/placement";

/**
 * Turn the half-written JSON from the stream into a displayable Blueprint.
 * Only parts that are certainly finished are included (every part except the
 * one still being written), so the 3D viewer never sees half-parsed numbers.
 * Returns null until there is at least a title.
 */
export function previewBlueprint(text: string): Blueprint | null {
  let raw: Record<string, unknown>;
  try {
    raw = (partialParse(text) ?? {}) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof raw.title !== "string" || !raw.title) return null;

  const rawParts = Array.isArray(raw.parts) ? raw.parts : [];
  const partsDone = "steps" in raw;
  // The AI writes placements (resolved here, the same way the server does);
  // the demo replay writes absolute positions.
  const finished = partsDone ? rawParts : rawParts.slice(0, -1);
  const placed: AIPart[] = [];
  const absolute: Part[] = [];
  for (const p of finished) {
    const a = AIPartSchema.safeParse(p);
    if (a.success) placed.push(a.data);
    else {
      const r = PartSchema.safeParse(p);
      if (r.success) absolute.push(r.data);
    }
  }
  const parts = placed.length ? resolveParts(placed, { partial: !partsDone }) : absolute;

  const steps = (Array.isArray(raw.steps) ? raw.steps : []).flatMap((s) => {
    const r = StepSchema.partial().safeParse(s);
    return r.success && r.data.title
      ? [{ title: r.data.title, summary: r.data.summary ?? "", actions: r.data.actions ?? [], tip: r.data.tip ?? "", caution: r.data.caution ?? "" }]
      : [];
  });

  const detected = (raw.detected ?? {}) as { items?: unknown; materials?: unknown };
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const num = (v: unknown) => (typeof v === "number" ? v : 0);

  return {
    title: raw.title,
    tagline: typeof raw.tagline === "string" ? raw.tagline : "",
    detected: { items: strings(detected.items), materials: strings(detected.materials) },
    problem_solved: typeof raw.problem_solved === "string" ? raw.problem_solved : "",
    difficulty: num(raw.difficulty),
    time_minutes: num(raw.time_minutes),
    tools: strings(raw.tools),
    co2_saved_g: num(raw.co2_saved_g),
    parts,
    steps,
  };
}

export type StreamEvent =
  | { t: "d"; d: string }
  | { t: "reset" }
  | { t: "final"; blueprint: Blueprint; demo: boolean; ms: number; quality?: { raw_issues: number; final_issues: number; repaired: boolean } }
  | { t: "e"; error: string };

/** Read an NDJSON response line by line. */
export async function* readEvents(res: Response): AsyncGenerator<StreamEvent> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line) as StreamEvent;
    }
    if (done) return;
  }
}
