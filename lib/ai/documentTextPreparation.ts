const pageMarkerPattern = /^--- PAGE (\d+) ---$/;

type ParsedPage = { header: string; body: string[] };

/**
 * Deterministic, non-AI text preparation for tenancy documents. Removes empty OCR lines,
 * repeated headers/footers, and duplicate pages, while preserving page markers and the
 * content of schedules, signature pages, and annexures. This runs before chunking so a
 * normal tenancy agreement fits into a single OpenAI extraction call.
 */
export function deduplicateDocumentContent(rawText: string): { text: string; pagesRemoved: number; charactersRemoved: number } {
  const originalLength = rawText.length;
  const pages = splitIntoPages(rawText);
  if (pages.length <= 1) return { text: collapseBlankLines(rawText), pagesRemoved: 0, charactersRemoved: Math.max(0, originalLength - collapseBlankLines(rawText).length) };

  const repeatedLines = findRepeatedHeaderFooterLines(pages);
  const seenBodies = new Map<string, number>();
  const outputParts: string[] = [];
  let pagesRemoved = 0;

  pages.forEach((page) => {
    const bodyLines = page.body
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !repeatedLines.has(line));
    const normalizedBody = bodyLines.join('\n');
    const isSubstantiveDuplicate = normalizedBody.length > 40 && seenBodies.has(normalizedBody);
    if (isSubstantiveDuplicate) { pagesRemoved += 1; return; }
    if (normalizedBody) seenBodies.set(normalizedBody, outputParts.length);
    const block = page.header ? `${page.header}\n${bodyLines.join('\n')}` : bodyLines.join('\n');
    if (block.trim()) outputParts.push(block.trim());
  });

  const text = outputParts.join('\n\n').trim();
  return { text, pagesRemoved, charactersRemoved: Math.max(0, originalLength - text.length) };
}

function splitIntoPages(rawText: string): ParsedPage[] {
  const lines = rawText.split('\n');
  const pages: ParsedPage[] = [];
  let current: ParsedPage | null = null;
  for (const line of lines) {
    if (pageMarkerPattern.test(line.trim())) {
      if (current) pages.push(current);
      current = { header: line.trim(), body: [] };
      continue;
    }
    if (!current) current = { header: '', body: [] };
    current.body.push(line);
  }
  if (current) pages.push(current);
  return pages;
}

/** Lines repeated at the top or bottom of most pages are treated as running headers/footers, not agreement content. */
function findRepeatedHeaderFooterLines(pages: ParsedPage[]): Set<string> {
  const edgeLineCounts = new Map<string, number>();
  for (const page of pages) {
    const nonBlank = page.body.map((line) => line.trim()).filter(Boolean);
    const edges = new Set([...nonBlank.slice(0, 2), ...nonBlank.slice(-2)]);
    edges.forEach((line) => edgeLineCounts.set(line, (edgeLineCounts.get(line) ?? 0) + 1));
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.6));
  return new Set([...edgeLineCounts.entries()].filter(([line, count]) => count >= threshold && line.length > 0 && line.length < 140).map(([line]) => line));
}

function collapseBlankLines(text: string): string {
  return text.split('\n').map((line) => line.trimEnd()).filter((line, index, all) => line.trim() || (all[index - 1] ?? '').trim()).join('\n').trim();
}

const priorityKeywords = [
  'tenant', 'landlord', 'lessee', 'lessor', 'penyewa', 'tuan rumah', 'witness', 'agent', 'ren no', 'law firm', 'advocate',
  'rental', 'rent', 'deposit', 'security deposit', 'utility', 'monthly', 'ringgit', 'rm ', 'stamp duty',
  'commencement', 'expiry', 'renewal', 'notice', 'terminat', 'inventory', 'schedule', 'annexure', 'signature',
  'ic no', 'passport', 'company no', 'registration no', 'phone', 'mobile', 'email', 'special clause'
];

/**
 * When a document produces more chunks than the controlled retry/call budget allows, keeps
 * the chunks most likely to carry tenancy-critical facts (parties, money, dates, clauses,
 * signatures) rather than sending one request per page. The first and last chunk are always
 * kept because they typically hold the parties/property particulars and the signature block.
 */
export function prioritizeChunksWithinBudget(chunks: string[], maxChunks: number): string[] {
  if (chunks.length <= maxChunks) return chunks;
  const scored = chunks.map((chunk, index) => ({ chunk, index, score: keywordScore(chunk) }));
  const mustKeep = new Set([0, chunks.length - 1]);
  const ranked = scored
    .filter((item) => !mustKeep.has(item.index))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, maxChunks - mustKeep.size))
    .map((item) => item.index);
  const keptIndexes = [...mustKeep, ...ranked].sort((a, b) => a - b).slice(0, maxChunks);
  return keptIndexes.map((index) => chunks[index]);
}

function keywordScore(text: string): number {
  const lower = text.toLowerCase();
  return priorityKeywords.reduce((score, keyword) => score + (lower.includes(keyword) ? 1 : 0), 0);
}
