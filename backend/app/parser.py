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
    middle = width / 2
    left = [b for b in blocks if b["x1"] < middle - 3]
    right = [b for b in blocks if b["x0"] > middle + 3]
    # PyMuPDF's blocks on VGGT begin at x=317 on a 612-point page. A fixed
    # percentage threshold misses that column and silently interleaves prose.
    if len(left) < 2 or len(right) < 2:
        for block in blocks:
            block["column_index"] = 0
        return sorted(blocks, key=lambda b: (b["y0"], b["x0"]))
    full = sorted((b for b in blocks if b not in left and b not in right), key=lambda b: b["y0"])
    for block in blocks:
        block["column_index"] = 0 if block in left else 1 if block in right else -1
    columns = [b for b in blocks if b not in full]
    ordered = []
    remaining = columns
    for heading in full:
        band = [b for b in remaining if b["y0"] < heading["y0"]]
        remaining = [b for b in remaining if b["y0"] >= heading["y0"]]
        ordered.extend(sorted(band, key=lambda b: (b["column_index"], b["y0"], b["x0"])))
        ordered.append(heading)
    ordered.extend(sorted(remaining, key=lambda b: (b["column_index"], b["y0"], b["x0"])))
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
            heading = not caption and len(text) < 140 and (block["font_size"] >= 13 or bool(re.match(r"^(\d+(?:\.\d+)*\.?\s+|abstract$|references$|appendix\b)", text, re.I)))
            kind = "caption" if caption else "heading" if heading else "paragraph"
            if kind == "heading":
                section_id = f"{paper_id}:s{order}"
            result.append({
                "id": f"{paper_id}:p{order}", "paper_id": paper_id, "page": page_index + 1,
                "order": order, "section_id": section_id, "text": text,
                "x0": block["x0"], "y0": block["y0"], "x1": block["x1"], "y1": block["y1"], "kind": kind,
                "column_index": block["column_index"], "quality_status": "needs_review",
                "line_boxes_json": json.dumps(block["boxes"]),
            })
            order += 1
    return len(doc), result


def extract_elements(path: str, paper_id: str, paragraphs: list[dict]):
    """Keep scientific objects separate from prose and retain their PDF region.

    The table grid is derived from PDF geometry, never from a language model.
    All extracted objects require visual review before numeric claims are trusted.
    """
    doc = fitz.open(path)
    result = []
    for page_number, page in enumerate(doc, 1):
        page_paragraphs = [p for p in paragraphs if p["page"] == page_number]
        found_tables = []
        try:
            found_tables = list(page.find_tables().tables)
        except (AttributeError, ValueError):
            pass
        for table_number, table in enumerate(found_tables):
            box = list(table.bbox)
            if table.row_count < 2 or table.col_count < 2:
                continue
            rows = []
            for row in table.rows:
                cells = []
                for cell in row.cells:
                    value = page.get_text("text", clip=fitz.Rect(*cell)).strip() if cell else ""
                    cells.append({"originalValue": re.sub(r"\s+", " ", value),
                                  "bbox": list(cell) if cell else None, "rowspan": 1, "colspan": 1})
                rows.append(cells)
            candidates = [p for p in page_paragraphs if re.match(r"^Table\s*\d+", p["text"], re.I)
                          and 0 <= p["y0"] - box[3] <= 100]
            caption_paragraph = min(candidates, key=lambda p: p["y0"] - box[3]) if candidates else None
            caption = caption_paragraph["text"] if caption_paragraph else ""
            inside = [p for p in page_paragraphs if box[0] <= (p["x0"] + p["x1"]) / 2 <= box[2]
                      and box[1] <= (p["y0"] + p["y1"]) / 2 <= box[3]]
            order = min((p["order"] for p in inside), default=(caption_paragraph["order"] - 1
                        if caption_paragraph else page_paragraphs[0]["order"] if page_paragraphs else 0))
            result.append({"id": f"{paper_id}:table:{page_number}:{table_number}", "paper_id": paper_id,
                           "page": page_number, "reading_order_index": order, "kind": "table",
                           "bbox_json": json.dumps(box), "caption": caption,
                           "raw_text": page.get_text("text", clip=fitz.Rect(*box), sort=True),
                           "content_json": json.dumps({"columnHeaders": [cell["originalValue"] for cell in rows[0]],
                                                       "rows": rows[1:], "headerCells": rows[0]}, ensure_ascii=False),
                           "extraction_status": "needs_review"})
        table_boxes = [fitz.Rect(*t.bbox) for t in found_tables]
        equation_candidates = []
        for paragraph in page_paragraphs:
            source = paragraph["text"]
            box = fitz.Rect(paragraph["x0"], paragraph["y0"], paragraph["x1"], paragraph["y1"])
            if any(box.intersects(table_box) for table_box in table_boxes):
                continue
            mathish = bool(re.search(r"[=∑∫∇]|\b(?:Lcamera|Ldepth|Lpmap|Ltrack)\b", source))
            if not mathish or len(source) > 120 or re.match(r"^(Figure|Table)\s*\d+", source, re.I):
                continue
            if not (re.search(r"[=∑∫∇]", source) or len(source) < 45):
                continue
            equation_candidates.append((paragraph, box))
        groups = []
        for paragraph, box in sorted(equation_candidates, key=lambda item: (item[0]["column_index"], item[1].y0)):
            column = paragraph["column_index"]
            if groups and groups[-1]["column"] == column and box.y0 <= groups[-1]["box"].y1 + 14 \
                    and max(box.y1, groups[-1]["box"].y1) - groups[-1]["box"].y0 < 110:
                groups[-1]["box"] |= box
                groups[-1]["paragraphs"].append(paragraph)
            else:
                groups.append({"column": column, "box": fitz.Rect(box), "paragraphs": [paragraph]})
        for equation_number, group in enumerate(groups):
            box = group["box"]
            column = group["column"]
            x0, x1 = (50, page.rect.width / 2 - 5) if column == 0 else (
                page.rect.width / 2 + 5, page.rect.width - 50) if column == 1 else (box.x0 - 8, box.x1 + 8)
            expanded = fitz.Rect(max(0, x0), max(0, box.y0 - 6),
                                 min(page.rect.width, x1), min(page.rect.height, box.y1 + 8))
            anchor = group["paragraphs"][0]
            result.append({"id": f"{paper_id}:equation:{page_number}:{equation_number}", "paper_id": paper_id,
                           "page": page_number, "reading_order_index": anchor["order"], "kind": "equation",
                           "bbox_json": json.dumps(list(expanded)), "caption": "",
                           "raw_text": page.get_text("text", clip=expanded, sort=True),
                           "content_json": json.dumps({"paragraphId": anchor["id"], "latex": None}),
                           "extraction_status": "needs_review"})
        figure_number = 0
        for info in page.get_image_info():
            box = fitz.Rect(info["bbox"])
            if box.width * box.height < page.rect.width * page.rect.height * .035:
                continue
            candidates = [p for p in page_paragraphs if re.match(r"^(?:Figure|Fig\.)\s*\d+", p["text"], re.I)
                          and 0 <= p["y0"] - box.y1 <= 100]
            caption_paragraph = min(candidates, key=lambda p: p["y0"] - box.y1) if candidates else None
            caption = caption_paragraph["text"] if caption_paragraph else ""
            order = caption_paragraph["order"] - 1 if caption_paragraph else (
                page_paragraphs[0]["order"] if page_paragraphs else 0)
            result.append({"id": f"{paper_id}:figure:{page_number}:{figure_number}", "paper_id": paper_id,
                           "page": page_number, "reading_order_index": order, "kind": "figure",
                           "bbox_json": json.dumps(list(box)), "caption": caption, "raw_text": caption,
                           "content_json": "{}", "extraction_status": "needs_review"})
            figure_number += 1
    return result


def mark_scientific_paragraphs(paragraphs: list[dict], elements: list[dict]):
    """Prevent table OCR text from being presented as verified running prose."""
    tables = [(item["page"], json.loads(item["bbox_json"])) for item in elements if item["kind"] == "table"]
    equations = {json.loads(item["content_json"])["paragraphId"] for item in elements if item["kind"] == "equation"}
    for paragraph in paragraphs:
        x = (paragraph["x0"] + paragraph["x1"]) / 2
        y = (paragraph["y0"] + paragraph["y1"]) / 2
        if any(page == paragraph["page"] and box[0] <= x <= box[2] and box[1] <= y <= box[3]
               for page, box in tables):
            paragraph["kind"] = "table"
            paragraph["quality_status"] = "needs_review"
        elif paragraph["id"] in equations:
            paragraph["quality_status"] = "needs_review"
