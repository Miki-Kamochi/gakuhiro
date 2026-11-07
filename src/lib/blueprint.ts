import { z } from "zod";

const Vec3 = z.object({ x: z.number(), y: z.number(), z: z.number() });

export const PartSchema = z.object({
  id: z.string(),
  label: z.string().describe("Short name of the part, e.g. 'Bottle body'"),
  shape: z.enum(["box", "cylinder", "sphere", "cone", "torus"]),
  size: Vec3.describe(
    "Dimensions in cm. box: width/height/depth. cylinder & cone: x = diameter, y = height. sphere: x = diameter. torus: x = outer diameter, y = tube thickness.",
  ),
  position: Vec3.describe("Center of the part in cm. Y is up, the ground is y = 0."),
  rotation: Vec3.describe("Euler rotation in degrees."),
  color: z.string().describe("Hex color such as #9ad1ff, roughly matching the real material"),
  source: z.string().describe("Which piece of the photographed trash this part is made from"),
  step: z.number().int().describe("1-based index of the build step that adds this part"),
});

export const BlueprintSchema = z.object({
  detected: z.object({
    items: z.array(z.string()).describe("Objects you can see in the photo"),
    materials: z.array(z.string()).describe("Materials, e.g. PET plastic, corrugated cardboard"),
  }),
  title: z.string().describe("Name of the thing to build, in English"),
  title_ja: z.string().describe("The same name in Japanese"),
  tagline: z.string().describe("One sentence on what it does"),
  problem_solved: z.string().describe("How it addresses the user's stated problem"),
  difficulty: z.number().int().describe("1 (easy) to 5 (hard)"),
  time_minutes: z.number().int(),
  tools: z.array(z.string()).describe("Household tools needed, e.g. scissors, tape"),
  co2_saved_g: z.number().describe("Rough estimate of CO2 saved in grams vs. buying new"),
  steps: z.array(
    z.object({
      title: z.string(),
      detail: z.string().describe("One to three concrete sentences"),
    }),
  ),
  parts: z.array(PartSchema).describe("3D primitives that together form the finished object"),
});

export type Blueprint = z.infer<typeof BlueprintSchema>;
export type Part = z.infer<typeof PartSchema>;

const v = (x: number, y: number, z: number) => ({ x, y, z });

/** Shown when no API key is configured, so the UI is always demoable. */
export const DEMO_BLUEPRINT: Blueprint = {
  detected: {
    items: ["2L PET bottle", "Cardboard box", "Bottle cap", "Rubber band"],
    materials: ["PET plastic", "Corrugated cardboard", "PP plastic"],
  },
  title: "Self-Watering Herb Planter",
  title_ja: "自動給水ハーブプランター",
  tagline: "A bottle that waters your basil for a week while you are away.",
  problem_solved:
    "You said your plants die when you travel. The inverted bottle top wicks water up from the reservoir, so the soil stays moist for 5–7 days.",
  difficulty: 2,
  time_minutes: 25,
  tools: ["Box cutter", "Scissors", "Cotton string", "Packing tape"],
  co2_saved_g: 180,
  steps: [
    {
      title: "Cut the bottle",
      detail: "Cut the bottle about 2/5 from the top. The bottom half becomes the water reservoir.",
    },
    {
      title: "Thread the wick",
      detail: "Punch a hole in the cap and pull a 20 cm cotton string through it. This draws water upward.",
    },
    {
      title: "Invert the top",
      detail: "Flip the top half upside down and set it into the bottom half, cap pointing down into the water.",
    },
    {
      title: "Build the sleeve",
      detail: "Wrap cardboard around the reservoir and tape it to block light, which stops algae growing.",
    },
    {
      title: "Plant",
      detail: "Fill the top with soil, plant your herb, and fill the reservoir with water through the gap.",
    },
  ],
  parts: [
    {
      id: "reservoir",
      label: "Reservoir (bottle base)",
      shape: "cylinder",
      size: v(10, 14, 10),
      position: v(0, 7, 0),
      rotation: v(0, 0, 0),
      color: "#9fd4ff",
      source: "2L PET bottle",
      step: 1,
    },
    {
      id: "wick",
      label: "Cotton wick",
      shape: "cylinder",
      size: v(0.5, 12, 0.5),
      position: v(0, 8, 0),
      rotation: v(0, 0, 0),
      color: "#f2efe6",
      source: "Cotton string",
      step: 2,
    },
    {
      id: "cap",
      label: "Cap",
      shape: "cylinder",
      size: v(3, 1.2, 3),
      position: v(0, 9, 0),
      rotation: v(0, 0, 0),
      color: "#4f7cff",
      source: "Bottle cap",
      step: 2,
    },
    {
      id: "funnel",
      label: "Inverted bottle top",
      shape: "cone",
      size: v(10, 10, 10),
      position: v(0, 14.5, 0),
      rotation: v(180, 0, 0),
      color: "#cfe9ff",
      source: "2L PET bottle",
      step: 3,
    },
    {
      id: "sleeve",
      label: "Cardboard sleeve",
      shape: "cylinder",
      size: v(11, 13, 11),
      position: v(0, 6.5, 0),
      rotation: v(0, 0, 0),
      color: "#b98a5a",
      source: "Cardboard box",
      step: 4,
    },
    {
      id: "band",
      label: "Rubber band",
      shape: "torus",
      size: v(11.6, 0.4, 11.6),
      position: v(0, 11, 0),
      rotation: v(90, 0, 0),
      color: "#e2574c",
      source: "Rubber band",
      step: 4,
    },
    {
      id: "soil",
      label: "Soil",
      shape: "cylinder",
      size: v(9.4, 2, 9.4),
      position: v(0, 18.3, 0),
      rotation: v(0, 0, 0),
      color: "#4a3426",
      source: "—",
      step: 5,
    },
    {
      id: "herb",
      label: "Herb",
      shape: "sphere",
      size: v(7, 7, 7),
      position: v(0, 22.5, 0),
      rotation: v(0, 0, 0),
      color: "#5fbf6a",
      source: "—",
      step: 5,
    },
  ],
};
