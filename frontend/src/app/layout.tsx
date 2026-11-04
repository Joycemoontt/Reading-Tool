import type { Metadata } from "next";
import "./globals.css";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";
import "./v2.css";

export const metadata: Metadata = { title: "PaperMind", description: "科研论文阅读与语音学习" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
