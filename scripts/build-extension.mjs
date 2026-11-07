// Copies the 化けるボタン script into the Chrome extension, pointed at a BAKERU deployment.
// Usage: npm run extension -- https://your-app.vercel.app   (default: http://localhost:3000)
import { readFile, writeFile } from "node:fs/promises";

const origin = (process.argv[2] ?? process.env.BAKERU_ORIGIN ?? "http://localhost:3000").replace(/\/+$/, "");
const src = await readFile(new URL("../public/bakeru-button.js", import.meta.url), "utf8");
await writeFile(new URL("../extension/content.js", import.meta.url), src.replace("__BAKERU_ORIGIN__", origin));
console.log(`extension/content.js → ${origin}`);
