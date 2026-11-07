import { cacheLife } from "next/cache";

export type Product = {
  id: string;
  name: string;
  category: string;
  price: number; // yen
  image: string;
  shop: string;
  rating: number;
  reviews: number;
};

export type ProductSource = "dummyjson" | "yahoo";

export function productSource(): ProductSource {
  return process.env.YAHOO_CLIENT_ID ? "yahoo" : "dummyjson";
}

/** Search products. Uses Yahoo!ショッピング when YAHOO_CLIENT_ID is set, otherwise DummyJSON. */
export async function searchProducts(query: string, category = ""): Promise<Product[]> {
  return productSource() === "yahoo" ? searchYahoo(query || category || "スマホスタンド") : searchDummy(query, category);
}

/* ------------------------------------------------------------------ */
/* DummyJSON — free, no key. Only categories that can plausibly be     */
/* made from household trash, minus electronics and branded gadgets.  */
/* ------------------------------------------------------------------ */

export const CATEGORIES: { slug: string; label: string }[] = [
  { slug: "home-decoration", label: "インテリア" },
  { slug: "kitchen-accessories", label: "キッチン" },
  { slug: "mobile-accessories", label: "スマホ周り" },
  { slug: "sports-accessories", label: "スポーツ" },
  { slug: "womens-bags", label: "バッグ" },
  { slug: "sunglasses", label: "サングラス" },
];

const EXCLUDE = /apple|amazon|beats|airpods|homepod|charger|magsafe|watch|microwave|electric|blender|stove|camera pedestal/i;
const USD_TO_JPY = 150;

type DummyProduct = {
  id: number;
  title: string;
  category: string;
  price: number;
  thumbnail: string;
  brand?: string;
  rating: number;
  reviews?: unknown[];
  tags?: string[];
  description?: string;
};

async function dummyCatalog(): Promise<(Product & { haystack: string })[]> {
  "use cache";
  cacheLife("days");

  const lists = await Promise.all(
    CATEGORIES.map(async ({ slug }) => {
      const res = await fetch(
        `https://dummyjson.com/products/category/${slug}?limit=0&select=title,category,price,thumbnail,brand,rating,reviews,tags,description`,
      );
      if (!res.ok) throw new Error(`DummyJSON error ${res.status}`);
      return ((await res.json()) as { products: DummyProduct[] }).products;
    }),
  );

  return lists
    .flat()
    .filter((p) => !EXCLUDE.test(p.title))
    .map((p) => ({
      id: `dj-${p.id}`,
      name: p.title,
      category: p.category,
      price: Math.round((p.price * USD_TO_JPY) / 10) * 10,
      image: p.thumbnail,
      shop: p.brand ?? "KURASU セレクト",
      rating: p.rating,
      reviews: Array.isArray(p.reviews) ? p.reviews.length * 37 + (p.id % 50) : 0,
      haystack: [p.title, p.category, p.description, ...(p.tags ?? [])].join(" ").toLowerCase(),
    }));
}

/**
 * Shop order for the demo. Things that turn into an impressive, easy build from
 * household trash come first (in this order); things that are hard or odd to
 * make from trash (knives, balls, leather bags…) sink to the bottom.
 */
const SHOWCASE = [
  "Plant Pot",
  "Mug Tree Stand",
  "Spice Rack",
  "Table Lamp",
  "Lunch Box",
  "Tray",
  "Family Tree Photo Frame",
  "Monopod",
  "Basketball Rim",
  "House Showpiece Plant",
  "Ice Cube Tray",
  "Selfie Lamp with iPhone",
];
const BUILDABLE = new Set([
  "Decoration Swing",
  "Selfie Stick Monopod",
  "Cricket Wicket",
  "Chopping Board",
  "Plate",
  "Black Aluminium Cup",
  "Glass",
  "Kitchen Sieve",
  "Fine Mesh Strainer",
  "Feather Shuttlecock",
  "Party Glasses",
  "Women Handbag Black",
  "Blue Women's Handbag",
]);

function demoRank(name: string): number {
  const i = SHOWCASE.indexOf(name);
  if (i >= 0) return i;
  return BUILDABLE.has(name) ? 100 : 200;
}

async function searchDummy(query: string, category: string): Promise<Product[]> {
  const all = await dummyCatalog();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return all
    .filter((p) => !category || p.category === category)
    .filter((p) => words.every((w) => p.haystack.includes(w)))
    .sort((a, b) => demoRank(a.name) - demoRank(b.name))
    .map(({ id, name, category: c, price, image, shop, rating, reviews }) => ({
      id,
      name,
      category: c,
      price,
      image,
      shop,
      rating,
      reviews,
    }));
}

/* ------------------------------------------------------------------ */
/* Yahoo!ショッピング — free Client ID, ~1 request/second, so cached.    */
/* ------------------------------------------------------------------ */

type YahooHit = {
  code?: string;
  name?: string;
  price?: number;
  image?: { medium?: string };
  exImage?: { url?: string };
  review?: { rate?: number; count?: number };
  seller?: { name?: string };
  genreCategory?: { name?: string };
};

async function searchYahoo(query: string): Promise<Product[]> {
  "use cache";
  cacheLife("hours");

  const params = new URLSearchParams({
    appid: process.env.YAHOO_CLIENT_ID!,
    query,
    results: "30",
    image_size: "300",
    in_stock: "true",
  });
  const res = await fetch(`https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?${params}`);
  if (!res.ok) throw new Error(`Yahoo API error ${res.status}`);

  const json = (await res.json()) as { hits?: YahooHit[] };
  return (json.hits ?? [])
    .filter((h) => h.name && h.price)
    .map((h, i) => ({
      id: h.code ?? `y-${i}`,
      name: h.name!,
      category: h.genreCategory?.name ?? "",
      price: h.price!,
      image: h.exImage?.url ?? h.image?.medium ?? "",
      shop: h.seller?.name ?? "",
      rating: h.review?.rate ?? 0,
      reviews: h.review?.count ?? 0,
    }));
}
