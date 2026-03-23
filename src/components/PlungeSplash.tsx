import React, { useEffect, useRef, useState } from 'react';

interface PlungeSplashProps {
  onComplete: () => void;
}

export const PlungeSplash: React.FC<PlungeSplashProps> = ({ onComplete }) => {
  const [stage, setStage] = useState<'plunge' | 'splash'>('plunge');
  const plungeCanvasRef = useRef<HTMLCanvasElement>(null);
  const splashCanvasRef = useRef<HTMLCanvasElement>(null);
  const opacityRef = useRef(1);

  useEffect(() => {
    if (stage === 'plunge') {
      const canvas = plungeCanvasRef.current!;
      const ctx = canvas.getContext('2d')!;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      let pT = 0;
      const animate = () => {
        pT += 0.017;
        const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2, p = Math.min(1, pT);
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = `hsl(26,12%,${Math.max(0, 7 - p * 7)}%)`;
        ctx.fillRect(0, 0, W, H);

        for (let i = 0; i < 24; i++) {
          const d = ((i / 24) + p * .9) % 1, e = Math.pow(d, 1.5), rx = e * W * .73, ry = rx * .42;
          const al = d * (1 - d * d) * 3.0, lit = 5 + d * 25, hue = 20 + i * 2;
          ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${hue},24%,${lit}%,${Math.min(1, al * .7)})`; ctx.lineWidth = Math.max(.5, d * 6.5); ctx.stroke();
        }

        const wp = Math.pow(p, 2.2), wg = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * .38);
        wg.addColorStop(0, `rgba(24,104,185,${wp * .82})`); wg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = wg; ctx.fillRect(0, 0, W, H);

        const bA = Math.max(0, p * 2.2 - .6);
        if (bA > 0) {
          ctx.save(); ctx.translate(cx, cy); ctx.scale(Math.pow(p, .4) * 1.2, Math.pow(p, .4) * 1.2);
          ctx.fillStyle = `rgba(245,200,66,${bA})`; ctx.font = `bold ${W * .1}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('₿', 0, 0); ctx.restore();
        }

        const v = ctx.createRadialGradient(cx, cy, W * .1, cx, cy, W * .8);
        v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${.65 + p * .26})`);
        ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);

        if (pT < 1.06) {
          requestAnimationFrame(animate);
        } else {
          setStage('splash');
        }
      };
      animate();
    } else {
      const canvas = splashCanvasRef.current!;
      const ctx = canvas.getContext('2d')!;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      let sT = 0;
      const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
      const drops: any[] = [];
      const ripples: any[] = [];
      for (let i = 0; i < 80; i++) {
        const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 8;
        drops.push({ x: cx, y: cy, vx: Math.cos(a) * sp * (1 + Math.random()), vy: Math.sin(a) * sp * .45 - 3.5 - Math.random() * 5, r: .8 + Math.random() * 3, life: 1, decay: .009 + Math.random() * .015, g: .14 });
      }
      for (let i = 0; i < 7; i++) ripples.push({ r: 3 + i * 9, cx, cy: cy + H * .08, life: 1, decay: .016 - i * .002 });

      const animate = () => {
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = `rgba(2,8,22,${Math.max(0, 1 - sT * .034)})`; ctx.fillRect(0, 0, W, H);
        const wY = cy + H * .08, wG = ctx.createLinearGradient(0, wY - 30, 0, H);
        wG.addColorStop(0, `rgba(14,66,152,${Math.max(0, .7 - sT * .013)})`); wG.addColorStop(1, `rgba(4,18,56,${Math.max(0, .92 - sT * .01)})`);
        ctx.fillStyle = wG; ctx.beginPath(); ctx.moveTo(0, wY);
        for (let x = 0; x <= W; x += 8) ctx.lineTo(x, wY + Math.sin(x * .04 + sT * .28) * 6 * Math.max(0, 1 - sT * .03));
        ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();

        ripples.forEach(r => { r.r += 2.8 + r.r * .03; r.life -= r.decay; if (r.life > 0) { ctx.beginPath(); ctx.ellipse(r.cx, r.cy, r.r, r.r * .28, 0, 0, Math.PI * 2); ctx.strokeStyle = `rgba(78,162,255,${r.life * .5})`; ctx.lineWidth = 1.8; ctx.stroke(); } });
        drops.forEach(d => { d.x += d.vx; d.y += d.vy; d.vy += d.g; d.life -= d.decay; if (d.life > 0) { ctx.beginPath(); ctx.ellipse(d.x, d.y, d.r, d.r * .55, Math.atan2(d.vy, d.vx), 0, Math.PI * 2); ctx.fillStyle = `rgba(78,162,255,${d.life * .65})`; ctx.fill(); } });

        const bE = Math.max(0, Math.min(1, (sT - 24) / 22));
        if (bE > 0) { ctx.fillStyle = `rgba(245,200,66,${bE})`; ctx.font = `bold ${W * .13}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('₿', cx, cy); }

        sT++;
        if (sT < 98) {
          requestAnimationFrame(animate);
        } else {
          const fadeOut = () => {
            opacityRef.current -= 0.05;
            if (opacityRef.current > 0) {
              if (splashCanvasRef.current) splashCanvasRef.current.parentElement!.style.opacity = String(opacityRef.current);
              requestAnimationFrame(fadeOut);
            } else {
              onComplete();
            }
          };
          fadeOut();
        }
      };
      animate();
    }
  }, [stage, onComplete]);

  return (
    <div className="fixed inset-0 z-[10000] bg-black">
      {stage === 'plunge' && <canvas ref={plungeCanvasRef} className="absolute inset-0 w-full h-full" />}
      {stage === 'splash' && <canvas ref={splashCanvasRef} className="absolute inset-0 w-full h-full" />}
    </div>
  );
};
