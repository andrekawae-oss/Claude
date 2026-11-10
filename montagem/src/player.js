// Animação da sequência de montagem + cálculo de tempo/equipe.
import * as THREE from 'three';

export const DIRECTIONS = {
  cima:     { label: 'De cima',             v: [0, 1, 0] },
  frente:   { label: 'Pela frente',         v: [0, 0, 1] },
  tras:     { label: 'Por trás',            v: [0, 0, -1] },
  esquerda: { label: 'Pela esquerda',       v: [-1, 0, 0] },
  direita:  { label: 'Pela direita',        v: [1, 0, 0] },
  baixo:    { label: 'De baixo',            v: [0, -1, 0] },
  explodir: { label: 'De fora para dentro', v: null },
  nenhum:   { label: 'Só aparecer',         v: [0, 0, 0] },
};

const HIGHLIGHT = new THREE.Color('#2f7cf6');
const SELECT = new THREE.Color('#ff6a00');
const LED_GLOW = new THREE.Color('#fff2b3');
const BLACK = new THREE.Color(0, 0, 0);

const easeOut = (u) => 1 - Math.pow(1 - u, 3);

export class AssemblyPlayer {
  /**
   * @param root    objeto raiz do modelo (já na cena)
   * @param parts   [{ id, object, category }]
   * @param steps   [{ parts: [id], direction, ... }]
   */
  constructor(root, parts, steps = []) {
    this.root = root;
    this.selected = new Set();
    this.ghosted = new Set();
    this.anims = [];
    this.time = 0;
    this.current = null;
    this.setParts(parts);
    this.setSteps(steps);
  }

  setParts(parts) {
    this.reset();
    this.parts = parts;
    this.byId = new Map(parts.map((p) => [p.id, p]));
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root);
    this.box = box;
    this.center = box.getCenter(new THREE.Vector3());
    this.radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.01);
    for (const p of parts) {
      const o = p.object;
      if (!o.userData._finalPos) o.userData._finalPos = o.position.clone();
      p.mats = [];
      o.traverse((m) => {
        if (!m.isMesh) return;
        for (const mat of [].concat(m.material)) {
          if (!mat.userData._base) {
            mat.userData._base = { opacity: mat.opacity, transparent: mat.transparent };
          }
          p.mats.push(mat);
        }
      });
      p.center = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    }
  }

  setSteps(steps) {
    this.steps = steps;
    this.stepOf = new Map();
    steps.forEach((s, i) => s.parts.forEach((id) => this.stepOf.set(id, i)));
  }

  // Volta tudo ao estado original (posições, visibilidade, materiais).
  reset() {
    this.anims = [];
    for (const p of this.parts || []) {
      p.object.position.copy(p.object.userData._finalPos || p.object.position);
      p.object.visible = true;
      this._look(p, { opacity: 1 });
    }
  }

  _look(p, { opacity = 1, tint = null, tintStrength = 0, glow = false }) {
    for (const mat of p.mats) {
      const base = mat.userData._base;
      const op = base.opacity * opacity;
      const transparent = base.transparent || op < 0.999;
      if (mat.transparent !== transparent) { mat.transparent = transparent; mat.needsUpdate = true; }
      mat.opacity = op;
      mat.depthWrite = op > 0.5;
      if (mat.emissive) {
        if (glow) { mat.emissive.copy(LED_GLOW); mat.emissiveIntensity = 1.4; }
        else if (tint) { mat.emissive.copy(tint); mat.emissiveIntensity = tintStrength; }
        else { mat.emissive.copy(BLACK); mat.emissiveIntensity = 1; }
      }
    }
  }

  _state(p, k) {
    const s = this.stepOf.get(p.id);
    const n = this.steps.length;
    const all = k == null || k < 0 || k >= n;
    const installed = all || s === undefined || s < k;
    const isCurrent = !all && s === k;
    return { visible: installed || isCurrent, isCurrent, installed };
  }

  _styleFor(p, k, opacity = 1) {
    const st = this._state(p, k);
    const ghost = this.ghosted.has(p.id);
    const sel = this.selected.has(p.id);
    return {
      opacity: ghost ? 0.12 * opacity : opacity,
      tint: sel ? SELECT : st.isCurrent ? HIGHLIGHT : null,
      tintStrength: sel ? 0.55 : 0.28,
      glow: p.category === 'led' && (st.installed || st.isCurrent) && !sel,
    };
  }

  /** Mostra a etapa k (null = modelo completo). Anima as peças da etapa. */
  setStep(k, { animate = true } = {}) {
    this.current = k;
    this.anims = [];
    this.time = 0;
    const current = [];
    for (const p of this.parts) {
      const st = this._state(p, k);
      p.object.position.copy(p.object.userData._finalPos);
      p.object.visible = st.visible;
      this._look(p, this._styleFor(p, k));
      if (st.isCurrent) current.push(p);
    }
    if (animate && current.length) this._animate(current, this.steps[k]);
  }

  replay() { this.setStep(this.current); }

  refresh() {
    for (const p of this.parts) if (!this.anims.some((a) => a.p === p)) this._look(p, this._styleFor(p, this.current));
  }

  _animate(parts, step) {
    const dir = DIRECTIONS[step.direction] || DIRECTIONS.cima;
    const dist = this.radius * 0.9;
    const stagger = Math.min(0.12, 1.2 / parts.length);
    // ordem: de baixo para cima, para parecer natural
    const sorted = [...parts].sort((a, b) => a.center.y - b.center.y);
    sorted.forEach((p, i) => {
      const o = p.object;
      const parent = o.parent;
      const finalWorld = parent.localToWorld(o.userData._finalPos.clone());
      let v;
      if (dir.v) v = new THREE.Vector3(...dir.v);
      else {
        v = p.center.clone().sub(this.center);
        v.y = Math.max(v.y, 0) * 0.5;
        if (v.lengthSq() < 1e-6) v.set(0, 1, 0);
        v.normalize();
      }
      const startWorld = finalWorld.clone().add(v.multiplyScalar(dist));
      const from = parent.worldToLocal(startWorld);
      const anim = { p, from, to: o.userData._finalPos.clone(), delay: i * stagger, dur: 0.9 };
      o.position.copy(from);
      this._look(p, this._styleFor(p, this.current, 0));
      this.anims.push(anim);
    });
  }

  get animating() { return this.anims.length > 0; }

  update(dt) {
    if (!this.anims.length) return;
    this.time += dt;
    this.anims = this.anims.filter((a) => {
      const u = THREE.MathUtils.clamp((this.time - a.delay) / a.dur, 0, 1);
      a.p.object.position.lerpVectors(a.from, a.to, easeOut(u));
      this._look(a.p, this._styleFor(a.p, this.current, Math.min(1, u / 0.35)));
      return u < 1;
    });
  }

  /** Caixa envolvendo as peças da etapa k (para aproximar a câmera). */
  stepBox(k) {
    const box = new THREE.Box3();
    for (const p of this.parts) {
      if (this.stepOf.get(p.id) === k) {
        const prev = p.object.position.clone();
        p.object.position.copy(p.object.userData._finalPos);
        p.object.updateMatrixWorld(true);
        box.expandByObject(p.object);
        p.object.position.copy(prev);
        p.object.updateMatrixWorld(true);
      }
    }
    return box;
  }
}

/**
 * Tempo e equipe. Etapas marcadas como "paralela" acontecem junto com a anterior:
 * o bloco dura o tempo da mais longa e precisa da soma das pessoas.
 */
export function summarize(steps) {
  const blocks = [];
  steps.forEach((s, i) => {
    const minutes = Math.max(0, Number(s.minutes) || 0);
    const people = Math.max(1, Number(s.people) || 1);
    if (s.parallel && blocks.length) {
      const b = blocks[blocks.length - 1];
      b.steps.push(i); b.minutes = Math.max(b.minutes, minutes); b.people += people;
    } else {
      blocks.push({ steps: [i], minutes, people });
    }
  });
  const totalMinutes = blocks.reduce((a, b) => a + b.minutes, 0);
  const peakPeople = blocks.reduce((a, b) => Math.max(a, b.people), 0);
  const personMinutes = steps.reduce((a, s) => a + (Number(s.minutes) || 0) * Math.max(1, Number(s.people) || 1), 0);
  const sequentialMinutes = steps.reduce((a, s) => a + (Number(s.minutes) || 0), 0);
  return { blocks, totalMinutes, peakPeople, personMinutes, sequentialMinutes };
}

export function fmtMinutes(m) {
  m = Math.round(m);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
