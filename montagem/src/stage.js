// Palco 3D: renderizador, câmera, luzes, controles de órbita e enquadramento suave.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createStage(container, { background = 0xeef1f4, grid = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8f94, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  fill.position.set(-4, 2, -3);
  scene.add(fill);

  let tween = null;
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
  camera.position.set(2, 1.5, 3);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.addEventListener('start', () => { tween = null; });

  let gridHelper = null;
  const setGrid = (box) => {
    if (!grid) return;
    if (gridHelper) scene.remove(gridHelper);
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.z) * 2 || 2;
    gridHelper = new THREE.GridHelper(extent, 20, 0xb8bec6, 0xd5d9de);
    gridHelper.position.set(box.getCenter(new THREE.Vector3()).x, box.min.y, box.getCenter(new THREE.Vector3()).z);
    scene.add(gridHelper);
  };

  // Tween de câmera
  function frame(box, { instant = false, direction = new THREE.Vector3(0.9, 0.65, 1.3) } = {}) {
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.05);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * camera.aspect));
    const dist = (radius / Math.sin(fit / 2)) * 1.05;
    const dir = direction.clone().normalize();
    const pos = center.clone().add(dir.multiplyScalar(dist));
    camera.near = Math.max(dist / 200, 0.001);
    camera.far = dist * 50;
    camera.updateProjectionMatrix();
    if (instant) {
      camera.position.copy(pos);
      controls.target.copy(center);
      tween = null;
    } else {
      tween = { t: 0, fromPos: camera.position.clone(), toPos: pos, fromTarget: controls.target.clone(), toTarget: center };
    }
  }
  // mantém a direção atual da câmera
  function frameKeepingAngle(box, opts = {}) {
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-9) dir.set(0.9, 0.65, 1.3);
    frame(box, { ...opts, direction: dir });
  }

  const callbacks = [];
  const clock = new THREE.Clock();
  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / 0.7);
      const e = 1 - Math.pow(1 - tween.t, 3);
      camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
      controls.target.lerpVectors(tween.fromTarget, tween.toTarget, e);
      if (tween.t >= 1) tween = null;
    }
    for (const cb of callbacks) cb(dt);
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    renderer, scene, camera, controls, frame, frameKeepingAngle, setGrid,
    onFrame: (cb) => callbacks.push(cb),
    stopTween: () => { tween = null; },
  };
}
