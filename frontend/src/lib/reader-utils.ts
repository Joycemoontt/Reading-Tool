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
