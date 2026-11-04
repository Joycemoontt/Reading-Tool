import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

export default function MathMarkdownRenderer({ text, className = "formatted-answer" }: { text: string; className?: string }) {
  const normalized = text.replace(/\\\[/g, "\n$$\n").replace(/\\\]/g, "\n$$\n")
    .replace(/\\\(/g, "$").replace(/\\\)/g, "$");
  return <div className={className}><ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}
    skipHtml>{normalized}</ReactMarkdown></div>;
}
