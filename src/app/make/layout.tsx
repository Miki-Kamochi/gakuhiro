import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "BAKERU — 化ける",
  description: "いらないものが、使えるものに化ける。ゴミから、AIが3Dの作り方を生成します。",
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function MakeLayout({ children }: LayoutProps<"/make">) {
  return children;
}
