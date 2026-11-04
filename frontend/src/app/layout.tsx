import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "PaperMind", description: "科研论文阅读与语音学习" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
