#!/usr/bin/env node
// Baixa o JSON de quadros PÚBLICOS do Trello (sem API key) para a pasta data/.
//
// Uso: node scripts/fetch-trello.mjs https://trello.com/b/AbCd1234/meu-quadro [outro-quadro ...]
//   ou TRELLO_BOARDS="url1, url2" node scripts/fetch-trello.mjs
//
// Gera data/<id>.json para cada quadro, data/boards.json (lista) e data/meta.json (data da atualização).

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const outDir = new URL('../data/', import.meta.url).pathname;
const inputs = (process.argv.slice(2).length ? process.argv.slice(2) : (process.env.TRELLO_BOARDS || '').split(/[\s,]+/))
  .map((s) => s.trim())
  .filter(Boolean);

if (!inputs.length) {
  console.error('Informe ao menos um link de quadro público do Trello (argumento ou TRELLO_BOARDS).');
  process.exit(1);
}

const boardId = (s) => {
  const m = s.match(/trello\.com\/b\/([A-Za-z0-9]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9]+$/.test(s)) return s;
  throw new Error(`Link de quadro inválido: ${s}`);
};

await mkdir(outDir, { recursive: true });
const files = [];
let failed = 0;

for (const input of inputs) {
  try {
    const id = boardId(input);
    const res = await fetch(`https://trello.com/b/${id}.json`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} (o quadro é público?)`);
    const board = await res.json();
    if (!Array.isArray(board.cards)) throw new Error('resposta sem cartões (o quadro é público?)');
    const file = `${id}.json`;
    await writeFile(join(outDir, file), JSON.stringify(board));
    files.push(file);
    console.log(`✓ ${board.name}: ${board.cards.length} cartões -> data/${file}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${input}: ${e.message}`);
  }
}

if (files.length) {
  await writeFile(join(outDir, 'boards.json'), JSON.stringify(files, null, 2) + '\n');
  await writeFile(join(outDir, 'meta.json'), JSON.stringify({ updatedAt: new Date().toISOString() }) + '\n');
}
if (failed && !files.length) process.exit(1);
