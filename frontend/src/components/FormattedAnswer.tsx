import MathMarkdownRenderer from "./MathMarkdownRenderer";

export default function FormattedAnswer({ text }: { text: string }) {
  return <MathMarkdownRenderer text={text}/>;
}
