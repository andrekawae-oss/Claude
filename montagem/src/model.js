// Leitura do modelo 3D: encontra as peças, dá nomes legíveis e adivinha a categoria.
import * as THREE from 'three';

export const CATEGORIES = {
  metalon:  { label: 'Metalon / Estrutura', color: '#7d8a96' },
  painel:   { label: 'Painel / MDF',        color: '#c9a66b' },
  ferragem: { label: 'Ferragem',            color: '#d99a1e' },
  porta:    { label: 'Porta / Gaveta',      color: '#6f9fd8' },
  led:      { label: 'LED / Elétrica',      color: '#f2c94c' },
  outro:    { label: 'Outro',               color: '#9aa0a6' },
};

export const normalize = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const RULES = [
  ['led', /\bled\b|fita|driver|fonte|luminaria|spot|interruptor|sensor|cabo|eletric/],
  ['ferragem', /parafuso|dobradica|corredica|puxador|cavilha|minifix|rafix|tambor|pino|bucha|porca|arruela|trilho|pistao|sapata|rodizio|suporte|cantoneira de fixacao|fecho|tranca|amortecedor|ferragem|prego|grampo|nivelador/],
  ['metalon', /metalon|tubo|cantoneira|\baco\b|metal|ferro|viga|perfil (u|l|t)\b|barra chata/],
  ['porta', /porta|gaveta|frente|basculante|tampa de gaveta/],
  ['painel', /mdf|mdp|painel|lateral|prateleira|tampo|base|fundo|divisoria|travessa|rodape|chapa de|compensado|madeira|lamina/],
];

export function guessCategory(name) {
  const n = normalize(name);
  for (const [cat, re] of RULES) if (re.test(n)) return cat;
  return 'painel';
}

// Nomes que o SketchUp/exportadores geram automaticamente e não dizem nada.
const GENERIC = /^(id\d+|instance_?\d*|node_?\d*|group_?\d*|grupo\s*#?\d*|component_?\s*#?\d*|componente\s*#?\d*|mesh_?\d*|geometry_?\d*|object_?\d*|sketchup|model|scene|default|untitled|<[^>]*>)$/i;

export function cleanName(n) {
  return n.replace(/_/g, ' ').replace(/#\d+$/, '').replace(/\s{2,}/g, ' ').trim();
}

// Procura o primeiro nome significativo no objeto ou nos filhos (busca em largura).
export function prettyName(obj) {
  const queue = [obj];
  let seen = 0;
  while (queue.length && seen++ < 300) {
    const o = queue.shift();
    const raw = (o.name || '').trim();
    if (raw && !GENERIC.test(raw)) return cleanName(raw);
    queue.push(...o.children);
  }
  return 'Peça sem nome';
}

const hasMesh = (o) => {
  let found = false;
  o.traverse((c) => { if (c.isMesh) found = true; });
  return found;
};

// Desce pelos "invólucros" de um filho só (ex.: nó "SketchUp", grupo do móvel inteiro).
export function findModelRoot(scene) {
  let root = scene;
  for (;;) {
    const kids = root.children.filter(hasMesh);
    if (kids.length === 1 && !kids[0].isMesh && kids[0].children.filter(hasMesh).length > 0) root = kids[0];
    else return root;
  }
}

export function canSplit(obj) {
  return !obj.isMesh && obj.children.filter(hasMesh).length > 1;
}

// Lista de peças. `splits` = ids de peças que foram divididas em subpeças.
export function computeParts(root, splits = new Set()) {
  const parts = [];
  const walk = (obj, id) => {
    if (splits.has(id) && canSplit(obj)) {
      obj.children.forEach((c, i) => { if (hasMesh(c)) walk(c, `${id}.${i}`); });
    } else {
      parts.push({ id, object: obj, name: prettyName(obj) });
    }
  };
  root.children.forEach((c, i) => { if (hasMesh(c)) walk(c, String(i)); });
  if (!parts.length && hasMesh(root)) parts.push({ id: 'root', object: root, name: prettyName(root) });
  return parts;
}

// Medidas da peça em milímetros (caixa alinhada aos eixos, no mundo).
export function partSizeMM(obj) {
  const s = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  return [s.x, s.y, s.z].map((v) => Math.round(v * 1000));
}

// Cada malha ganha materiais próprios (para poder destacar/esmaecer uma peça sem afetar outras)
// e padronizados (MeshStandardMaterial, dupla face — o SketchUp costuma ter faces invertidas).
export function prepareMaterials(root) {
  root.traverse((m) => {
    if (!m.isMesh || m.userData._prepared) return;
    if (m.geometry && !m.geometry.attributes.normal) m.geometry.computeVertexNormals();
    const conv = (mat) => {
      const out = new THREE.MeshStandardMaterial({
        color: mat.color ? mat.color.clone() : new THREE.Color(0xcccccc),
        map: mat.map || null,
        transparent: !!mat.transparent && mat.opacity < 1,
        opacity: mat.opacity ?? 1,
        side: THREE.DoubleSide,
        roughness: 0.75,
        metalness: 0,
      });
      out.name = mat.name || '';
      if (out.map) out.map.colorSpace = THREE.SRGBColorSpace;
      return out;
    };
    m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
    m.userData._prepared = true;
  });
}

// O ColladaLoader troca o nome do componente (definição) pelo nome da instância,
// que no SketchUp costuma ser genérico ("instance_3"). Aqui devolvemos o nome do
// componente às instâncias sem nome próprio, antes de carregar.
export function fixColladaNames(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) return text;
  const defNames = new Map();
  for (const n of doc.getElementsByTagName('node')) {
    const id = n.getAttribute('id');
    if (id) defNames.set(id, n.getAttribute('name') || '');
  }
  let changed = false;
  for (const n of doc.getElementsByTagName('node')) {
    const own = (n.getAttribute('name') || '').trim();
    if (own && !GENERIC.test(own)) continue;
    const inst = [...n.children].find((c) => c.tagName === 'instance_node');
    if (!inst) continue;
    const ref = defNames.get((inst.getAttribute('url') || '').replace(/^#/, ''));
    if (ref && !GENERIC.test(ref)) { n.setAttribute('name', ref); changed = true; }
  }
  return changed ? new XMLSerializer().serializeToString(doc) : text;
}
