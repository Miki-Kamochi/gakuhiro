import { Literata } from "next/font/google";

// Reading face for the textbook. Exposed as --font-literata for lesson.module.css.
const literata = Literata({
  variable: "--font-literata",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
});

export default function LessonsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className={`${literata.variable} flex flex-1 flex-col`}>{children}</div>;
}
