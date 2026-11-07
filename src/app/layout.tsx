import type { Metadata } from "next";
import { Geist_Mono, Yuji_Boku, Zen_Maru_Gothic } from "next/font/google";
import "./globals.css";

/** Brush calligraphy for titles. */
const brush = Yuji_Boku({
  variable: "--font-yuji",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

/** Rounded, playful gothic for everything else. */
const pop = Zen_Maru_Gothic({
  variable: "--font-zenmaru",
  weight: ["500", "700", "900"],
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BAKERU — 化ける",
  description: "いらないものが、使えるものに化ける。ゴミの写真から、AIが3Dの作り方を生成します。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`${brush.variable} ${pop.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
