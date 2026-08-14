// 貼り付けたテキストを表として読む。カンマ区切り・タブ区切り・1行1曲のいずれにも対応する。

export function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  const tabs = (line.match(/\t/g) ?? []).length;
  const commas = (line.match(/,/g) ?? []).length;
  if (tabs === 0 && commas === 0) return '\n'; // 区切りなし = 1行1曲
  return tabs > commas ? '\t' : ',';
}

/** RFC4180 風の最小パーサ (引用符・引用符内の改行に対応) */
export function parseTable(text: string, delimiter: string): string[][] {
  if (delimiter === '\n') {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => [line]);
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);

  return rows
    .map((r) => r.map((f) => f.trim()))
    .filter((r) => r.some((f) => f.length > 0));
}

/** ヘッダ名から曲名・作曲者の列を推測する */
export function guessColumns(header: string[]): { title: number; composer: number } {
  const find = (patterns: RegExp[]) =>
    header.findIndex((h) => patterns.some((p) => p.test(h)));
  const title = find([/曲名/, /タイトル/, /^name$/i, /^title$/i, /曲/]);
  const composer = find([/作曲/, /composer/i, /artist/i]);
  return { title: title >= 0 ? title : 0, composer };
}
