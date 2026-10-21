import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GradNavi 修考工作台",
  description: "AI 时代的修考工作台：从决定去日本读研到顺利入学",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
