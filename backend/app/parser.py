import re
from collections import Counter

import pymupdf as fitz


def extract_paragraphs(path: str, paper_id: str):
    doc = fitz.open(path)
    page_blocks = []
    edge_texts = []
    for page_index, page in enumerate(doc):
        blocks = []
        for block in page.get_text("dict")["blocks"]:
            if block.get("type") != 0:
                continue
            lines = block.get("lines", [])
            text = " ".join(
                "".join(span["text"] for span in line["spans"]).strip()
                for line in lines
            ).strip()
            text = re.sub(r"\s+", " ", text)
            if not text or "\ufffd" in text:
                continue
            x0, y0, x1, y1 = block["bbox"]
            if y0 < page.rect.height * .08 or y1 > page.rect.height * .93:
                edge_texts.append(re.sub(r"\d+", "#", text.lower()))
            font_size = max((span["size"] for line in lines for span in line["spans"]), default=0)
            blocks.append(dict(text=text, x0=x0, y0=y0, x1=x1, y1=y1, font_size=font_size))
        page_blocks.append((page.rect.width, page.rect.height, blocks))
    repeated = {text for text, count in Counter(edge_texts).items() if count >= 3}
    result = []
    section_id = "front"
    order = 0
    for page_index, (width, height, blocks) in enumerate(page_blocks):
        # Full-width headings first, then each column. Coordinates remain available for PDF navigation.
        has_columns = any(b["x0"] > width * .52 for b in blocks) and any(b["x1"] < width * .52 for b in blocks)
        if has_columns:
            blocks.sort(key=lambda b: (0 if b["x0"] < width * .52 else 1, b["y0"], b["x0"]))
        else:
            blocks.sort(key=lambda b: (b["y0"], b["x0"]))
        for block in blocks:
            text = block["text"]
            edge = block["y0"] < height * .08 or block["y1"] > height * .93
            if edge and (text.isdigit() or re.sub(r"\d+", "#", text.lower()) in repeated):
                continue
            if len(text) <= 2 or re.fullmatch(r"[\W_]+", text):
                continue
            heading = len(text) < 140 and (block["font_size"] >= 13 or bool(re.match(r"^(\d+(?:\.\d+)*\s+|abstract$|references$)", text, re.I)))
            kind = "heading" if heading else "caption" if re.match(r"^(figure|fig\.|table)\s*\d+", text, re.I) else "body"
            if heading:
                section_id = f"{paper_id}:s{order}"
            result.append({
                "id": f"{paper_id}:p{order}", "paper_id": paper_id, "page": page_index + 1,
                "order": order, "section_id": section_id, "text": text,
                "x0": block["x0"], "y0": block["y0"], "x1": block["x1"], "y1": block["y1"], "kind": kind,
            })
            order += 1
    return len(doc), result
