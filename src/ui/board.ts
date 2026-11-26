import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Simulation } from '../model';
import { voltageRGB } from './color';

const WIDEN = 6;          // trace widths are drawn this many times wider than reality
const SEG = 360;
const BOARD_W = 150, BOARD_D = 100;

interface Path { at(f: number): { x: number; z: number; tx: number; tz: number }; length: number; }
function makePath(pts: [number, number][]): Path {
  const acc = [0];
  for (let k = 1; k < pts.length; k++) acc.push(acc[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const length = acc[acc.length - 1];
  return { length, at(f) {
    const s = Math.min(Math.max(f, 0), 1) * length;
    let k = 1; while (k < pts.length - 1 && acc[k] < s) k++;
    const [x0, z0] = pts[k - 1], [x1, z1] = pts[k], d = acc[k] - acc[k - 1], u = (s - acc[k - 1]) / d;
    return { x: x0 + (x1 - x0) * u, z: z0 + (z1 - z0) * u, tx: (x1 - x0) / d, tz: (z1 - z0) / d };
  } };
}

function label(text: string, color = '#dfe7f2', size = 3.4): THREE.Sprite {
  const c = document.createElement('canvas'), g = c.getContext('2d')!;
  g.font = '600 48px system-ui, Segoe UI, sans-serif';
  c.width = Math.ceil(g.measureText(text).width) + 24; c.height = 64;
  g.font = '600 48px system-ui, Segoe UI, sans-serif';
  g.fillStyle = 'rgba(8,12,18,0.72)'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 12, 34);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set((size * c.width) / c.height, size, 1); s.renderOrder = 10;
  return s;
}

function strip(n: number, opts: THREE.MeshBasicMaterialParameters): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 6), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array((n + 1) * 6), 3));
  const idx: number[] = [];
  for (let k = 0; k < n; k++) idx.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, ...opts }));
  m.frustumCulled = false;
  return m;
}

interface TraceView {
  path: Path; ribbon: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; curtain: TraceView['ribbon']; crest: THREE.Line;
  stub?: TraceView['ribbon']; stubPick?: THREE.Mesh; arrows: THREE.InstancedMesh; ret: THREE.InstancedMesh; n: number;
}

export class BoardView {
  show = { wave: true, current: true, ret: true, exploded: true };
  private renderer: THREE.WebGLRenderer; private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 1, 2000); private controls: OrbitControls;
  private views: TraceView[] = []; private layers: { obj: THREE.Object3D; k: number }[] = [];
  private picks: THREE.Object3D[] = []; private gap = 14; private layerTags: THREE.Sprite[] = [];
  private color = new THREE.Color(); private dummy = new THREE.Object3D();

  constructor(private host: HTMLElement, private sim: Simulation, onPick: (k: number) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x0b0f16);
    host.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.resetCamera();
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.3));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-40, 120, 60); this.scene.add(sun);
    this.buildBoard();
    sim.traces.forEach((_, k) => this.buildTrace(k));
    new ResizeObserver(() => this.resize()).observe(host); this.resize();

    const ray = new THREE.Raycaster(), p = new THREE.Vector2();
    const hit = (e: PointerEvent) => {
      const r = this.renderer.domElement.getBoundingClientRect();
      p.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(p, this.camera);
      return ray.intersectObjects(this.picks)[0]?.object.userData.trace as number | undefined;
    };
    let down = [0, 0];
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
    el.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const k = hit(e); if (k !== undefined) onPick(k);
    });
    el.addEventListener('pointermove', (e) => (el.style.cursor = hit(e) !== undefined ? 'pointer' : 'grab'));
  }

  resetCamera(): void { this.camera.position.set(-14, 138, 148); this.controls.target.set(0, -14, 4); this.controls.update(); }

  private resize(): void {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h); this.camera.aspect = w / h;
    // Keep the whole board visible in narrow windows.
    this.camera.zoom = Math.min(1, w / h / 1.45); this.camera.updateProjectionMatrix();
  }

  private layer(k: number): THREE.Group { const g = new THREE.Group(); this.scene.add(g); this.layers.push({ obj: g, k }); return g; }

  private buildBoard(): void {
    const names = ['L1 · Signal', 'L2 · GND plane', 'L3 · VCC plane', 'L4 · Signal'];
    const slab = (y: number, color: number, opacity: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W, 0.5, BOARD_D),
        new THREE.MeshLambertMaterial({ color, transparent: true, opacity, depthWrite: false }));
      m.position.y = y; return m;
    };
    [[0x14563c, 0.5], [0x8a5a2b, 0.5], [0x8a2f3d, 0.42], [0x14563c, 0.42]].forEach(([c, o], k) => {
      const g = this.layer(k); g.add(slab(-0.4, c, o));
      g.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(BOARD_W, 0.5, BOARD_D)), new THREE.LineBasicMaterial({ color: 0x7f93ad, transparent: true, opacity: 0.45 })));
      g.children[1].position.y = -0.4;
      const l = label(names[k], '#aebfd6', 3.8); l.position.set(BOARD_W / 2 + 14, 0, 30); g.add(l); this.layerTags.push(l);
    });
    // Decorative bottom-layer routing.
    const g4 = this.layers[3].obj;
    for (let k = 0; k < 7; k++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(70 + 6 * k, 0.15, 0.8), new THREE.MeshLambertMaterial({ color: 0xc48042, transparent: true, opacity: 0.6 }));
      m.position.set(-18 + 3 * k, 0, -30 + 10 * k); g4.add(m);
    }
    const g1 = this.layers[0].obj;
    const chip = new THREE.Mesh(new THREE.BoxGeometry(24, 4, 40), new THREE.MeshLambertMaterial({ color: 0x1b1d22 }));
    chip.position.set(47, 2.4, -1); g1.add(chip);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(1.4, 20), new THREE.MeshBasicMaterial({ color: 0xd8dee9 }));
    dot.rotation.x = -Math.PI / 2; dot.position.set(39, 4.45, -17); g1.add(dot);
    const cl = label('DEMO-1 chip', '#ffffff', 4.4); cl.position.set(49, 9, -1); g1.add(cl);
    const metal = new THREE.MeshLambertMaterial({ color: 0xc9ced6 });
    for (let z = -18; z <= 16; z += 4) for (const x of [34, 60]) { const pin = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 1.6), metal); pin.position.set(x, 0.5, z); g1.add(pin); }
    const box = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 74), new THREE.MeshLambertMaterial({ color: 0x2b4d7e }));
    box.position.set(-71, 2.6, -5); g1.add(box);
    const gl = label('Signal generator', '#cfe0ff', 4.4); gl.position.set(-70, 10, -52); g1.add(gl);
  }

  private buildTrace(k: number): void {
    const t = this.sim.traces[k], path = makePath(t.path), g = this.layers[0].obj;
    const ribbon = strip(SEG, {}), curtain = strip(SEG, { transparent: true, opacity: 0.34, depthWrite: false });
    const crest = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 3), 3)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }));
    crest.frustumCulled = false;
    const n = Math.floor(path.length / 5);
    const cone = new THREE.ConeGeometry(0.65, 2.1, 8); cone.rotateX(Math.PI / 2);
    const arrows = new THREE.InstancedMesh(cone, new THREE.MeshBasicMaterial({ color: 0xffe45c }), n);
    const ret = new THREE.InstancedMesh(cone, new THREE.MeshBasicMaterial({ color: 0x5cf2d6 }), n);
    arrows.frustumCulled = ret.frustumCulled = false;
    g.add(ribbon, curtain, crest, arrows); this.layers[1].obj.add(ret);
    for (let s = 0; s < 90; s++) {
      const a = path.at(s / 90), b = path.at((s + 1) / 90), len = Math.hypot(b.x - a.x, b.z - a.z);
      const pick = new THREE.Mesh(new THREE.BoxGeometry(len + 0.5, 2, 6), new THREE.MeshBasicMaterial({ visible: false }));
      pick.position.set((a.x + b.x) / 2, 1, (a.z + b.z) / 2); pick.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      pick.userData.trace = k; g.add(pick); this.picks.push(pick);
    }
    const name = label(`${t.id} · ${t.name}`, '#ffffff', 3.6);
    const at = path.at(k === 3 ? 0.12 : 0.22); name.position.set(at.x, 1.5, at.z - 4.5); g.add(name);
    const view: TraceView = { path, ribbon, curtain, crest, arrows, ret, n };
    if (t.spec.stub) {
      view.stub = strip(60, {}); g.add(view.stub);
      const m = t.spec.stub.len * 1000, mid = path.at(0.5);
      view.stubPick = new THREE.Mesh(new THREE.BoxGeometry(6, 2, m), new THREE.MeshBasicMaterial({ visible: false }));
      view.stubPick.position.set(mid.x, 1, mid.z + m / 2); view.stubPick.userData.trace = k; g.add(view.stubPick); this.picks.push(view.stubPick);
    }
    this.views.push(view);
  }

  private paint(attr: THREE.BufferAttribute, i: number, x: number): void {
    const [r, g, b] = voltageRGB(x);
    this.color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    attr.setXYZ(i, this.color.r, this.color.g, this.color.b);
  }

  render(dt: number): void {
    const target = this.show.exploded ? 14 : 1.2;
    this.gap += (target - this.gap) * Math.min(1, dt * 6);
    for (const { obj, k } of this.layers) obj.position.y = -k * this.gap;
    // Layer names would pile up when the layers are collapsed.
    for (const tag of this.layerTags) tag.visible = this.gap > 6;
    const amp = this.sim.gen.amp;
    this.views.forEach((view, k) => {
      const s = this.sim.sims[k], net = s.net, spec = s.trace.spec;
      const rp = view.ribbon.geometry.attributes.position as THREE.BufferAttribute, rc = view.ribbon.geometry.attributes.color as THREE.BufferAttribute;
      const cp = view.curtain.geometry.attributes.position as THREE.BufferAttribute, cc = view.curtain.geometry.attributes.color as THREE.BufferAttribute;
      const lp = view.crest.geometry.attributes.position as THREE.BufferAttribute;
      for (let j = 0; j <= SEG; j++) {
        const f = j / SEG, q = view.path.at(f), v = net.vAt(f) / amp;
        const half = (spec.sections[net.sectionAt(f)].w * 1000 * WIDEN) / 2;
        rp.setXYZ(2 * j, q.x - q.tz * half, 0.15, q.z + q.tx * half); rp.setXYZ(2 * j + 1, q.x + q.tz * half, 0.15, q.z - q.tx * half);
        this.paint(rc, 2 * j, v); this.paint(rc, 2 * j + 1, v);
        const y = 0.2 + 7 * Math.max(-1.5, Math.min(1.5, v));
        cp.setXYZ(2 * j, q.x, 0.2, q.z); cp.setXYZ(2 * j + 1, q.x, y, q.z);
        this.paint(cc, 2 * j, v); this.paint(cc, 2 * j + 1, v); lp.setXYZ(j, q.x, y, q.z);
      }
      for (const a of [rp, rc, cp, cc, lp]) a.needsUpdate = true;
      view.ribbon.geometry.boundingSphere = null;
      view.curtain.visible = view.crest.visible = this.show.wave;
      if (view.stub && spec.stub) {
        const p = view.stub.geometry.attributes.position as THREE.BufferAttribute, c = view.stub.geometry.attributes.color as THREE.BufferAttribute;
        const mid = view.path.at(0.5), m = spec.stub.len * 1000, half = (spec.stub.w * 1000 * WIDEN) / 2, ids = net.stubNodes;
        for (let j = 0; j <= 60; j++) {
          const f = j / 60, v = net.v[ids[Math.round(f * (ids.length - 1))]] / amp;
          p.setXYZ(2 * j, mid.x - half, 0.16, mid.z + f * m); p.setXYZ(2 * j + 1, mid.x + half, 0.16, mid.z + f * m);
          this.paint(c, 2 * j, v); this.paint(c, 2 * j + 1, v);
        }
        p.needsUpdate = c.needsUpdate = true;
        view.stubPick!.scale.z = m / (view.stubPick!.geometry as THREE.BoxGeometry).parameters.depth;
        view.stubPick!.position.z = mid.z + m / 2;
      }
      view.arrows.visible = this.show.current; view.ret.visible = this.show.ret;
      for (let j = 0; j < view.n; j++) {
        const f = (j + 0.5) / view.n, q = view.path.at(f);
        // Scaled by 50 ohm so that a matched incident wave of amp/2 draws at about full size.
        const x = (net.iAt(f) * 100) / amp, size = Math.abs(x) < 0.04 ? 0 : Math.min(1.5, Math.abs(x));
        for (const [mesh, sign, y] of [[view.arrows, 1, 1.2], [view.ret, -1, 0.7]] as const) {
          const dir = Math.sign(x) * sign;
          this.dummy.position.set(q.x, y, q.z);
          this.dummy.rotation.set(0, Math.atan2(q.tx * dir, q.tz * dir), 0);
          this.dummy.scale.setScalar(size); this.dummy.updateMatrix(); mesh.setMatrixAt(j, this.dummy.matrix);
        }
      }
      view.arrows.instanceMatrix.needsUpdate = view.ret.instanceMatrix.needsUpdate = true;
    });
    this.renderer.render(this.scene, this.camera);
  }
}
