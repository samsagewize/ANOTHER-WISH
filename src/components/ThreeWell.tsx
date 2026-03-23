import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export const ThreeWell: React.FC<{ onPlunge: () => void }> = ({ onPlunge }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const clock = new THREE.Clock();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02050e);
    scene.fog = new THREE.FogExp2(0x02050e, 0.036);

    const camera = new THREE.PerspectiveCamera(54, container.offsetWidth / container.offsetHeight, 0.1, 200);
    camera.position.set(0, 3.4, 9);
    camera.lookAt(0, 0.6, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.offsetWidth, container.offsetHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.72;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Textures
    const mkTex = (fn: () => HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(fn());
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    };

    const mkStoneCvs = (sz: number, dark: boolean) => {
      const c = document.createElement('canvas');
      c.width = c.height = sz;
      const x = c.getContext('2d')!;
      const b = dark ? 22 : 46;
      x.fillStyle = `rgb(${b},${b - 3},${b - 9})`;
      x.fillRect(0, 0, sz, sz);
      for (let i = 0; i < 3000; i++) {
        const px = Math.random() * sz, py = Math.random() * sz, r = Math.random() * 2.2;
        const v = b + (Math.random() - .5) * 38 | 0;
        x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2);
        x.fillStyle = `rgba(${v},${v - 2},${v - 7},.55)`; x.fill();
      }
      const rows = 8;
      for (let r = 0; r < rows; r++) {
        x.fillStyle = 'rgba(0,0,0,.38)'; x.fillRect(0, r * sz / rows - 1, sz, 2);
        const off = (r % 2) * sz / 4;
        for (let col = off; col < sz + off; col += sz / 4) {
          x.fillStyle = 'rgba(0,0,0,.22)'; x.fillRect(col - 1, r * sz / rows, 2, sz / rows);
        }
      }
      return c;
    };

    const mkWaterCvs = (sz: number) => {
      const c = document.createElement('canvas');
      c.width = c.height = sz;
      const x = c.getContext('2d')!;
      x.fillStyle = '#8080ff'; x.fillRect(0, 0, sz, sz);
      for (let i = 0; i < 600; i++) {
        const px = Math.random() * sz, py = Math.random() * sz, r = 2 + Math.random() * 14;
        const g = x.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, 'rgba(145,145,255,.65)'); g.addColorStop(1, 'rgba(128,128,255,0)');
        x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
      }
      return c;
    };

    const mkGroundCvs = (sz: number) => {
      const c = document.createElement('canvas');
      c.width = c.height = sz;
      const x = c.getContext('2d')!;
      x.fillStyle = '#181006'; x.fillRect(0, 0, sz, sz);
      for (let i = 0; i < 5000; i++) {
        const v = 8 + Math.random() * 22 | 0;
        x.beginPath(); x.arc(Math.random() * sz, Math.random() * sz, Math.random() * 1.8, 0, Math.PI * 2);
        x.fillStyle = `rgba(${v + 4},${v},${v - 4},.65)`; x.fill();
      }
      return c;
    };

    const stoneTex = mkTex(() => mkStoneCvs(256, false)); stoneTex.repeat.set(3, 6);
    const stoneDark = mkTex(() => mkStoneCvs(256, true)); stoneDark.repeat.set(2, 5);
    const waterNorm = mkTex(() => mkWaterCvs(256)); waterNorm.repeat.set(2, 2);
    const groundTex = mkTex(() => mkGroundCvs(512)); groundTex.repeat.set(8, 8);

    const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: .92, metalness: .04 });
    const darkMat = new THREE.MeshStandardMaterial({ map: stoneDark, roughness: .97, metalness: 0, color: 0x1a1008, side: THREE.BackSide });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x3a2010, roughness: .9, metalness: .04 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x8a8060, metalness: .8, roughness: .3 });

    const wellGrp = new THREE.Group();
    scene.add(wellGrp);

    // Well components
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1.62, 1.78, 2.5, 32, 8, true), stoneMat);
    barrel.position.y = 1.25; barrel.castShadow = barrel.receiveShadow = true; wellGrp.add(barrel);

    const inner = new THREE.Mesh(new THREE.CylinderGeometry(1.46, 1.58, 3.8, 32, 4, true), darkMat);
    inner.position.y = 1.0; wellGrp.add(inner);

    const rimMat = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: .84, metalness: .05, color: 0x8a7050 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.66, .19, 12, 48), rimMat);
    rim.rotation.x = Math.PI / 2; rim.position.y = 2.52; rim.castShadow = true; wellGrp.add(rim);

    const waterMat = new THREE.MeshStandardMaterial({ color: 0x0a2a50, roughness: .04, metalness: .92, normalMap: waterNorm, normalScale: new THREE.Vector2(.45, .45), transparent: true, opacity: .93 });
    const waterMesh = new THREE.Mesh(new THREE.CircleGeometry(1.44, 48), waterMat);
    waterMesh.rotation.x = -Math.PI / 2; waterMesh.position.y = -0.15; wellGrp.add(waterMesh);

    // Pillars
    const addPillar = (x: number) => {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(.3, 3.0, .3), stoneMat); shaft.castShadow = true; g.add(shaft);
      [[-1.5], [1.5]].forEach(([dy]) => {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(.46, .2, .46), stoneMat);
        cap.position.set(0, dy, 0);
        g.add(cap);
      });
      g.position.set(x, 3.4, 0); wellGrp.add(g);
    };
    addPillar(-1.88); addPillar(1.88);

    const beam = new THREE.Mesh(new THREE.BoxGeometry(4.4, .22, .24), woodMat);
    beam.position.y = 4.9; beam.castShadow = true; wellGrp.add(beam);

    const bucketGrp = new THREE.Group();
    const bkt = new THREE.Mesh(new THREE.CylinderGeometry(.19, .16, .32, 16), new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: .85, metalness: .08 }));
    bkt.castShadow = true; bucketGrp.add(bkt);
    bucketGrp.position.set(0, 3.1, 0); wellGrp.add(bucketGrp);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ map: groundTex, roughness: .98, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

    // Lights
    scene.add(new THREE.AmbientLight(0x070b16, .55));
    const moonDir = new THREE.DirectionalLight(0xccd4f0, .65); moonDir.position.set(30, 34, -42); moonDir.castShadow = true;
    scene.add(moonDir);

    const waterLight = new THREE.PointLight(0x1a6aba, 3.8, 5.5); waterLight.position.set(0, .1, 0); scene.add(waterLight);
    const torch1 = new THREE.PointLight(0xff8833, 2.4, 9); torch1.position.set(-1.9, 4.6, .5); scene.add(torch1);
    const torch2 = new THREE.PointLight(0xff7722, 2.1, 9); torch2.position.set(1.9, 4.6, .5); scene.add(torch2);

    // Fireflies
    const ffN = 65;
    const ffPositions = new Float32Array(ffN * 3);
    const ffVels: { vx: number; vy: number; vz: number; ph: number }[] = [];
    for (let i = 0; i < ffN; i++) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 8;
      ffPositions[i * 3] = Math.cos(a) * r; ffPositions[i * 3 + 1] = .5 + Math.random() * 4.5; ffPositions[i * 3 + 2] = Math.sin(a) * r;
      ffVels.push({ vx: (Math.random() - .5) * .008, vy: (Math.random() - .5) * .004, vz: (Math.random() - .5) * .008, ph: Math.random() * Math.PI * 2 });
    }
    const ffGeo = new THREE.BufferGeometry();
    ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPositions, 3));
    const ffMat = new THREE.PointsMaterial({ color: 0xaaff44, size: .13, sizeAttenuation: true, transparent: true, opacity: .85 });
    const ffPoints = new THREE.Points(ffGeo, ffMat);
    scene.add(ffPoints);

    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      bucketGrp.position.y = 3.1 + Math.sin(t * .7) * .09;
      bucketGrp.rotation.z = Math.sin(t * .5) * .05;

      if (waterMesh.material instanceof THREE.MeshStandardMaterial && waterMesh.material.normalMap) {
        waterMesh.material.normalMap.offset.x = t * .038;
        waterMesh.material.normalMap.offset.y = t * .028;
      }
      waterLight.intensity = 3.4 + Math.sin(t * 1.35) * .9;
      torch1.intensity = 2.2 + Math.sin(t * 7.1 + .4) * .6 + Math.random() * .25;
      torch2.intensity = 1.9 + Math.sin(t * 5.8 + 1.1) * .5 + Math.random() * .25;

      camera.position.x = Math.sin(t * .09) * .35;
      camera.position.y = 3.4 + Math.sin(t * .12) * .14;
      camera.lookAt(0, .6, 0);
      wellGrp.rotation.y = Math.sin(t * .1) * .018;

      const pos = ffGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < ffN; i++) {
        const v = ffVels[i];
        pos[i * 3] += v.vx + Math.sin(t * .4 + v.ph) * .005;
        pos[i * 3 + 1] += v.vy + Math.sin(t * .6 + v.ph + 1) * .003;
        pos[i * 3 + 2] += v.vz + Math.cos(t * .5 + v.ph) * .005;
        if (Math.sqrt(pos[i * 3] ** 2 + pos[i * 3 + 2] ** 2) > 11 || pos[i * 3 + 1] < .3 || pos[i * 3 + 1] > 5.5) {
          const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 6;
          pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = .5 + Math.random() * 3.5; pos[i * 3 + 2] = Math.sin(a) * r;
        }
      }
      ffGeo.attributes.position.needsUpdate = true;
      ffMat.opacity = .45 + Math.sin(t * 2.1) * .38;

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      camera.aspect = container.offsetWidth / container.offsetHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.offsetWidth, container.offsetHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div id="intro" className="relative w-full h-[calc(100vh-48px)] min-h-[560px] overflow-hidden cursor-pointer select-none" onClick={onPlunge}>
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />
      <div className="intro-overlay absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none p-8">
        <div className="intro-title text-center">
          <h1 className="font-cinzel-decorative text-[clamp(1.7rem,5.5vw,3.4rem)] text-[#f5c842] tracking-widest leading-tight mb-2">
            Bitcoin<br />Wishing Well
          </h1>
          <p className="font-lora italic text-[clamp(0.8rem,2.2vw,1.05rem)] text-[#a08050] tracking-wider">
            Inscribe your wish forever on the eternal ledger
          </p>
        </div>
        <div className="intro-badge inline-flex items-center gap-2 bg-[rgba(245,200,66,0.07)] border border-[rgba(245,200,66,0.22)] rounded-full px-5 py-2 font-cinzel text-[0.68rem] text-[#c9a040] tracking-widest uppercase mt-6 mb-10">
          ⊕ Bitcoin Mainnet · Ordinals Protocol
        </div>
      </div>
      <div className="tap-hint absolute bottom-[6%] left-1/2 -translate-x-1/2 font-cinzel text-[0.68rem] text-[#8a6a30] tracking-[0.25em] uppercase z-20 pointer-events-none animate-[hp_2.2s_ease-in-out_infinite]">
        ↓ tap to descend ↓
      </div>
    </div>
  );
};
