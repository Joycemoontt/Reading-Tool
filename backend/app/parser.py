import re
import json
from collections import Counter

import pymupdf as fitz


def clean_lines(lines):
    parts = ["".join(span["text"] for span in line["spans"]).strip().replace("\u00ad", "") for line in lines]
    text = ""
    for part in parts:
        if not part:
            continue
        if text.endswith("-") and part[:1].islower():
            stem = text.split()[-1][:-1].lower()
            text = text + part if stem in {"feed", "self", "cross", "non", "multi", "pre", "post"} else text[:-1] + part
        else:
            text += (" " if text else "") + part
    return re.sub(r"\s+", " ", text).strip()


def reading_order(blocks, width):
    if not (any(b["x0"] > width * .52 for b in blocks) and
            any(b["x1"] < width * .48 for b in blocks)):
        return sorted(blocks, key=lambda b: (b["y0"], b["x0"]))
    full = sorted((b for b in blocks if b["x0"] < width * .44 and b["x1"] > width * .56), key=lambda b: b["y0"])
    columns = [b for b in blocks if b not in full]
    ordered = []
    remaining = columns
    for heading in full:
        band = [b for b in remaining if b["y0"] < heading["y0"]]
        remaining = [b for b in remaining if b["y0"] >= heading["y0"]]
        ordered.extend(sorted(band, key=lambda b: ((b["x0"] + b["x1"]) / 2 >= width / 2, b["y0"], b["x0"])))
        ordered.append(heading)
    ordered.extend(sorted(remaining, key=lambda b: ((b["x0"] + b["x1"]) / 2 >= width / 2, b["y0"], b["x0"])))
    return ordered


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
            text = clean_lines(lines)
            if not text or "\ufffd" in text:
                continue
            x0, y0, x1, y1 = block["bbox"]
            if y0 < page.rect.height * .08 or y1 > page.rect.height * .93:
                edge_texts.append(re.sub(r"\d+", "#", text.lower()))
            font_size = max((span["size"] for line in lines for span in line["spans"]), default=0)
            blocks.append(dict(text=text, x0=x0, y0=y0, x1=x1, y1=y1, font_size=font_size,
                               boxes=[list(line["bbox"]) for line in lines if line.get("bbox")]))
        page_blocks.append((page.rect.width, page.rect.height, blocks))
    repeated = {text for text, count in Counter(edge_texts).items() if count >= 3}
    result = []
    section_id = "front"
    order = 0
    for page_index, (width, height, blocks) in enumerate(page_blocks):
        for block in reading_order(blocks, width):
            text = block["text"]
            edge = block["y0"] < height * .08 or block["y1"] > height * .93
            if edge and (text.isdigit() or re.sub(r"\d+", "#", text.lower()) in repeated):
                continue
            if len(text) <= 2 or re.fullmatch(r"[\W_]+", text) or re.fullmatch(r"(?:page\s*)?\d+", text, re.I):
                continue
            caption = bool(re.match(r"^(figure|fig\.|table)\s*\d+", text, re.I))
            heading = not caption and len(text) < 140 and (block["font_size"] >= 13 or bool(re.match(r"^(\d+(?:\.\d+)*\s+|abstract$|references$)", text, re.I)))
            kind = "caption" if caption else "heading" if heading else "body"
            if kind == "heading":
                section_id = f"{paper_id}:s{order}"
            result.append({
                "id": f"{paper_id}:p{order}", "paper_id": paper_id, "page": page_index + 1,
                "order": order, "section_id": section_id, "text": text,
                "x0": block["x0"], "y0": block["y0"], "x1": block["x1"], "y1": block["y1"], "kind": kind,
                "line_boxes_json": json.dumps(block["boxes"]),
            })
            order += 1
    return len(doc), result
