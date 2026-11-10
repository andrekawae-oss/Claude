// Sugestão automática de etapas a partir da categoria e da posição/forma de cada peça.
import * as THREE from 'three';

let uid = 0;
export const newStepId = () => `s${Date.now().toString(36)}${(uid++).toString(36)}`;

export function newStep(fields = {}) {
  return { id: newStepId(), title: 'Nova etapa', parts: [], people: 1, minutes: 10, notes: '', direction: 'cima', parallel: false, ...fields };
}

const MIN_PER_PART = { metalon: 4, painel: 5, ferragem: 1, porta: 6, led: 5, outro: 4 };

/**
 * @param parts [{ id, object, category }]
 * @param modelBox Box3 do móvel inteiro
 */
export function suggestSteps(parts, modelBox) {
  const size = modelBox.getSize(new THREE.Vector3());
  const groups = {
    metalon: [], base: [], laterais: [], fundo: [], prateleiras: [], tampo: [],
    ferragem: [], porta: [], led: [], outro: [],
  };
  const info = new Map();

  for (const p of parts) {
    const box = new THREE.Box3().setFromObject(p.object);
    const s = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    info.set(p.id, { box, s, c });
    const cat = p.category;
    if (cat === 'metalon' || cat === 'ferragem' || cat === 'porta' || cat === 'led' || cat === 'outro') {
      groups[cat].push(p);
      continue;
    }
    // painel: classifica pela espessura (eixo mais fino)
    const thin = s.x <= s.y && s.x <= s.z ? 'x' : s.y <= s.z ? 'y' : 'z';
    const nearBottom = box.min.y - modelBox.min.y < size.y * 0.15;
    const nearTop = modelBox.max.y - box.max.y < size.y * 0.1;
    if (thin === 'x') groups.laterais.push(p);
    else if (thin === 'z') (c.z < modelBox.getCenter(new THREE.Vector3()).z ? groups.fundo : groups.porta).push(p);
    else if (nearBottom) groups.base.push(p);
    else if (nearTop) groups.tampo.push(p);
    else groups.prateleiras.push(p);
  }

  const plan = [
    ['metalon', 'Montar estrutura de metalon', 'cima', 'Conferir esquadro e nível antes de fixar.'],
    ['base', 'Posicionar a base', 'cima', ''],
    ['laterais', 'Fixar laterais e divisórias', 'explodir', ''],
    ['fundo', 'Encaixar o fundo', 'tras', ''],
    ['prateleiras', 'Instalar prateleiras', 'frente', ''],
    ['tampo', 'Colocar o tampo', 'cima', ''],
    ['ferragem', 'Instalar ferragens', 'explodir', ''],
    ['porta', 'Montar portas e gavetas', 'frente', 'Regular as dobradiças/corrediças depois de instalar.'],
    ['led', 'Instalar LEDs e parte elétrica', 'frente', 'Testar os LEDs antes de fechar acabamentos. Desligar a energia para ligar.'],
    ['outro', 'Acabamentos finais', 'cima', ''],
  ];

  const steps = [];
  for (const [key, title, direction, notes] of plan) {
    const list = groups[key];
    if (!list.length) continue;
    list.sort((a, b) => info.get(a.id).c.y - info.get(b.id).c.y);
    const big = list.some((p) => {
      const { s } = info.get(p.id);
      const dims = [s.x, s.y, s.z].sort((a, b) => b - a);
      return dims[0] > 1.2 || dims[0] * dims[1] > 0.8;
    });
    const per = MIN_PER_PART[list[0].category] || 4;
    const minutes = Math.max(5, Math.ceil((list.length * per) / 5) * 5);
    steps.push(newStep({ title, direction, notes, parts: list.map((p) => p.id), people: big ? 2 : 1, minutes }));
  }
  return steps;
}
