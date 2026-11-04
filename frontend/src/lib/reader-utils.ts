export function groupParagraphsByPage<T extends { page: number }>(items: T[]): Array<[number, T[]]> {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const group = groups.get(item.page);
    if (group) group.push(item);
    else groups.set(item.page, [item]);
  }
  return Array.from(groups.entries());
}

export function nearestParagraph<T extends { page: number; bbox: number[] }>(
  items: T[], page: number, x: number, y: number,
): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const item of items) {
    if (item.page !== page) continue;
    const [x0, y0, x1, y1] = item.bbox;
    const distance = Math.max(0, x0 - x, x - x1) * 2 + Math.max(0, y0 - y, y - y1);
    if (distance < bestDistance) { best = item; bestDistance = distance; }
  }
  return bestDistance <= 35 ? best : null;
}

export function normalizeTerm(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function isPageMarker(value: string): boolean {
  return /^(?:page\s*)?\d+$/i.test(value.trim());
}

export type SearchHit = { key: string; paragraphId: string; page: number; source: "en" | "zh"; query: string; snippet: string; occurrence: number };

export function searchParagraphs<T extends { id: string; page: number; text: string; translation: string | null }>(items: T[], query: string): SearchHit[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const hits: SearchHit[] = [];
  for (const paragraph of items) {
    for (const [source, value] of [["en", paragraph.text], ["zh", paragraph.translation || ""]] as const) {
      const lower = value.toLocaleLowerCase();
      let start = 0;
      let occurrence = 0;
      while ((start = lower.indexOf(needle, start)) >= 0) {
        hits.push({ key: `${paragraph.id}:${source}:${occurrence}`, paragraphId: paragraph.id,
          page: paragraph.page, source, query, occurrence,
          snippet: value.slice(Math.max(0, start - 35), Math.min(value.length, start + query.length + 55)) });
        start += Math.max(needle.length, 1);
        occurrence++;
      }
    }
  }
  return hits;
}
