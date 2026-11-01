'use client';
// The enclave (DESIGN 2.2): Three.js glass cube with a fresnel shader, edges, violet core,
// rings, engraved rosette and data particles spiralling in. Ported from initGL() in
// docs/landing-reference.html. `three` is loaded on demand (kept out of the first bundle) and
// the scene renders only while on screen (DESIGN 7.5). `calm` = the small, quiet version used on
// app screens while a score is computed. Reduced motion: one still frame.
import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

export function EnclaveGL({ calm = false, className, style }: { calm?: boolean; className?: string; style?: React.CSSProperties }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let cleanup = () => {};

    import('three').then((THREE) => {
      if (disposed) return;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
      } catch {
        return; // no WebGL: the CSS glow behind stays
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
      camera.position.set(0, 0, calm ? 6.2 : 5.4);
      const root = new THREE.Group();
      scene.add(root);

      const mint = new THREE.Color('#9FD9BF'), violet = new THREE.Color('#8E6CF0');
      const glassMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uA: { value: mint }, uB: { value: violet }, uT: { value: 0 } },
        vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vec4 wp=modelMatrix*vec4(position,1.0); vN=normalize(mat3(modelMatrix)*normal); vV=normalize(cameraPosition-wp.xyz); vP=position; gl_Position=projectionMatrix*viewMatrix*wp; }',
        fragmentShader: 'uniform vec3 uA; uniform vec3 uB; uniform float uT; varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ float f=pow(1.0-abs(dot(normalize(vN),normalize(vV))),2.4); float scan=0.5+0.5*sin(vP.y*42.0-uT*2.0); vec3 c=mix(uA,uB,clamp(vP.y*0.6+0.5,0.0,1.0)); float a=0.05+f*0.55+scan*0.025; gl_FragColor=vec4(c*(0.25+f*1.3),a); }',
      });
      const boxGeo = new THREE.BoxGeometry(1.7, 1.7, 1.7);
      const box = new THREE.Mesh(boxGeo, glassMat); root.add(box);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), new THREE.LineBasicMaterial({ color: '#CFEBDD', transparent: true, opacity: 0.75 })); root.add(edges);
      const inner = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.2, 1.2, 1.2)), new THREE.LineBasicMaterial({ color: '#8E6CF0', transparent: true, opacity: 0.45 })); root.add(inner);

      const gcv = document.createElement('canvas'); gcv.width = gcv.height = 256;
      const gx = gcv.getContext('2d')!;
      const gg = gx.createRadialGradient(128, 128, 0, 128, 128, 128);
      gg.addColorStop(0, 'rgba(220,205,255,1)'); gg.addColorStop(0.35, 'rgba(142,108,240,.35)'); gg.addColorStop(1, 'rgba(142,108,240,0)');
      gx.fillStyle = gg; gx.fillRect(0, 0, 256, 256);
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 2), new THREE.MeshBasicMaterial({ color: '#D9CCFF' })); root.add(core);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gcv), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      glow.scale.set(2.6, 2.6, 1); root.add(glow);

      const R0 = rng(3);
      const rings = [0, 1, 2].map((i) => {
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.5 + i * 0.08, 0.0035, 6, 220), new THREE.MeshBasicMaterial({ color: i === 1 ? '#8E6CF0' : '#9FD9BF', transparent: true, opacity: 0.6 }));
        t.rotation.set(R0() * 3, R0() * 3, 0); root.add(t); return t;
      });

      const rosPts: InstanceType<typeof THREE.Vector3>[] = [];
      for (let k = 0; k <= 1600; k++) {
        const a = (k / 1600) * Math.PI * 2, rr = 2.6 + 0.12 * Math.sin(a * 36) + 0.05 * Math.sin(a * 91);
        rosPts.push(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, 0));
      }
      const rosGeo = new THREE.BufferGeometry().setFromPoints(rosPts);
      const rosette = new THREE.Group();
      for (let m = 0; m < 6; m++) {
        const ln = new THREE.LineLoop(rosGeo, new THREE.LineBasicMaterial({ color: '#9FD9BF', transparent: true, opacity: 0.12 }));
        ln.rotation.z = m * 0.09; ln.scale.setScalar(1 + m * 0.035); rosette.add(ln);
      }
      rosette.position.z = -1.6; root.add(rosette);

      const N = calm ? 360 : window.innerWidth < 700 ? 700 : 1500;
      const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
      const R2 = rng(7);
      const P = Array.from({ length: N }, (_, p) => {
        const c = R2() < 0.75 ? mint : violet;
        col[p * 3] = c.r; col[p * 3 + 1] = c.g; col[p * 3 + 2] = c.b;
        return { a: R2() * Math.PI * 2, r: 1.4 + R2() * 5, y: (R2() - 0.5) * 3.2, s: 0.25 + R2() * 0.6 };
      });
      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      pGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.028, vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      root.add(points);

      const size = () => {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      };
      size();
      const ro = new ResizeObserver(size); ro.observe(canvas);

      let mx = 0, my = 0, tmx = 0, tmy = 0;
      const onMouse = (e: MouseEvent) => { tmx = e.clientX / window.innerWidth - 0.5; tmy = e.clientY / window.innerHeight - 0.5; };
      if (!calm) window.addEventListener('mousemove', onMouse);

      const speed = calm ? 0.45 : 1;
      let clock = 0, prev = performance.now(), raf = 0, visible = true;
      const frame = (now: number) => {
        const dt = Math.min(0.05, (now - prev) / 1000) * speed; prev = now; clock += dt;
        mx += (tmx - mx) * 0.05; my += (tmy - my) * 0.05;
        camera.position.x = mx * 0.35; camera.position.y = -my * 0.25; camera.lookAt(0, 0, 0);
        glassMat.uniforms.uT.value = clock;
        box.rotation.y = 0.6 + clock * 0.08; box.rotation.x = 0.35;
        edges.rotation.copy(box.rotation); inner.rotation.set(-clock * 0.12, clock * 0.15, 0);
        const pulse = 1 + 0.08 * Math.sin(clock * 2.2);
        core.scale.setScalar(pulse); glow.scale.setScalar(2.6 * pulse); core.rotation.y += dt * 0.4;
        rings.forEach((r, i) => { r.rotation.x += dt * (0.2 + i * 0.07); r.rotation.y += dt * (0.13 + i * 0.05); });
        rosette.rotation.z = clock * 0.02;
        for (let i = 0; i < N; i++) {
          const q = P[i]; q.r -= dt * q.s; q.a += dt * (0.6 / q.r + 0.05);
          if (q.r < 0.35) { q.r = 4.5 + Math.random() * 2; q.a = Math.random() * Math.PI * 2; q.y = (Math.random() - 0.5) * 3.2; }
          const yy = q.y * Math.min(1, q.r / 3.5);
          pos[i * 3] = Math.cos(q.a) * q.r; pos[i * 3 + 1] = yy; pos[i * 3 + 2] = Math.sin(q.a) * q.r;
        }
        pGeo.attributes.position.needsUpdate = true;
        renderer.render(scene, camera);
        if (visible && !document.hidden && !prefersReducedMotion()) raf = requestAnimationFrame(frame);
      };
      const start = () => { cancelAnimationFrame(raf); prev = performance.now(); raf = requestAnimationFrame(frame); };
      const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); else cancelAnimationFrame(raf); });
      io.observe(canvas);
      const onVis = () => { if (!document.hidden && visible) start(); };
      document.addEventListener('visibilitychange', onVis);
      start();

      cleanup = () => {
        cancelAnimationFrame(raf); io.disconnect(); ro.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('mousemove', onMouse);
        scene.traverse((o) => {
          const m = o as unknown as { geometry?: { dispose(): void }; material?: { dispose(): void } };
          m.geometry?.dispose(); m.material?.dispose();
        });
        renderer.dispose();
      };
    });

    return () => { disposed = true; cleanup(); };
  }, [calm]);

  return <canvas ref={canvasRef} className={className} style={{ width: '100%', height: '100%', display: 'block', ...style }} aria-hidden="true" />;
}
