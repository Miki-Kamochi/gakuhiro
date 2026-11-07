# 化けラボ (BAKE LAB)

**いらないものが、使えるものに化ける。** Turn trash into something useful.

Take a photo of something you don't need, optionally describe a problem you have, and AI:

1. **Sees** the objects and materials in the photo (Claude vision).
2. **Invents** one useful thing you can build from them that solves your problem.
3. **Generates** a cut list (every piece with its size and how to make it), detailed step-by-step instructions, and a 3D model. In the 3D viewer, each step's parts fly in and snap into place; there is also an exploded view, and clicking a part shows how to make it.

The whole UI and the AI output are in Japanese.

Hackathon theme: 化ける / Transform — 全く別のものに変わる.

## Run it

```bash
npm install
```

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
```

```bash
npm run dev
```

Open http://localhost:3000. Without `ANTHROPIC_API_KEY` the app runs in **demo mode** and returns a built-in example (a self-watering planter), so the UI is always demoable.

## How it works

- `src/app/page.tsx` — UI (photo upload, problem input, results). Light palette: Blush / Champagne / Cognac / Amber / Emerald / Espresso.
- `src/app/api/transform/route.ts` — sends the photo + problem to Claude with a structured-output schema.
- `src/lib/blueprint.ts` — the Zod schema the AI must fill: detected materials, detailed steps (actions, tips, cautions), and the parts (cut size, how to make it, 3D shape/position, which step adds it). Also the demo blueprint.
- `src/components/Viewer3D.tsx` — three.js viewer. Finished steps are solid, the current step's parts animate into place, future parts are ghosted. Exploded view and click-to-select.
