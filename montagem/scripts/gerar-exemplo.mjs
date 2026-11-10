// Gera exemplo/armario.dae: um armário no mesmo formato que o SketchUp exporta
// (polegadas, eixo Z para cima, componentes em library_nodes com nomes).
import { writeFileSync } from 'node:fs';

const IN = 1 / 25.4; // mm -> polegadas
const materials = {
  mdf: [0.95, 0.94, 0.91], madeira: [0.72, 0.53, 0.35], metal: [0.22, 0.23, 0.25],
  inox: [0.7, 0.71, 0.73], led: [1, 0.97, 0.8],
};
const defs = new Map(); // nome -> { w, d, h, mat }
const instances = []; // { def, x, y, z }

// x = largura, y = profundidade (frente em y=0), z = altura; medidas em mm
function part(name, mat, [w, d, h], [x, y, z]) {
  const key = `${name}|${w}|${d}|${h}`;
  if (!defs.has(key)) defs.set(key, { id: `def${defs.size}`, name, w, d, h, mat });
  instances.push({ def: defs.get(key), x, y, z });
}

const W = 800, D = 450, H = 1900, T = 18, BASE = 100;
// estrutura de metalon
for (const [x, y] of [[0, 0], [W - 30, 0], [0, D - 30], [W - 30, D - 30]]) part('Metalon 30x30 - Pe', 'metal', [30, 30, BASE - 30], [x, y, 0]);
part('Metalon 30x30 - Travessa frontal', 'metal', [W, 30, 30], [0, 0, BASE - 30]);
part('Metalon 30x30 - Travessa traseira', 'metal', [W, 30, 30], [0, D - 30, BASE - 30]);
part('Metalon 30x30 - Travessa lateral', 'metal', [30, D - 60, 30], [0, 30, BASE - 30]);
part('Metalon 30x30 - Travessa lateral', 'metal', [30, D - 60, 30], [W - 30, 30, BASE - 30]);
// caixa
part('Base MDF 18mm', 'mdf', [W, D, T], [0, 0, BASE]);
part('Lateral MDF 18mm', 'mdf', [T, D, H - BASE - 2 * T], [0, 0, BASE + T]);
part('Lateral MDF 18mm', 'mdf', [T, D, H - BASE - 2 * T], [W - T, 0, BASE + T]);
part('Tampo MDF 18mm', 'mdf', [W, D, T], [0, 0, H - T]);
part('Fundo MDF 6mm', 'mdf', [W - 2 * T, 6, H - BASE - 2 * T], [T, D - 6, BASE + T]);
for (const z of [600, 1100, 1500]) part('Prateleira MDF 18mm', 'mdf', [W - 2 * T, D - 30, T], [T, 10, z]);
// ferragens
for (const x of [T, W - T - 35]) for (const z of [BASE + 150, H - 250]) part('Dobradica 35mm', 'inox', [35, 12, 50], [x, 0, z]);
// portas
const PH = H - BASE - 2 * T - 4;
part('Porta MDF 18mm', 'madeira', [W / 2 - 3, T, PH], [1, -T, BASE + T + 2]);
part('Porta MDF 18mm', 'madeira', [W / 2 - 3, T, PH], [W / 2 + 2, -T, BASE + T + 2]);
part('Puxador perfil 300mm', 'inox', [20, 25, 300], [W / 2 - 40, -T - 25, 900]);
part('Puxador perfil 300mm', 'inox', [20, 25, 300], [W / 2 + 20, -T - 25, 900]);
// LED
for (const z of [600, 1100, 1500]) part('Fita LED 12V', 'led', [W - 2 * T - 20, 10, 3], [T + 10, 15, z - 3]);
part('Driver LED 12V', 'metal', [100, 40, 30], [T + 20, D - 60, BASE + T]);

const f = (n) => +(n * IN).toFixed(4);
function box({ w, d, h }) {
  const [X, Y, Z] = [f(w), f(d), f(h)];
  const faces = [
    [[0, 0, 0], [0, Y, 0], [X, Y, 0], [X, 0, 0]], [[0, 0, Z], [X, 0, Z], [X, Y, Z], [0, Y, Z]],
    [[0, 0, 0], [X, 0, 0], [X, 0, Z], [0, 0, Z]], [[0, Y, 0], [0, Y, Z], [X, Y, Z], [X, Y, 0]],
    [[0, 0, 0], [0, 0, Z], [0, Y, Z], [0, Y, 0]], [[X, 0, 0], [X, Y, 0], [X, Y, Z], [X, 0, Z]],
  ];
  const pos = faces.flat().flat();
  const idx = faces.flatMap((_, i) => [i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3]);
  return { pos, idx };
}

let geoms = '', nodes = '';
for (const def of defs.values()) {
  const { pos, idx } = box(def);
  const g = `geo_${def.id}`;
  geoms += `<geometry id="${g}"><mesh>
<source id="${g}-pos"><float_array id="${g}-pos-array" count="${pos.length}">${pos.join(' ')}</float_array>
<technique_common><accessor source="#${g}-pos-array" count="${pos.length / 3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<vertices id="${g}-vtx"><input semantic="POSITION" source="#${g}-pos"/></vertices>
<triangles material="m" count="${idx.length / 3}"><input semantic="VERTEX" source="#${g}-vtx" offset="0"/><p>${idx.join(' ')}</p></triangles>
</mesh></geometry>\n`;
  nodes += `<node id="${def.id}" name="${def.name.replace(/ /g, '_')}"><instance_geometry url="#${g}"><bind_material><technique_common><instance_material symbol="m" target="#mat_${def.mat}"/></technique_common></bind_material></instance_geometry></node>\n`;
}
const insts = instances.map((it, i) =>
  `<node id="ID${i + 10}" name="instance_${i}"><matrix>1 0 0 ${f(it.x)} 0 1 0 ${f(it.y)} 0 0 1 ${f(it.z)} 0 0 0 1</matrix><instance_node url="#${it.def.id}"/></node>`).join('\n');

const effects = Object.entries(materials).map(([k, c]) =>
  `<effect id="mat_${k}-effect"><profile_COMMON><technique sid="COMMON"><lambert><diffuse><color>${c.join(' ')} 1</color></diffuse></lambert></technique></profile_COMMON></effect>`).join('\n');
const mats = Object.keys(materials).map((k) => `<material id="mat_${k}" name="${k}"><instance_effect url="#mat_${k}-effect"/></material>`).join('\n');

const dae = `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
<asset><contributor><authoring_tool>Exemplo (formato SketchUp)</authoring_tool></contributor><unit meter="0.0254" name="inch"/><up_axis>Z_UP</up_axis></asset>
<library_effects>${effects}</library_effects>
<library_materials>${mats}</library_materials>
<library_geometries>${geoms}</library_geometries>
<library_nodes>${nodes}</library_nodes>
<library_visual_scenes><visual_scene id="scene"><node name="SketchUp"><node id="ID2" name="Armario_2_portas">
${insts}
</node></node></visual_scene></library_visual_scenes>
<scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>
`;
writeFileSync(new URL('../exemplo/armario.dae', import.meta.url), dae);
console.log(`exemplo/armario.dae: ${instances.length} peças, ${defs.size} componentes`);
