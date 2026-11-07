import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_JP } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Geist has no Japanese glyphs; without this Windows falls back to a plain system font.
const notoJp = Noto_Sans_JP({
  variable: "--font-noto-jp",
  weight: ["300", "400", "500", "700"],
  preload: false,
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
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} ${notoJp.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
