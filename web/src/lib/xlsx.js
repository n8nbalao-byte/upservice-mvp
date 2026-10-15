// Leitor mínimo de .xlsx (primeira aba) sem dependência: ZIP pelo diretório central + DecompressionStream nativo,
// XML do Excel por expressão regular (o SpreadsheetML gerado por Excel/Google Planilhas é regular o bastante).
// Roda no navegador e no Node (testes). Também interpreta a planilha de escala mensal (formato OPECX).

const td = new TextDecoder();

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Arquivos do ZIP: nome → função que devolve o conteúdo como texto. */
function unzip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Arquivo não é uma planilha .xlsx válida.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Planilha corrompida.');
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
    files.set(name, async () => {
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = u8.subarray(start, start + size);
      return td.decode(method === 0 ? data : await inflate(data));
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unescapeXml = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => (
  { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e] ?? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
));
const texts = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');
const colIndex = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Linhas da primeira aba: células como número (valores numéricos) ou texto. */
export async function readXlsx(buf) {
  const files = unzip(buf);
  const read = async (name) => (files.has(name) ? files.get(name)() : null);
  const shared = [...((await read('xl/sharedStrings.xml')) ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  // Primeira aba pela ordem do workbook (não necessariamente sheet1.xml).
  const wb = (await read('xl/workbook.xml')) ?? '';
  const rid = wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const rels = (await read('xl/_rels/workbook.xml.rels')) ?? '';
  const target = rid && [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => m[1]).find((a) => a.includes(`Id="${rid}"`))?.match(/Target="([^"]+)"/)?.[1];
  const sheetPath = target ? `xl/${target.replace(/^\/?xl\//, '').replace(/^\//, '')}` : 'xl/worksheets/sheet1.xml';
  const sheet = (await read(sheetPath)) ?? (await read('xl/worksheets/sheet1.xml'));
  if (!sheet) throw new Error('A planilha não tem nenhuma aba.');
  const rows = [];
  for (const [, attrs, body] of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const r = Number(attrs.match(/\br="(\d+)"/)?.[1] ?? rows.length + 1) - 1;
    const row = [];
    for (const [, cattrs, inner = ''] of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = cattrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = cattrs.match(/\bt="(\w+)"/)?.[1];
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const value = type === 's' ? shared[Number(v)] : type === 'inlineStr' ? texts(inner) : type === 'str' || type === 'b' || v == null ? (v != null ? unescapeXml(v) : '') : Number(v);
      row[ref ? colIndex(ref) : row.length] = value;
    }
    rows[r] = Array.from(row, (x) => x ?? '');
  }
  return Array.from(rows, (x) => x ?? []);
}

const MONTHS = ['JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const pad = (n) => String(n).padStart(2, '0');

/** Data de uma célula de cabeçalho: número de série do Excel ou texto "dd/mm[/aaaa]". */
function headerDate(cell, year) {
  if (typeof cell === 'number' && cell > 30000 && cell < 80000) {
    const d = new Date(Math.round((cell - 25569) * 86400e3));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const m = String(cell ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return null;
  const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year;
  return y ? `${y}-${pad(m[2])}-${pad(m[1])}` : null;
}

/**
 * Escala mensal (formato OPECX): título com "MÊS AAAA", cabeçalho com "Nº" (filial), "FILIAL" (nome) e uma coluna por dia;
 * cada célula é a quantidade de profissionais. Linhas sem nº de filial e a linha TOTAL são ignoradas.
 */
export function parseEscala(rows, { year: forcedYear } = {}) {
  let month = null, year = forcedYear ?? null;
  for (const row of rows.slice(0, 8)) for (const cell of row) {
    const m = plain(cell).match(new RegExp(`\\b(${MONTHS.join('|')})\\b(?:\\s*(?:DE|-|/)?\\s*)(\\d{4})`));
    if (m && !month) { month = MONTHS.indexOf(m[1]) + 1; year ??= Number(m[2]); }
  }
  const isNumHeader = (c) => /^N\s*[ºO°]?\.?$|^NUMERO$|^COD/.test(plain(c));
  const headerIdx = rows.findIndex((row) => row.some(isNumHeader) && row.filter((c) => headerDate(c, year ?? 2000)).length >= 3);
  if (headerIdx < 0) throw new Error('Não encontrei o cabeçalho (coluna "Nº" da filial e colunas de datas).');
  const header = rows[headerIdx];
  const numCol = header.findIndex(isNumHeader);
  const nameCol = header.findIndex((c) => plain(c) === 'FILIAL' || plain(c) === 'LOJA');
  // Datas "dd/mm" sem ano no título nem na célula: o ano precisa vir do formulário.
  if (!year && header.some((c) => typeof c === 'string' && /^\d{1,2}\/\d{1,2}(?!\/)/.test(c.trim()))) throw new Error('Informe o ano da escala.');
  const dateCols = header.map((c, i) => ({ i, date: headerDate(c, year) })).filter((x) => x.date);
  const items = [];
  const stores = new Map();
  for (const row of rows.slice(headerIdx + 1)) {
    if (row.some((c) => plain(c).startsWith('TOTAL'))) break;
    const filial = String(row[numCol] ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (!filial) continue;
    const name = nameCol >= 0 ? String(row[nameCol] ?? '').trim() : '';
    stores.set(filial, name);
    for (const { i, date } of dateCols) {
      const positions = Number(String(row[i] ?? '').replace(',', '.'));
      if (Number.isInteger(positions) && positions > 0) items.push({ filial, name, date, positions });
    }
  }
  const dates = dateCols.map((x) => x.date).sort();
  return { month, year, items, stores: [...stores].map(([filial, name]) => ({ filial, name })), from: dates[0], to: dates.at(-1) };
}
