import type { Metadata, Viewport } from "next";
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

// The front page is a disguised shop, so the default title must not give the twist away.
// /make sets the BAKERU title in its own layout.
export const metadata: Metadata = {
  title: "KURASU｜くらしの道具店",
  description: "暮らしを整える、くらしの道具のセレクトショップ。",
};

export const viewport: Viewport = {
  themeColor: "#f6f5f2",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`${brush.variable} ${pop.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
