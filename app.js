/*
 * Calendário Trello — visão mensal de cartões do Trello, sem login.
 *
 * Fontes de dados (todas opcionais, combinadas):
 *   1. data/boards.json  -> lista de arquivos JSON de quadros em data/ (publicados para toda a equipe)
 *   2. data/board.json   -> usado se boards.json não existir
 *   3. JSONs importados neste navegador (botão "Importar JSON" ou arrastar e soltar)
 */
(() => {
  'use strict';

  const MAX_PER_DAY = 4;
  const MAX_SPAN_DAYS = 62;
  const STORAGE_KEY = 'trello-calendar:imported';
  const PREFS_KEY = 'trello-calendar:prefs';

  const LABEL_COLORS = {
    green: '#4bce97', yellow: '#e2b203', orange: '#fea362', red: '#f87168',
    purple: '#9f8fef', blue: '#579dff', sky: '#6cc3e0', lime: '#94c748',
    pink: '#e774bb', black: '#8590a2',
  };
  const labelColor = (c) => (c ? LABEL_COLORS[c.replace(/_(dark|light)$/, '')] : null) || '#8590a2';

  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of children) if (c != null) n.append(c);
    return n;
  };

  const state = {
    boards: new Map(),          // id -> { board, source: 'site' | 'local' }
    view: startOfMonth(new Date()),
    expanded: new Set(),        // day keys with all cards shown
  };

  // ---------- datas ----------
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function dayKey(d) { return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  const fmtDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' });
  const fmtDateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });
  const fmtTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const fmtMonth = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });

  // ---------- dados ----------
  function normalizeBoard(raw) {
    if (!raw || !Array.isArray(raw.cards)) throw new Error('Este arquivo não parece um JSON de quadro do Trello.');
    const lists = new Map((raw.lists || []).map((l) => [l.id, l]));
    const members = new Map((raw.members || []).map((m) => [m.id, m]));
    const cards = raw.cards.map((c) => ({
      id: c.id,
      name: c.name,
      desc: c.desc || '',
      url: c.shortUrl || c.url || (raw.url ? raw.url : ''),
      due: c.due ? new Date(c.due) : null,
      start: c.start ? new Date(c.start) : null,
      done: !!c.dueComplete,
      closed: !!c.closed || !!lists.get(c.idList)?.closed,
      list: lists.get(c.idList)?.name || '',
      labels: (c.labels || []).map((l) => ({ name: l.name || '', color: l.color })),
      members: (c.idMembers || []).map((id) => members.get(id)?.fullName).filter(Boolean),
      boardId: raw.id,
      boardName: raw.name,
    }));
    return {
      id: raw.id || raw.name,
      name: raw.name || 'Quadro sem nome',
      url: raw.url || '',
      lists: [...lists.values()].filter((l) => !l.closed).map((l) => l.name),
      cards,
      loadedAt: new Date(),
    };
  }

  async function fetchJSON(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  }

  async function loadSiteBoards() {
    let files;
    try {
      const manifest = await fetchJSON('data/boards.json');
      files = Array.isArray(manifest) ? manifest : manifest.boards || [];
    } catch {
      files = ['board.json'];
    }
    let meta = null;
    try { meta = await fetchJSON('data/meta.json'); } catch { /* opcional */ }
    await Promise.all(files.map(async (f) => {
      try {
        const b = normalizeBoard(await fetchJSON(`data/${f}`));
        state.boards.set(b.id, { board: b, source: 'site' });
      } catch (e) {
        if (files.length > 1 || f !== 'board.json') console.warn(`Falha ao carregar data/${f}:`, e);
      }
    }));
    return meta;
  }

  function loadLocalBoards() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { saved = []; }
    for (const raw of saved) {
      try {
        const b = normalizeBoard(raw);
        state.boards.set(b.id, { board: b, source: 'local' });
      } catch { /* ignora */ }
    }
  }

  function saveLocalBoard(raw) {
    // guarda só o necessário para caber no localStorage
    const slim = {
      id: raw.id, name: raw.name, url: raw.url,
      lists: (raw.lists || []).map(({ id, name, closed }) => ({ id, name, closed })),
      members: (raw.members || []).map(({ id, fullName }) => ({ id, fullName })),
      cards: raw.cards.map(({ id, name, desc, shortUrl, url, due, start, dueComplete, closed, idList, labels, idMembers }) =>
        ({ id, name, desc, shortUrl, url, due, start, dueComplete, closed, idList, labels: (labels || []).map(({ name, color }) => ({ name, color })), idMembers })),
    };
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]').filter((b) => b.id !== slim.id);
      saved.push(slim);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch (e) {
      console.warn('Não foi possível salvar no navegador:', e);
    }
  }

  function clearLocalBoards() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignora */ }
    for (const [id, entry] of state.boards) if (entry.source === 'local') state.boards.delete(id);
  }

  async function importFiles(files) {
    const errors = [];
    for (const file of files) {
      try {
        const raw = JSON.parse(await file.text());
        const b = normalizeBoard(raw);
        state.boards.set(b.id, { board: b, source: 'local' });
        saveLocalBoard(raw);
      } catch (e) {
        errors.push(`${file.name}: ${e.message}`);
      }
    }
    if (errors.length) alert(errors.join('\n'));
    refreshFilters();
    render();
  }

  // ---------- filtros ----------
  const filters = {
    search: $('search'), board: $('filter-board'), list: $('filter-list'),
    label: $('filter-label'), member: $('filter-member'),
    done: $('show-done'), archived: $('show-archived'),
  };

  function allCards() {
    return [...state.boards.values()].flatMap((e) => e.board.cards);
  }

  function fillSelect(select, values, placeholder) {
    const current = select.value;
    select.replaceChildren(el('option', { value: '' }, placeholder),
      ...values.map(([v, label]) => el('option', { value: v }, label)));
    select.value = values.some(([v]) => v === current) ? current : '';
  }

  function refreshFilters() {
    const boards = [...state.boards.values()].map((e) => e.board);
    fillSelect(filters.board, boards.map((b) => [b.id, b.name]), 'Todos os quadros');
    filters.board.hidden = boards.length < 2;

    const scoped = filters.board.value ? boards.filter((b) => b.id === filters.board.value) : boards;
    const cards = scoped.flatMap((b) => b.cards);
    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    fillSelect(filters.list, uniq(cards.map((c) => c.list)).map((v) => [v, v]), 'Todas as listas');
    fillSelect(filters.label, uniq(cards.flatMap((c) => c.labels.map((l) => l.name || l.color))).map((v) => [v, v]), 'Todas as etiquetas');
    fillSelect(filters.member, uniq(cards.flatMap((c) => c.members)).map((v) => [v, v]), 'Todos os membros');
  }

  function matches(c) {
    const q = filters.search.value.trim().toLowerCase();
    if (q && !(`${c.name} ${c.desc}`.toLowerCase().includes(q))) return false;
    if (filters.board.value && c.boardId !== filters.board.value) return false;
    if (filters.list.value && c.list !== filters.list.value) return false;
    if (filters.label.value && !c.labels.some((l) => (l.name || l.color) === filters.label.value)) return false;
    if (filters.member.value && !c.members.includes(filters.member.value)) return false;
    if (!filters.done.checked && c.done) return false;
    if (!filters.archived.checked && c.closed) return false;
    return true;
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        done: filters.done.checked, archived: filters.archived.checked,
      }));
    } catch { /* ignora */ }
  }
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      if (typeof p.done === 'boolean') filters.done.checked = p.done;
      if (typeof p.archived === 'boolean') filters.archived.checked = p.archived;
    } catch { /* ignora */ }
  }

  // ---------- renderização ----------
  function cardButton(c, day) {
    const color = c.labels.length ? labelColor(c.labels[0].color) : '#8590a2';
    const now = new Date();
    const isEndDay = c.due && dayKey(startOfDay(c.due)) === dayKey(day);
    const isSpan = c.start && c.due && startOfDay(c.start) < startOfDay(c.due);
    const classes = ['card'];
    if (c.done) classes.push('done');
    if (!c.done && c.due && c.due < now) classes.push('overdue');
    if (isSpan && !isEndDay) classes.push('span');
    const hasTime = isEndDay && (c.due.getHours() || c.due.getMinutes());
    return el('button', {
      type: 'button', class: classes.join(' '), style: `--card-color:${color}`,
      title: `${c.name}${c.list ? ` — ${c.list}` : ''}`,
      onclick: () => openCard(c),
    }, hasTime ? el('span', { class: 'time' }, fmtTime.format(c.due)) : null, c.name);
  }

  function cardsByDay(cards) {
    const map = new Map();
    const push = (d, c) => {
      const k = dayKey(d);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(c);
    };
    for (const c of cards) {
      const end = c.due ? startOfDay(c.due) : null;
      const begin = c.start ? startOfDay(c.start) : null;
      if (begin && end && begin < end) {
        let d = begin, n = 0;
        while (d <= end && n++ < MAX_SPAN_DAYS) { push(d, c); d = addDays(d, 1); }
      } else if (end || begin) {
        push(end || begin, c);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.done - b.done) || ((a.due || a.start) - (b.due || b.start)));
    }
    return map;
  }

  function render() {
    const view = state.view;
    const m = fmtMonth.format(view);
    $('month-label').textContent = m.charAt(0).toUpperCase() + m.slice(1);

    const boards = [...state.boards.values()].map((e) => e.board);
    $('board-label').textContent = boards.map((b) => b.name).join(' · ');

    const cards = allCards().filter(matches);
    const byDay = cardsByDay(cards);
    const todayKey = dayKey(new Date());

    const first = addDays(view, -view.getDay());
    const last = new Date(view.getFullYear(), view.getMonth() + 1, 0);
    const weeks = Math.ceil((last.getDate() + view.getDay()) / 7);

    const cells = [];
    for (let i = 0; i < weeks * 7; i++) {
      const d = addDays(first, i);
      const k = dayKey(d);
      const dayCards = byDay.get(k) || [];
      const expanded = state.expanded.has(k);
      const shown = expanded ? dayCards : dayCards.slice(0, MAX_PER_DAY);
      const classes = ['day'];
      if (d.getMonth() !== view.getMonth()) classes.push('other');
      if (k === todayKey) classes.push('today');
      cells.push(el('div', { class: classes.join(' ') },
        el('span', { class: 'num' }, String(d.getDate())),
        ...shown.map((c) => cardButton(c, d)),
        dayCards.length > MAX_PER_DAY ? el('button', {
          type: 'button', class: 'more',
          onclick: () => { expanded ? state.expanded.delete(k) : state.expanded.add(k); render(); },
        }, expanded ? 'mostrar menos' : `+${dayCards.length - MAX_PER_DAY} mais`) : null,
      ));
    }
    $('grid').replaceChildren(...cells);

    const undated = cards.filter((c) => !c.due && !c.start);
    $('undated').hidden = undated.length === 0;
    $('undated-count').textContent = `(${undated.length})`;
    $('undated-list').replaceChildren(...undated.map((c) => cardButton(c, new Date(0))));

    renderNotice();
  }

  function renderNotice() {
    const n = $('notice');
    if (state.boards.size === 0) {
      n.hidden = false;
      n.innerHTML = `
        <strong>Nenhum quadro carregado.</strong><br>
        No Trello, abra o quadro → <em>Menu (…)</em> → <em>Imprimir, exportar e compartilhar</em> → <em>Exportar como JSON</em>.
        Depois arraste o arquivo para esta página ou clique em <em>Importar JSON</em>.<br>
        Para que <strong>toda a equipe</strong> veja, salve o arquivo como <code>data/board.json</code> no repositório
        (veja o README).`;
      return;
    }
    const locals = [...state.boards.values()].filter((e) => e.source === 'local');
    if (locals.length) {
      n.hidden = false;
      n.replaceChildren(
        `${locals.map((e) => e.board.name).join(', ')} foi importado só neste navegador — a equipe não vê. `,
        'Para compartilhar, publique o JSON em data/ no repositório. ',
        el('button', { type: 'button', onclick: () => { clearLocalBoards(); refreshFilters(); render(); } }, 'Remover importados'),
      );
    } else {
      n.hidden = true;
    }
  }

  function openCard(c) {
    $('dlg-title').textContent = c.name;
    const meta = $('dlg-meta');
    const rows = [
      ['Quadro', c.boardName],
      ['Lista', c.list],
      ['Início', c.start && fmtDate.format(c.start)],
      ['Entrega', c.due && `${fmtDateTime.format(c.due)}${c.done ? ' ✓ concluído' : ''}`],
      ['Membros', c.members.join(', ')],
      ['Status', c.closed ? 'Arquivado' : null],
    ].filter(([, v]) => v);
    const dl = el('dl', { class: 'dlg-meta' });
    for (const [k, v] of rows) dl.append(el('dt', {}, k), el('dd', {}, v));
    meta.replaceChildren(dl);
    $('dlg-labels').replaceChildren(...c.labels.map((l) =>
      el('span', { class: 'label', style: `--c:${labelColor(l.color)}` }, l.name || l.color || '')));
    $('dlg-desc').textContent = c.desc;
    const link = $('dlg-link');
    link.hidden = !c.url;
    link.href = c.url || '#';
    $('card-dialog').showModal();
  }

  // ---------- eventos ----------
  $('prev').onclick = () => { state.view = new Date(state.view.getFullYear(), state.view.getMonth() - 1, 1); state.expanded.clear(); render(); };
  $('next').onclick = () => { state.view = new Date(state.view.getFullYear(), state.view.getMonth() + 1, 1); state.expanded.clear(); render(); };
  $('today').onclick = () => { state.view = startOfMonth(new Date()); state.expanded.clear(); render(); };
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea') || $('card-dialog').open) return;
    if (e.key === 'ArrowLeft') $('prev').click();
    if (e.key === 'ArrowRight') $('next').click();
    if (e.key === 't') $('today').click();
  });
  $('card-dialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  filters.search.addEventListener('input', render);
  filters.board.addEventListener('change', () => { refreshFilters(); render(); });
  for (const f of [filters.list, filters.label, filters.member]) f.addEventListener('change', render);
  for (const f of [filters.done, filters.archived]) f.addEventListener('change', () => { savePrefs(); render(); });

  $('import-btn').onclick = () => $('import-file').click();
  $('import-file').onchange = (e) => { importFiles([...e.target.files]); e.target.value = ''; };

  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('drop-overlay').hidden = false; });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop-overlay').hidden = true; } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true;
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.name.endsWith('.json') || f.type.includes('json'));
    if (files.length) importFiles(files);
  });

  // ---------- início ----------
  (async () => {
    loadPrefs();
    const meta = await loadSiteBoards();
    loadLocalBoards();
    refreshFilters();
    render();
    if (meta?.updatedAt) {
      $('footer').textContent = `Dados do Trello atualizados em ${fmtDateTime.format(new Date(meta.updatedAt))}.`;
    }
  })();
})();
