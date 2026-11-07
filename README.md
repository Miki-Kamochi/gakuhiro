# BAKERU — 化ける

**いらないものが、使えるものに化ける。** Turn trash into something useful.

Take a photo of something you don't need, optionally describe a problem you have, and AI:

1. **Sees** the objects and materials in the photo (Claude vision).
2. **Invents** one useful thing you can build from them that solves your problem.
3. **Generates** a 3D model (built from simple primitives) and step-by-step DIY instructions. The 3D viewer animates the build step by step.

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

- `src/app/page.tsx` — UI (photo upload, problem input, results). Monochrome black/white design.
- `src/app/api/transform/route.ts` — sends the photo + problem to Claude with a structured-output schema.
- `src/lib/blueprint.ts` — the Zod schema the AI must fill: detected materials, steps, and a list of 3D parts (shape, size, position, rotation, color, which step adds it). Also the demo blueprint.
- `src/components/Viewer3D.tsx` — three.js viewer. Finished steps are solid, the current step glows, future parts are ghosted.
