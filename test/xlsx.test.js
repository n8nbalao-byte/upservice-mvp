// Leitor de .xlsx do navegador (web/src/lib/xlsx.js) rodando no Node com a escala de exemplo (layout OPECX).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseEscala, readXlsx } from '../web/src/lib/xlsx.js';

test('escala mensal: filial × dia × quantidade, ignora zero, texto e a linha TOTAL', async () => {
  const buf = await readFile(new URL('./fixtures/escala-exemplo.xlsx', import.meta.url));
  const rows = await readXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(rows[1][5], 'JUNHO 2026 - TERCEIRIZADOS OPECX');
  const e = parseEscala(rows);
  assert.equal(e.month, 6);
  assert.equal(e.year, 2026);
  assert.equal(e.from, '2026-06-01');
  assert.equal(e.to, '2026-06-04');
  assert.deepEqual(e.stores.map((x) => x.filial), ['6', '937', '615']);
  assert.deepEqual(e.items.map((i) => `${i.filial}@${i.date}=${i.positions}`), [
    '6@2026-06-01=15', '6@2026-06-02=15', '6@2026-06-04=20',
    '937@2026-06-02=20', '937@2026-06-03=10',
    '615@2026-06-01=10', '615@2026-06-03=10',
  ]);
});

test('escala sem ano e com datas "dd/mm" pede o ano', () => {
  const rows = [['ESCALA'], ['Nº', 'FILIAL', '01/06', '02/06', '03/06'], ['6', 'TAIPAS', 1, 2, 3]];
  assert.throws(() => parseEscala(rows), /Informe o ano/);
  assert.equal(parseEscala(rows, { year: 2027 }).items[0].date, '2027-06-01');
});
