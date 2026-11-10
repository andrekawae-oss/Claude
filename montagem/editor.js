// Editor do manual de montagem.
import * as THREE from 'three';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { CATEGORIES, guessCategory, findModelRoot, computeParts, canSplit, partSizeMM, prepareMaterials, prettyName, fixColladaNames } from './src/model.js';
import { createStage } from './src/stage.js';
import { AssemblyPlayer, DIRECTIONS, summarize, fmtMinutes } from './src/player.js';
import { suggestSteps, newStep } from './src/suggest.js';

const $ = (id) => document.getElementById(id);
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else if (k === 'checked') n.checked = !!v;
    else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c);
  return n;
}

const state = {
  fileName: null,
  scene: null,       // objeto carregado (inclui transformações de unidade/eixo)
  root: null,        // raiz onde ficam as peças
  parts: [],
  partByObject: new Map(),
  splits: new Set(),
  cats: {},          // id -> categoria escolhida manualmente
  steps: [],
  selected: new Set(),
  lastClicked: null,
  active: null,      // índice da etapa sendo vista (null = móvel completo)
  openStep: null,    // id da etapa expandida
  ghost: false,
  player: null,
  notes: '',
};

const stage = createStage($('stage'), { grid: true });
stage.onFrame((dt) => state.player?.update(dt));

// ---------------------------------------------------------------- utilidades
let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
const partById = (id) => state.parts.find((p) => p.id === id);
const stepIndexOf = (id) => state.steps.findIndex((s) => s.parts.includes(id));
const catOf = (p) => state.cats[p.id] || p.autoCat;

function objectById(id) {
  if (id === 'root') return state.root;
  let o = state.root;
  for (const i of id.split('.')) { o = o?.children[Number(i)]; }
  return o;
}

// ---------------------------------------------------------------- carregar modelo
const MODEL_EXT = /\.(dae|glb|gltf|obj)$/i;

async function readDropped(dataTransfer) {
  const files = [];
  const walk = async (entry, path = '') => {
    if (entry.isFile) {
      files.push(await new Promise((res, rej) => entry.file(res, rej)));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, `${path}${entry.name}/`);
      } while (batch.length);
    }
  };
  const entries = [...dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length) for (const e of entries) await walk(e);
  else files.push(...dataTransfer.files);
  return files;
}

async function loadFiles(files) {
  files = [...files];
  if (files.some((f) => /\.skp$/i.test(f.name)) && !files.some((f) => MODEL_EXT.test(f.name))) {
    alert('O arquivo .skp não pode ser lido diretamente.\n\nNo SketchUp Pro: Arquivo → Exportar → Modelo 3D… → escolha "COLLADA (*.dae)" e salve. Depois abra o .dae aqui.');
    return;
  }
  const main = files.find((f) => MODEL_EXT.test(f.name));
  if (!main) { alert('Escolha um arquivo .dae, .glb, .gltf ou .obj.'); return; }

  // texturas e arquivos auxiliares: o carregador pede pelo nome, entregamos o arquivo local
  const blobs = new Map(files.map((f) => [f.name.toLowerCase(), URL.createObjectURL(f)]));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    const base = decodeURIComponent(url.split(/[\\/]/).pop()).toLowerCase();
    return blobs.get(base) || url;
  });

  toast(`Carregando ${main.name}…`, 60000);
  try {
    const ext = main.name.split('.').pop().toLowerCase();
    let object;
    if (ext === 'dae') {
      const collada = new ColladaLoader(manager).parse(fixColladaNames(await main.text()), '');
      object = collada.scene;
    } else if (ext === 'glb' || ext === 'gltf') {
      const loader = new GLTFLoader(manager);
      const data = ext === 'glb' ? await main.arrayBuffer() : await main.text();
      object = (await loader.parseAsync(data, '')).scene;
    } else {
      object = new OBJLoader(manager).parse(await main.text());
    }
    await new Promise((r) => setTimeout(r, 50));
    setModel(object, main.name);
    toast(`${main.name}: ${state.parts.length} peças encontradas.`);
  } catch (e) {
    console.error(e);
    toast(`Não consegui abrir ${main.name}: ${e.message}`, 8000);
  }
}

function setModel(object, fileName) {
  if (state.scene) stage.scene.remove(state.scene);
  state.player?.reset();
  Object.assign(state, {
    fileName, scene: object, splits: new Set(), cats: {}, steps: [], selected: new Set(),
    active: null, openStep: null, notes: '',
  });
  stage.scene.add(object);
  object.updateMatrixWorld(true);
  prepareMaterials(object);
  state.root = findModelRoot(object);
  state.player = null;

  $('project-name').value = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  // projeto salvo automaticamente para este arquivo?
  const saved = loadAutosave(fileName);
  if (saved) applyProject(saved, { quiet: true });
  rebuildParts();

  const box = new THREE.Box3().setFromObject(object);
  stage.setGrid(box);
  stage.frame(box, { instant: true });

  $('empty').hidden = true;
  $('view-tools').hidden = false;
  for (const id of ['project-name', 'btn-project-load', 'btn-project-save', 'btn-preview', 'btn-export', 'btn-suggest', 'btn-add-step']) $(id).disabled = false;
  if (saved) toast('Recuperei as etapas que você tinha feito para este arquivo.');
  renderAll();
}

function rebuildParts() {
  const raw = computeParts(state.root, state.splits);
  state.parts = raw.map((p) => ({ ...p, autoCat: guessCategory(p.name), size: partSizeMM(p.object) }));
  state.parts.forEach((p) => { p.category = catOf(p); });
  state.partByObject = new Map(state.parts.map((p) => [p.object, p]));
  const valid = new Set(state.parts.map((p) => p.id));
  state.steps.forEach((s) => { s.parts = s.parts.filter((id) => valid.has(id)); });
  state.selected = new Set([...state.selected].filter((id) => valid.has(id)));
  if (state.player) state.player.setParts(state.parts);
  else state.player = new AssemblyPlayer(state.root, state.parts, state.steps);
  syncPlayer();
}

function syncPlayer({ animate = false } = {}) {
  const pl = state.player;
  if (!pl) return;
  state.parts.forEach((p) => { p.category = catOf(p); });
  pl.setSteps(state.steps);
  pl.selected = state.selected;
  pl.ghosted = state.ghost && state.active == null
    ? new Set(state.steps.flatMap((s) => s.parts).filter((id) => !state.selected.has(id)))
    : new Set();
  pl.setStep(state.active, { animate });
}

// ---------------------------------------------------------------- projeto (salvar/abrir)
const AUTOSAVE = (name) => `montagem:projeto:${name}`;
function projectData() {
  return {
    app: 'manual-montagem', version: 1,
    name: $('project-name').value.trim(),
    modelFile: state.fileName,
    notes: state.notes,
    splits: [...state.splits],
    categories: state.cats,
    steps: state.steps,
  };
}
function autosave() {
  if (!state.fileName) return;
  try { localStorage.setItem(AUTOSAVE(state.fileName), JSON.stringify(projectData())); } catch { /* sem espaço/privado */ }
}
function loadAutosave(name) {
  try { return JSON.parse(localStorage.getItem(AUTOSAVE(name)) || 'null'); } catch { return null; }
}
function applyProject(p, { quiet = false } = {}) {
  if (p.modelFile && p.modelFile !== state.fileName && !quiet) {
    if (!confirm(`Este projeto foi feito para "${p.modelFile}", mas o modelo aberto é "${state.fileName}". Abrir mesmo assim?`)) return false;
  }
  state.splits = new Set(p.splits || []);
  state.cats = p.categories || {};
  state.steps = (p.steps || []).map((s) => newStep(s));
  state.notes = p.notes || '';
  if (p.name) $('project-name').value = p.name;
  state.active = null;
  return true;
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const slug = (s) => (s || 'manual').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'manual';

// ---------------------------------------------------------------- seleção
function select(ids, { toggle = false, add = false } = {}) {
  if (!toggle && !add) state.selected = new Set();
  for (const id of ids) {
    if (toggle && state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
  }
  syncLooks();
  renderParts();
  renderSteps();
}
function syncLooks() {
  const pl = state.player;
  if (!pl) return;
  pl.selected = state.selected;
  pl.ghosted = state.ghost && state.active == null
    ? new Set(state.steps.flatMap((s) => s.parts).filter((id) => !state.selected.has(id)))
    : new Set();
  pl.refresh();
}

// clique no 3D
const raycaster = new THREE.Raycaster();
let downAt = null;
stage.renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
stage.renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || !state.root) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  downAt = null;
  if (moved > 5) return;
  const rect = e.target.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, stage.camera);
  const hits = raycaster.intersectObject(state.root, true).filter((h) => {
    let o = h.object;
    while (o) { if (!o.visible) return false; o = o.parent; }
    const mat = [].concat(h.object.material)[0];
    return !mat || mat.opacity > 0.3;
  });
  let part = null;
  for (const h of hits) {
    let o = h.object;
    while (o && !state.partByObject.has(o)) o = o.parent;
    if (o) { part = state.partByObject.get(o); break; }
  }
  const multi = e.ctrlKey || e.metaKey || e.shiftKey;
  if (part) {
    select([part.id], { toggle: multi });
    state.lastClicked = part.id;
    document.querySelector(`.part[data-id="${CSS.escape(part.id)}"]`)?.scrollIntoView({ block: 'nearest' });
  } else if (!multi) {
    select([]);
  }
});

// ---------------------------------------------------------------- lista de peças
function filteredParts() {
  const q = $('parts-search').value.trim().toLowerCase();
  const f = $('parts-filter').value;
  return state.parts.filter((p) => {
    if (q && !p.name.toLowerCase().includes(q)) return false;
    const used = stepIndexOf(p.id) >= 0;
    if (f === 'free' && used) return false;
    if (f === 'used' && !used) return false;
    return true;
  });
}

function renderParts() {
  const list = $('parts-list');
  const parts = filteredParts();
  const free = state.parts.filter((p) => stepIndexOf(p.id) < 0).length;
  $('parts-count').textContent = state.parts.length ? `${state.parts.length} · ${free} sem etapa` : '';
  const shownGroups = new Set();
  const rows = [];
  for (const p of parts) {
    // cabeçalho dos grupos divididos
    const segs = p.id.split('.');
    for (let d = 1; d < segs.length; d++) {
      const gid = segs.slice(0, d).join('.');
      if (state.splits.has(gid) && !shownGroups.has(gid)) {
        shownGroups.add(gid);
        rows.push(el('div', { class: 'part-group', style: `padding-left:${6 + (d - 1) * 12}px` },
          el('span', {}, `▾ ${prettyName(objectById(gid))}`),
          el('button', { type: 'button', title: 'Juntar de novo numa peça só', onclick: () => joinGroup(gid) }, 'Juntar')));
      }
    }
    const si = stepIndexOf(p.id);
    const cat = CATEGORIES[catOf(p)] || CATEGORIES.outro;
    const depth = segs.length - 1;
    rows.push(el('div', {
      class: `part${state.selected.has(p.id) ? ' selected' : ''}`,
      'data-id': p.id,
      style: depth ? `padding-left:${6 + depth * 12}px` : '',
      title: `${p.name}\n${cat.label}\n${p.size.join(' × ')} mm${canSplit(p.object) ? '\n(pode ser dividida em subpeças)' : ''}`,
      onclick: (e) => onPartClick(e, p, parts),
    },
    el('span', { class: 'dot', style: `background:${cat.color}` }),
    el('span', { class: 'pname' }, p.name),
    el('span', { class: 'psize' }, p.size.join('×')),
    el('span', { class: `badge${si >= 0 ? ' on' : ''}`, title: si >= 0 ? `Etapa ${si + 1}: ${state.steps[si].title}` : 'Sem etapa' }, si >= 0 ? String(si + 1) : '—')));
  }
  if (!state.parts.length) rows.push(el('p', { class: 'muted', style: 'padding:8px' }, 'Abra um modelo para ver as peças.'));
  list.replaceChildren(...rows);

  const n = state.selected.size;
  $('sel-bar').hidden = n === 0;
  $('sel-count').textContent = `${n} selecionada${n > 1 ? 's' : ''}`;
  const cats = new Set([...state.selected].map((id) => { const p = partById(id); return p && catOf(p); }));
  $('sel-category').value = cats.size === 1 ? [...cats][0] : '';
  $('sel-split').disabled = ![...state.selected].some((id) => { const p = partById(id); return p && canSplit(p.object); });
}

function onPartClick(e, p, visible) {
  if (e.shiftKey && state.lastClicked) {
    const ids = visible.map((x) => x.id);
    const a = ids.indexOf(state.lastClicked), b = ids.indexOf(p.id);
    if (a >= 0 && b >= 0) {
      select(ids.slice(Math.min(a, b), Math.max(a, b) + 1), { add: e.ctrlKey || e.metaKey });
      return;
    }
  }
  select([p.id], { toggle: e.ctrlKey || e.metaKey });
  state.lastClicked = p.id;
}

$('sel-category').append(el('option', { value: '' }, 'Categoria…'),
  ...Object.entries(CATEGORIES).map(([k, c]) => el('option', { value: k }, c.label)));
$('sel-category').onchange = (e) => {
  const v = e.target.value;
  if (!v) return;
  for (const id of state.selected) state.cats[id] = v;
  state.parts.forEach((p) => { p.category = catOf(p); });
  syncLooks(); renderAll(); autosave();
};
$('sel-clear').onclick = () => select([]);
$('sel-split').onclick = () => {
  const ids = [...state.selected].filter((id) => { const p = partById(id); return p && canSplit(p.object); });
  for (const id of ids) splitPart(id, false);
  rebuildParts(); renderAll(); autosave();
  toast('Peças divididas. Se ficou detalhado demais, use "Juntar" no cabeçalho do grupo.');
};
$('parts-search').oninput = renderParts;
$('parts-filter').onchange = renderParts;

function splitPart(id) {
  const obj = objectById(id);
  state.splits.add(id);
  const childIds = [];
  obj.children.forEach((c, i) => { let m = false; c.traverse((x) => { if (x.isMesh) m = true; }); if (m) childIds.push(`${id}.${i}`); });
  const si = stepIndexOf(id);
  if (si >= 0) {
    const s = state.steps[si];
    s.parts.splice(s.parts.indexOf(id), 1, ...childIds);
  }
  if (state.selected.delete(id)) childIds.forEach((c) => state.selected.add(c));
  if (state.cats[id]) { childIds.forEach((c) => { state.cats[c] = state.cats[id]; }); delete state.cats[id]; }
}

function joinGroup(gid) {
  for (const s of [...state.splits]) if (s === gid || s.startsWith(`${gid}.`)) state.splits.delete(s);
  const inside = (id) => id.startsWith(`${gid}.`);
  let target = -1;
  state.steps.forEach((s, i) => { if (target < 0 && s.parts.some(inside)) target = i; s.parts = s.parts.filter((id) => !inside(id)); });
  if (target >= 0) state.steps[target].parts.push(gid);
  state.selected = new Set([...state.selected].filter((id) => !inside(id)));
  rebuildParts(); renderAll(); autosave();
}

// ---------------------------------------------------------------- etapas
function addPartsToStep(stepIdx, ids) {
  for (const s of state.steps) s.parts = s.parts.filter((id) => !ids.includes(id));
  state.steps[stepIdx].parts.push(...ids);
}

function groupNames(ids) {
  const m = new Map();
  for (const id of ids) {
    const p = partById(id);
    if (!p) continue;
    if (!m.has(p.name)) m.set(p.name, { name: p.name, ids: [], cat: catOf(p) });
    m.get(p.name).ids.push(id);
  }
  return [...m.values()];
}

function showStep(i, { animate = true } = {}) {
  state.active = i;
  syncPlayer({ animate });
  if (i != null) state.openStep = state.steps[i]?.id ?? state.openStep;
  renderSteps();
  renderViewTools();
}

function renderSteps() {
  const list = $('steps-list');
  if (!state.steps.length) {
    list.replaceChildren(el('div', { class: 'steps-empty' },
      state.parts.length
        ? 'Nenhuma etapa ainda. Clique em “Sugerir” para o app propor uma sequência, ou selecione peças e clique em “+ Etapa”.'
        : 'Abra um modelo para começar.'));
    renderSummary();
    return;
  }
  const nSel = state.selected.size;
  list.replaceChildren(...state.steps.map((s, i) => {
    const open = state.openStep === s.id;
    const card = el('div', { class: `step${state.active === i ? ' active' : ''}${s.parallel && i > 0 ? ' parallel' : ''}` });
    const head = el('div', { class: 'step-head', onclick: () => {
      state.openStep = open && state.active === i ? null : s.id;
      showStep(i);
    } },
    el('span', { class: 'step-num' }, String(i + 1)),
    el('span', { class: 'step-title' }, s.title || 'Sem título'),
    el('span', { class: 'step-meta' }, `${s.parts.length} pç · 👥${s.people} · ${fmtMinutes(s.minutes)}`));
    card.append(head);
    if (!open) return card;

    const upd = (field, parse = (v) => v) => (e) => {
      s[field] = parse(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
      autosave();
      head.querySelector('.step-title').textContent = s.title || 'Sem título';
      head.querySelector('.step-meta').textContent = `${s.parts.length} pç · 👥${s.people} · ${fmtMinutes(s.minutes)}`;
      renderSummary();
      if (field === 'parallel') renderSteps();
      if (field === 'direction') showStep(i);
    };
    const groups = groupNames(s.parts);
    card.append(el('div', { class: 'step-body' },
      el('input', { value: s.title, placeholder: 'O que fazer nesta etapa', oninput: upd('title') }),
      el('div', { class: 'row' },
        el('label', {}, 'Pessoas', el('input', { type: 'number', min: 1, max: 20, value: s.people, oninput: upd('people', (v) => Math.max(1, parseInt(v, 10) || 1)) })),
        el('label', {}, 'Minutos', el('input', { type: 'number', min: 0, step: 5, value: s.minutes, oninput: upd('minutes', (v) => Math.max(0, parseInt(v, 10) || 0)) })),
        el('label', {}, 'Peças entram', el('select', { onchange: upd('direction') },
          Object.entries(DIRECTIONS).map(([k, d]) => el('option', { value: k, ...(k === s.direction ? { selected: true } : {}) }, d.label)))),
      ),
      i > 0 ? el('div', { class: 'row' }, el('label', { class: 'inline', title: 'Outra parte da equipe pode fazer esta etapa ao mesmo tempo que a anterior' },
        el('input', { type: 'checkbox', checked: s.parallel, onchange: upd('parallel') }), 'Pode ser feita junto com a etapa anterior')) : null,
      el('textarea', { placeholder: 'Observações (ex.: conferir esquadro, usar parafuso 4×40, cuidado com o vidro)', oninput: upd('notes') }, s.notes),
      groups.length
        ? el('div', { class: 'chips' }, groups.map((g) => el('span', {
          class: 'chip', title: 'Clique para selecionar no 3D',
          style: `border-left:3px solid ${(CATEGORIES[g.cat] || CATEGORIES.outro).color}`,
          onclick: () => select(g.ids),
        }, g.name, g.ids.length > 1 ? el('i', {}, ` ×${g.ids.length}`) : null)))
        : el('div', { class: 'muted' }, 'Nenhuma peça. Selecione peças na lista ou no 3D e clique em “+ Selecionadas”.'),
      el('div', { class: 'step-actions' },
        el('button', { type: 'button', disabled: !nSel, onclick: () => { addPartsToStep(i, [...state.selected]); state.selected = new Set(); afterStepChange(i); } }, `+ Selecionadas${nSel ? ` (${nSel})` : ''}`),
        el('button', { type: 'button', disabled: !s.parts.some((id) => state.selected.has(id)), onclick: () => { s.parts = s.parts.filter((id) => !state.selected.has(id)); afterStepChange(i); } }, '− Selecionadas'),
        el('button', { type: 'button', title: 'Repetir animação', onclick: () => showStep(i) }, '▶'),
        el('button', { type: 'button', title: 'Subir', disabled: i === 0, onclick: () => moveStep(i, -1) }, '↑'),
        el('button', { type: 'button', title: 'Descer', disabled: i === state.steps.length - 1, onclick: () => moveStep(i, 1) }, '↓'),
        el('button', { type: 'button', class: 'danger', onclick: () => { if (confirm(`Apagar a etapa "${s.title}"?`)) { state.steps.splice(i, 1); state.active = null; afterStepChange(null); } } }, 'Apagar'),
      ),
    ));
    return card;
  }));
  renderSummary();
}

function afterStepChange(i) {
  autosave();
  state.active = i;
  syncPlayer({ animate: i != null });
  renderAll();
}

function moveStep(i, d) {
  const [s] = state.steps.splice(i, 1);
  state.steps.splice(i + d, 0, s);
  afterStepChange(i + d);
}

$('btn-add-step').onclick = () => {
  const ids = [...state.selected];
  const s = newStep({ title: ids.length ? `Montar ${groupNames(ids).map((g) => g.name).slice(0, 2).join(', ')}` : 'Nova etapa' });
  const idx = state.active != null ? state.active + 1 : state.steps.length;
  state.steps.splice(idx, 0, s);
  if (ids.length) addPartsToStep(idx, ids);
  state.selected = new Set();
  state.openStep = s.id;
  afterStepChange(idx);
};

$('btn-suggest').onclick = () => {
  if (state.steps.length && !confirm('Substituir as etapas atuais por uma sugestão automática?')) return;
  state.parts.forEach((p) => { p.category = catOf(p); });
  state.player.reset();
  state.steps = suggestSteps(state.parts, new THREE.Box3().setFromObject(state.root));
  state.openStep = state.steps[0]?.id ?? null;
  afterStepChange(state.steps.length ? 0 : null);
  toast('Sequência sugerida. Revise a ordem, as pessoas e os minutos de cada etapa.', 5000);
};

// ---------------------------------------------------------------- resumo
function renderSummary() {
  const box = $('summary');
  if (!state.parts.length) { box.replaceChildren(); return; }
  const sum = summarize(state.steps);
  const free = state.parts.filter((p) => stepIndexOf(p.id) < 0).length;
  const empty = state.steps.filter((s) => !s.parts.length).length;
  const saved = sum.sequentialMinutes - sum.totalMinutes;
  box.replaceChildren(...[
    el('h3', {}, 'Resumo da montagem'),
    el('div', { class: 'stats' },
      el('div', { class: 'stat' }, el('b', {}, fmtMinutes(sum.totalMinutes)), el('span', {}, 'tempo total')),
      el('div', { class: 'stat' }, el('b', {}, `${sum.peakPeople || 0}`), el('span', {}, 'pessoas no pico')),
      el('div', { class: 'stat' }, el('b', {}, fmtMinutes(sum.personMinutes)), el('span', {}, 'homem-hora (soma)')),
      el('div', { class: 'stat' }, el('b', {}, String(state.steps.length)), el('span', {}, 'etapas')),
    ),
    saved > 0 ? el('div', { class: 'gain' }, `Etapas em paralelo economizam ${fmtMinutes(saved)}.`) : null,
    free ? el('div', { class: 'warn' }, `⚠ ${free} peça${free > 1 ? 's' : ''} sem etapa (vão aparecer já montadas no manual). Use o filtro “Sem etapa”.`) : null,
    empty ? el('div', { class: 'warn' }, `⚠ ${empty} etapa${empty > 1 ? 's' : ''} sem peças.`) : null,
  ].filter(Boolean));
}

// ---------------------------------------------------------------- barra do 3D
function renderViewTools() {
  const n = state.steps.length;
  $('vt-label').textContent = state.active == null ? 'Móvel completo' : `Etapa ${state.active + 1} de ${n}`;
  $('vt-prev').disabled = !n || state.active === 0;
  $('vt-next').disabled = !n || state.active === n - 1;
  $('vt-replay').disabled = state.active == null;
  $('vt-ghost').disabled = state.active != null;
}
$('vt-all').onclick = () => showStep(null);
$('vt-prev').onclick = () => showStep(state.active == null ? state.steps.length - 1 : Math.max(0, state.active - 1));
$('vt-next').onclick = () => showStep(state.active == null ? 0 : Math.min(state.steps.length - 1, state.active + 1));
$('vt-replay').onclick = () => state.player?.replay();
$('vt-fit').onclick = () => state.player && stage.frameKeepingAngle(state.player.box);
$('vt-ghost').onchange = (e) => { state.ghost = e.target.checked; syncLooks(); };

function renderAll() { renderParts(); renderSteps(); renderViewTools(); }

// ---------------------------------------------------------------- gerar manual
async function buildManualHTML() {
  if (!state.steps.length) throw new Error('Crie pelo menos uma etapa antes de gerar o manual.');
  const bundle = await (await fetch('build/viewer.bundle.js')).text();

  const pl = state.player;
  pl.reset();
  // o GLB leva só o id de cada peça; o resto da informação vai no JSON do projeto
  const stash = new Map();
  state.scene.traverse((o) => {
    stash.set(o, o.userData);
    o.userData = {};
    if (o.isMesh) for (const m of [].concat(o.material)) { stash.set(m, m.userData); m.userData = {}; }
  });
  for (const p of state.parts) p.object.userData = { partId: p.id };
  let glb;
  try {
    glb = await new GLTFExporter().parseAsync(state.scene, { binary: true, onlyVisible: false });
  } finally {
    for (const [o, ud] of stash) o.userData = ud;
    syncPlayer();
  }

  const project = {
    name: $('project-name').value.trim() || 'Manual de montagem',
    notes: state.notes,
    steps: state.steps.map(({ title, parts, people, minutes, notes, direction, parallel }) => ({ title, parts, people, minutes, notes, direction, parallel })),
    parts: state.parts.map((p) => ({ id: p.id, name: p.name, category: catOf(p) })),
    createdAt: new Date().toISOString(),
  };
  const bytes = new Uint8Array(glb);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const payload = JSON.stringify({ project, glb: btoa(bin) }).replace(/</g, '\\u003c');
  const title = project.name.replace(/[<&]/g, '');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#2f7cf6">
<title>${title} — Manual de montagem</title>
</head>
<body>
<div id="app"></div>
<script>window.MANUAL = ${payload};</script>
<script>${bundle.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>
`;
}

$('btn-export').onclick = async () => {
  try {
    toast('Gerando manual…', 60000);
    const html = await buildManualHTML();
    const mb = (html.length / 1e6).toFixed(1);
    download(`manual-${slug($('project-name').value)}.html`, html, 'text/html');
    toast(`Manual gerado (${mb} MB). Mande esse arquivo para os montadores ou publique no site.`, 7000);
  } catch (e) { console.error(e); toast(e.message, 6000); }
};
$('btn-preview').onclick = async () => {
  const win = window.open('', '_blank');
  try {
    const html = await buildManualHTML();
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    if (win) win.location = url; else window.open(url, '_blank');
  } catch (e) { win?.close(); toast(e.message, 6000); }
};

// ---------------------------------------------------------------- arquivos
$('btn-open').onclick = () => $('file-model').click();
$('btn-open-2').onclick = () => $('file-model').click();
$('file-model').onchange = (e) => { loadFiles(e.target.files); e.target.value = ''; };
$('btn-project-save').onclick = () => {
  download(`projeto-${slug($('project-name').value)}.json`, JSON.stringify(projectData(), null, 2), 'application/json');
};
$('btn-project-load').onclick = () => $('file-project').click();
$('file-project').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const p = JSON.parse(await f.text());
    if (p.app !== 'manual-montagem') throw new Error('Este arquivo não é um projeto de manual.');
    if (applyProject(p)) { rebuildParts(); renderAll(); autosave(); toast('Projeto aberto.'); }
  } catch (err) { toast(err.message, 6000); }
};
$('project-name').oninput = autosave;
$('btn-example').onclick = async () => {
  try {
    const r = await fetch('exemplo/armario.dae');
    if (!r.ok) throw new Error(r.status);
    await loadFiles([new File([await r.blob()], 'armario.dae')]);
  } catch (e) { toast(`Não consegui abrir o exemplo (${e.message}).`); }
};

let depth = 0;
addEventListener('dragenter', (e) => { e.preventDefault(); depth++; $('drop').hidden = false; });
addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('drop').hidden = true; } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', async (e) => {
  e.preventDefault(); depth = 0; $('drop').hidden = true;
  const files = await readDropped(e.dataTransfer);
  if (files.some((f) => f.name.endsWith('.json')) && !files.some((f) => MODEL_EXT.test(f.name))) {
    if (!state.root) { toast('Abra o modelo primeiro, depois o projeto.'); return; }
    const p = JSON.parse(await files[0].text());
    if (applyProject(p)) { rebuildParts(); renderAll(); autosave(); }
    return;
  }
  loadFiles(files);
});

addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === 'Escape') select([]);
  if (e.key === 'ArrowRight') $('vt-next').click();
  if (e.key === 'ArrowLeft') $('vt-prev').click();
});

renderAll();

// para testes automatizados
window.__editor = { state, loadFiles, buildManualHTML };
