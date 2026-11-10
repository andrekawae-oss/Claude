// Manual de montagem para o celular. Lê window.MANUAL = { project, glb (base64) }.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createStage } from './stage.js';
import { AssemblyPlayer, summarize, fmtMinutes } from './player.js';
import { CATEGORIES } from './model.js';

const CSS = `
:root { --bg:#f5f6f8; --surface:#fff; --text:#1d2329; --muted:#66707a; --accent:#2f7cf6; --border:#e1e4e8; --warn:#fff6db; --warn-b:#f0d27a; }
@media (prefers-color-scheme: dark) { :root { --bg:#16191c; --surface:#1f2327; --text:#e6e9ec; --muted:#9aa4ae; --accent:#5b9bff; --border:#33393f; --warn:#3a3220; --warn-b:#7a6528; } }
* { box-sizing:border-box; }
html, body { margin:0; height:100%; background:var(--bg); color:var(--text); font:16px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
#app { height:100dvh; display:flex; flex-direction:column; max-width:900px; margin:0 auto; }
.mv-head { padding:10px 16px 6px; display:flex; align-items:center; gap:10px; }
.mv-head h1 { font-size:16px; margin:0; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mv-progress { height:4px; background:var(--border); margin:0 16px; border-radius:2px; overflow:hidden; }
.mv-progress div { height:100%; background:var(--accent); transition:width .3s; }
.mv-stage { flex:1 1 auto; min-height:200px; position:relative; }
.mv-stage canvas { display:block; touch-action:none; }
.mv-tools { position:absolute; right:10px; top:10px; display:flex; flex-direction:column; gap:8px; }
.mv-tools button { width:44px; height:44px; border-radius:22px; border:1px solid var(--border); background:var(--surface); color:var(--text); font-size:18px; box-shadow:0 1px 4px rgba(0,0,0,.12); }
.mv-sheet { background:var(--surface); border-top:1px solid var(--border); border-radius:16px 16px 0 0; padding:14px 16px calc(12px + env(safe-area-inset-bottom)); max-height:48dvh; display:flex; flex-direction:column; box-shadow:0 -2px 12px rgba(0,0,0,.06); }
.mv-body { overflow:auto; flex:1 1 auto; }
.mv-count { font-size:13px; color:var(--muted); font-weight:600; text-transform:uppercase; letter-spacing:.03em; }
.mv-title { font-size:21px; margin:2px 0 8px; }
.mv-chips { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
.mv-chip { font-size:14px; padding:4px 10px; border-radius:14px; background:var(--bg); border:1px solid var(--border); }
.mv-chip.people { font-weight:700; }
.mv-notes { background:var(--warn); border:1px solid var(--warn-b); border-radius:8px; padding:8px 10px; margin-bottom:10px; white-space:pre-wrap; font-size:15px; }
.mv-parts { list-style:none; margin:0; padding:0; font-size:15px; }
.mv-parts li { display:flex; align-items:center; gap:8px; padding:5px 0; border-bottom:1px solid var(--border); }
.mv-parts li:last-child { border-bottom:none; }
.mv-dot { width:10px; height:10px; border-radius:50%; flex:none; }
.mv-qty { margin-left:auto; font-weight:700; color:var(--muted); }
.mv-sub { font-size:13px; color:var(--muted); font-weight:600; margin:6px 0 2px; }
.mv-nav { display:grid; grid-template-columns:1fr auto 1.4fr; gap:8px; margin-top:12px; }
.mv-nav button { height:52px; border-radius:12px; font-size:17px; font-weight:600; border:1px solid var(--border); background:var(--bg); color:var(--text); }
.mv-nav button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
.mv-nav button:disabled { opacity:.4; }
.mv-nav .replay { width:52px; }
.mv-stats { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:6px 0 10px; }
.mv-stat { background:var(--bg); border-radius:10px; padding:8px 10px; }
.mv-stat b { display:block; font-size:20px; }
.mv-stat span { font-size:13px; color:var(--muted); }
.mv-loading { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:var(--muted); }
`;

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c);
  return n;
}

function base64ToBuffer(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function groupParts(ids, meta) {
  const map = new Map();
  for (const id of ids) {
    const m = meta.get(id) || { name: 'Peça', category: 'outro' };
    const key = `${m.category}|${m.name}`;
    if (!map.has(key)) map.set(key, { ...m, qty: 0 });
    map.get(key).qty++;
  }
  const order = Object.keys(CATEGORIES);
  return [...map.values()].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.name.localeCompare(b.name, 'pt-BR'));
}

export async function mountViewer(app, manual) {
  document.head.append(el('style', {}, CSS));
  const { project } = manual;
  const steps = project.steps;
  const meta = new Map(project.parts.map((p) => [p.id, p]));
  const sum = summarize(steps);

  const stageEl = el('div', { class: 'mv-stage' }, el('div', { class: 'mv-loading' }, 'Carregando modelo…'));
  const progress = el('div');
  const body = el('div', { class: 'mv-body' });
  const prevBtn = el('button', { type: 'button' }, '◀');
  const replayBtn = el('button', { type: 'button', class: 'replay', title: 'Repetir animação' }, '↻');
  const nextBtn = el('button', { type: 'button', class: 'primary' }, 'Próximo ▶');
  const zoomBtn = el('button', { type: 'button', title: 'Aproximar da etapa' }, '🔍');
  const fitBtn = el('button', { type: 'button', title: 'Ver o móvel inteiro' }, '⤢');
  stageEl.append(el('div', { class: 'mv-tools' }, zoomBtn, fitBtn));

  app.append(
    el('div', { class: 'mv-head' }, el('h1', {}, project.name || 'Manual de montagem')),
    el('div', { class: 'mv-progress' }, progress),
    stageEl,
    el('div', { class: 'mv-sheet' }, body, el('div', { class: 'mv-nav' }, prevBtn, replayBtn, nextBtn)),
  );
  document.title = project.name ? `${project.name} — Manual de montagem` : 'Manual de montagem';

  const stage = createStage(stageEl);
  const gltf = await new GLTFLoader().parseAsync(base64ToBuffer(manual.glb), '');
  stageEl.querySelector('.mv-loading').remove();
  const model = gltf.scene;
  stage.scene.add(model);

  const parts = [];
  model.traverse((o) => {
    const id = o.userData?.partId;
    if (id != null && meta.has(id)) parts.push({ id, object: o, category: meta.get(id).category });
  });
  model.traverse((m) => {
    if (m.isMesh) for (const mat of [].concat(m.material)) mat.side = THREE.DoubleSide;
  });
  const player = new AssemblyPlayer(model, parts, steps);
  stage.onFrame((dt) => player.update(dt));
  stage.frame(player.box, { instant: true });

  let k = -1; // -1 = visão geral, steps.length = concluído
  let zoomed = false;

  function render() {
    const n = steps.length;
    progress.style.width = `${Math.max(0, Math.min(1, (k + 1) / (n + 1))) * 100}%`;
    prevBtn.disabled = k <= -1;
    nextBtn.disabled = k >= n;
    nextBtn.textContent = k === -1 ? 'Começar ▶' : k === n - 1 ? 'Concluir ✓' : 'Próximo ▶';
    replayBtn.disabled = k < 0 || k >= n;
    zoomBtn.hidden = k < 0 || k >= n;
    body.replaceChildren();
    const add = (...kids) => body.append(...kids.flat().filter((x) => x != null && x !== false));

    if (k === -1) {
      add(
        el('div', { class: 'mv-count' }, 'Visão geral'),
        el('h2', { class: 'mv-title' }, project.name || 'Manual de montagem'),
        el('div', { class: 'mv-stats' },
          el('div', { class: 'mv-stat' }, el('b', {}, String(n)), el('span', {}, 'etapas')),
          el('div', { class: 'mv-stat' }, el('b', {}, fmtMinutes(sum.totalMinutes)), el('span', {}, 'tempo estimado')),
          el('div', { class: 'mv-stat' }, el('b', {}, `${sum.peakPeople} ${sum.peakPeople === 1 ? 'pessoa' : 'pessoas'}`), el('span', {}, 'equipe necessária')),
          el('div', { class: 'mv-stat' }, el('b', {}, String(project.parts.length)), el('span', {}, 'peças')),
        ),
        project.notes ? el('div', { class: 'mv-notes' }, project.notes) : null,
        el('div', { class: 'mv-sub' }, 'Etapas'),
        el('ul', { class: 'mv-parts' }, steps.map((s, i) => el('li', {},
          el('span', {}, `${i + 1}. ${s.title}`),
          el('span', { class: 'mv-qty' }, `👥 ${s.people} · ${fmtMinutes(s.minutes)}`)))),
      );
    } else if (k >= n) {
      add(
        el('div', { class: 'mv-count' }, 'Fim'),
        el('h2', { class: 'mv-title' }, 'Montagem concluída ✓'),
        el('p', {}, 'Confira se sobrou alguma peça ou ferragem e se portas e gavetas estão reguladas.'),
      );
    } else {
      const s = steps[k];
      const together = s.parallel && k > 0 ? `Pode ser feita junto com a etapa ${k}` : null;
      const nextParallel = steps[k + 1]?.parallel ? `Pode ser feita junto com a etapa ${k + 2}` : null;
      add(
        el('div', { class: 'mv-count' }, `Etapa ${k + 1} de ${n}`),
        el('h2', { class: 'mv-title' }, s.title),
        el('div', { class: 'mv-chips' },
          el('span', { class: 'mv-chip people' }, `👥 ${s.people} ${Number(s.people) === 1 ? 'pessoa' : 'pessoas'}`),
          el('span', { class: 'mv-chip' }, `⏱ ${fmtMinutes(s.minutes)}`),
          together || nextParallel ? el('span', { class: 'mv-chip' }, `⇉ ${together || nextParallel}`) : null,
        ),
        s.notes ? el('div', { class: 'mv-notes' }, `⚠ ${s.notes}`) : null,
        el('div', { class: 'mv-sub' }, `Peças desta etapa (${s.parts.length})`),
        el('ul', { class: 'mv-parts' }, groupParts(s.parts, meta).map((g) => el('li', {},
          el('span', { class: 'mv-dot', style: `background:${(CATEGORIES[g.category] || CATEGORIES.outro).color}` }),
          el('span', {}, g.name),
          el('span', { class: 'mv-qty' }, `×${g.qty}`)))),
      );
    }
    body.scrollTop = 0;
  }

  function go(next) {
    k = Math.max(-1, Math.min(steps.length, next));
    player.setStep(k < 0 || k >= steps.length ? null : k);
    if (zoomed && k >= 0 && k < steps.length) {
      const b = player.stepBox(k);
      stage.frameKeepingAngle(b.isEmpty() ? player.box : b);
    } else if (!zoomed) {
      stage.frameKeepingAngle(player.box);
    }
    render();
  }

  prevBtn.onclick = () => go(k - 1);
  nextBtn.onclick = () => go(k + 1);
  replayBtn.onclick = () => player.replay();
  zoomBtn.onclick = () => { zoomed = true; const b = player.stepBox(k); stage.frameKeepingAngle(b.isEmpty() ? player.box : b); };
  fitBtn.onclick = () => { zoomed = false; stage.frameKeepingAngle(player.box); };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') go(k + 1);
    if (e.key === 'ArrowLeft') go(k - 1);
  });
  // deslizar o painel de baixo para os lados troca de etapa
  let sx = null;
  body.parentElement.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  body.parentElement.addEventListener('touchend', (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 60) go(k + (dx < 0 ? 1 : -1));
    sx = null;
  });

  go(-1);
  return { player, stage, go };
}

if (typeof window !== 'undefined' && window.MANUAL) {
  mountViewer(document.getElementById('app'), window.MANUAL).catch((e) => {
    document.getElementById('app').textContent = `Erro ao abrir o manual: ${e.message}`;
    console.error(e);
  });
}
