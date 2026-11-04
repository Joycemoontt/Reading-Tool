import { Fragment } from "react";

function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : <Fragment key={index}>{part}</Fragment>);
}

export default function FormattedAnswer({ text }: { text: string }) {
  return <div className="formatted-answer">{text.split(/\n+/).filter(Boolean).map((line, index) => {
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) return <strong className="answer-heading" key={index}>{inline(heading[1])}</strong>;
    const item = line.match(/^[-*]\s+(.+)$/);
    if (item) return <p className="answer-list-item" key={index}>• {inline(item[1])}</p>;
    return <p key={index}>{inline(line)}</p>;
  })}</div>;
}
