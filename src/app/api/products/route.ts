import { CATEGORIES, productSource, searchProducts } from "@/lib/products";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.trim().slice(0, 100) ?? "";
  const category = params.get("category") ?? "";

  try {
    const products = await searchProducts(q, category);
    return Response.json({ products, source: productSource(), categories: CATEGORIES });
  } catch {
    return Response.json(
      { error: "商品を取得できませんでした。少し待ってからもう一度お試しください。" },
      { status: 502 },
    );
  }
}
