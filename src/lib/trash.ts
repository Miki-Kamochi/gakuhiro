/** Trash almost every household has. Asked one by one after the shop transforms. */
export const HOUSEHOLD_TRASH = [
  { id: "pet", name: "ペットボトル", detail: "500ml・2Lなど", emoji: "🥤" },
  { id: "cardboard", name: "段ボール", detail: "通販の箱など", emoji: "📦" },
  { id: "milk", name: "牛乳パック", detail: "1Lの紙パック", emoji: "🥛" },
  { id: "roll", name: "トイレットペーパーの芯", detail: "ラップの芯でもOK", emoji: "🧻" },
  { id: "can", name: "空き缶", detail: "飲み終わったジュースの缶", emoji: "🥫" },
] as const;

/** What the shop hands to /make. Stored in sessionStorage because a photo is too big for a URL. */
export type MakeRequest = {
  want?: { name: string; price: number; img: string };
  trash: string[];
  extra: string;
  photo?: { data: string; url: string };
};

export const MAKE_REQUEST_KEY = "bakeru:request";

/** Downscale to keep the upload small and fast. */
export async function toJpegBase64(file: File, max = 1024): Promise<{ data: string; url: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { data: url.split(",")[1], url };
}
