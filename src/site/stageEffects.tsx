import { useEffect, useRef, useState } from 'react';
import { FEATURES, GOLD, OpenAppButton } from './shared';

/*
 * The landing page's stage pieces: embers rising over the hero (the NOX LUX
 * research: 3 → 90 in half a second, red 80 % / magenta 15 % / orange 5 %,
 * soft additive discs), the Re:Zero impact frame as SVG filters, the gilded
 * proscenium round the tour, smouldering feature cards, and red velvet
 * curtains that part on the last call to action.
 */

const EMBER_COLS = ['#BC2231', '#BC2231', '#BC2231', '#BC2231', '#BC2231', '#BC2231', '#BC2231', '#BC2231', '#B91871', '#B91871', '#B91871', '#CA4928'];

function Embers({ reduced, density = 90 }: { reduced: boolean; density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv || reduced) return undefined;
    const g = cv.getContext('2d')!;
    let w = 0, h = 0, raf = 0;
    const ro = new ResizeObserver(([e]) => { w = e.contentRect.width; h = e.contentRect.height; cv.width = w; cv.height = h; });
    ro.observe(cv);
    const sprites = EMBER_COLS.map((col) => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const sg = c.getContext('2d')!; const gr = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, col); gr.addColorStop(0.3, col + 'f2'); gr.addColorStop(0.55, col + '80'); gr.addColorStop(1, col + '00');
      sg.fillStyle = gr; sg.fillRect(0, 0, 64, 64); return c;
    });
    const P = Array.from({ length: density }, () => ({ x: 0, y: 0, z: 0, s: 0, ph: 0, born: -1 }));
    const spawn = (p: (typeof P)[number], t: number) => { p.x = Math.random() * w; p.y = h * (0.5 + Math.random() * 0.6); p.z = Math.random(); p.s = Math.floor(Math.random() * sprites.length); p.ph = Math.random() * 6.28; p.born = t; };
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      g.clearRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      const live = Math.min(density, 3 + Math.floor(t / 0.5 * 87));
      P.forEach((p, i) => {
        if (i >= live) return;
        if (p.born < 0 || p.y < -40) spawn(p, t);
        const vy = (6.5 + 4.5 * p.z) * 24 * 0.016, vx = (1.1 + 0.012 * (p.x - w / 2) * 0.1) * 0.4;
        p.y -= vy; p.x += vx + Math.sin(t * 1.3 + p.ph) * 0.4;
        const r = (8 + p.z * 20) * 0.8, a = Math.min(1, (t - p.born) * 2) * (0.35 + 0.65 * p.z) * Math.min(1, (p.y + 40) / (h * 0.3));
        g.globalAlpha = Math.max(0, a);
        g.drawImage(sprites[p.s], p.x - r, p.y - r, r * 2, r * 2);
      });
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [reduced, density]);
  return <canvas ref={ref} className='pointer-events-none absolute inset-0 h-full w-full' aria-hidden='true' />;
}

/**
 * The Re:Zero impact as SVG filters (8 frames on twos: dark tinted negative,
 * crimson edges, row jitter, melt), in its toned-down form — Deepak:
 * "glitch effects looks too agressive on 5c … tone it down". The measured
 * negative turned the app's dark UI into a bright light-mauve flash, so it is
 * scaled toward the research's deep blue (#1B1C61-ish — dark UI → dark navy,
 * not lavender); the crimson edge gain is 0.7 with a threshold so only crisp
 * outlines turn red (dense UI text, the gold card rims and the cards' smooth
 * glows lit up red everywhere at full gain); row jitter / melt are halved.
 */
function ImpactFilters() {
  const neg = '-0.205 0 0 0 0.26  0 -0.141 0 0 0.158  0 0 -0.205 0 0.32  0 0 0 1 0';
  const f = (id: string, scale: number, freq: string) => (
    <filter id={id} x='-5%' y='-5%' width='110%' height='110%' colorInterpolationFilters='sRGB'>
      <feTurbulence type='fractalNoise' baseFrequency={freq} numOctaves='1' seed={id.length} result='n' />
      <feDisplacementMap in='SourceGraphic' in2='n' scale={scale * 0.5} xChannelSelector='R' yChannelSelector='A' result='d' />
      <feColorMatrix in='d' type='matrix' values={neg} result='neg' />
      <feConvolveMatrix in='d' order='3' kernelMatrix='-1 -1 -1 -1 8 -1 -1 -1 -1' result='edge' />
      <feColorMatrix in='edge' type='matrix' values='0 0 0 0 0.91  0 0 0 0 0.2  0 0 0 0 0.35  0.7 0.7 0.7 0 -0.22' result='red' />
      <feMerge><feMergeNode in='neg' /><feMergeNode in='red' /></feMerge>
    </filter>
  );
  return (
    <svg width='0' height='0' className='absolute' aria-hidden='true'>
      <defs>
        {f('zN1', 10, '0.0008 0.32')}
        {f('zN2', 26, '0.0006 0.18')}
        {f('zN3', 16, '0.001 0.28')}
        {f('zMelt', 60, '0.0004 0.013')}
      </defs>
    </svg>
  );
}

function Proscenium({ children }: { children: React.ReactNode }) {
  return (
    <div className='relative rounded-[18px] p-[10px]' style={{ background: 'linear-gradient(180deg,#8a6a2c,#3d2a10 40%,#6b4d1c)', boxShadow: '0 0 0 1px rgba(233,211,168,0.35), 0 40px 120px rgba(0,0,0,0.7)' }}>
      <svg className='absolute -top-[30px] left-1/2 -translate-x-1/2' width='260' height='44' viewBox='0 0 260 44' aria-hidden='true'>
        <path d='M0 44 C40 44 60 6 130 6 C200 6 220 44 260 44 Z' fill='#5a3f16' stroke={GOLD} strokeOpacity='.5' />
        <circle cx='130' cy='22' r='9' fill='none' stroke={GOLD} strokeWidth='2' />
        <path d='M100 30 Q115 20 121 22 M160 30 Q145 20 139 22' stroke={GOLD} strokeWidth='1.5' fill='none' />
      </svg>
      <div className='overflow-hidden rounded-[10px] bg-black'>{children}</div>
    </div>
  );
}

function EmberCard({ f }: { f: (typeof FEATURES)[number] }) {
  return (
    <li className='group relative overflow-hidden rounded-xl p-[1.5px]' style={{ background: 'linear-gradient(140deg, rgba(233,211,168,0.18), rgba(255,255,255,0.04))' }}>
      <span aria-hidden='true' className='absolute inset-[-40%] opacity-0 transition-opacity duration-500 group-hover:opacity-100' style={{ background: 'conic-gradient(from 0deg, #BC2231, #CA4928, #f3cf8a, #B91871, #BC2231)', animation: 'eSpin 3s linear infinite' }} />
      <div className='relative flex h-full flex-col gap-2 rounded-[11px] bg-[#140c0b] p-5'>
        <h3 className='font-serif text-[18px]' style={{ color: '#f4ead8' }}>{f.title}</h3>
        <p className='text-[14px] leading-relaxed text-[#d8c7a8]/80'>{f.text}</p>
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} aria-hidden='true' className='pointer-events-none absolute bottom-0 h-2 w-2 rounded-full opacity-0 group-hover:[animation:eRise_1.8s_ease-out_infinite]' style={{ left: `${10 + i * 13}%`, background: EMBER_COLS[i * 2 % EMBER_COLS.length], boxShadow: `0 0 10px ${EMBER_COLS[i * 2 % EMBER_COLS.length]}`, animationDelay: `${i * 0.23}s` }} />
        ))}
      </div>
    </li>
  );
}

function CurtainCTA({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [k, setK] = useState(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return undefined;
    let raf = 0;
    const update = () => { raf = 0; const el = ref.current; if (!el) return; const r = el.getBoundingClientRect(); setK(Math.min(1, Math.max(0, (window.innerHeight - r.top) / (r.height * 0.9)))); };
    const on = () => { if (!raf) raf = requestAnimationFrame(update); };
    update(); window.addEventListener('scroll', on, { passive: true });
    return () => { window.removeEventListener('scroll', on); cancelAnimationFrame(raf); };
  }, [reduced]);
  const e = k * k * (3 - 2 * k);
  const curtain = (side: 'l' | 'r') => (
    <svg viewBox='0 0 400 600' preserveAspectRatio='none' className='absolute top-0 h-full w-[52%]' aria-hidden='true'
      style={{ [side === 'l' ? 'left' : 'right']: 0, transform: `translateX(${(side === 'l' ? -1 : 1) * e * 92}%) scaleX(${1 - e * 0.35})`, transformOrigin: side === 'l' ? 'left' : 'right' }}>
      <defs>
        <linearGradient id={`fold${side}`} x1='0' x2='1'>
          {Array.from({ length: 9 }, (_, i) => <stop key={i} offset={i / 8} stopColor={i % 2 ? '#3a0508' : '#a11522'} />)}
        </linearGradient>
        <linearGradient id={`shade${side}`} x1='0' y1='0' x2='0' y2='1'><stop offset='0' stopColor='#000' stopOpacity='.45' /><stop offset='.3' stopColor='#000' stopOpacity='0' /><stop offset='1' stopColor='#000' stopOpacity='.5' /></linearGradient>
      </defs>
      <path d={side === 'l' ? 'M0 0 H400 C380 200 410 420 360 600 H0 Z' : 'M0 0 H400 V600 H40 C-10 420 20 200 0 0 Z'} fill={`url(#fold${side})`} />
      <path d={side === 'l' ? 'M0 0 H400 C380 200 410 420 360 600 H0 Z' : 'M0 0 H400 V600 H40 C-10 420 20 200 0 0 Z'} fill={`url(#shade${side})`} />
      <path d='M0 2 H400' stroke='#c9973f' strokeWidth='6' />
    </svg>
  );
  return (
    <section ref={ref} aria-labelledby='open-source-title' id='open-source' className='relative scroll-mt-20 overflow-hidden border-t border-white/8 bg-black'>
      <div aria-hidden='true' className='pointer-events-none absolute inset-0' style={{ background: 'conic-gradient(from 180deg at 50% -10%, transparent 160deg, rgba(255,220,160,0.16) 175deg, rgba(255,220,160,0.24) 180deg, rgba(255,220,160,0.16) 185deg, transparent 200deg)' }} />
      <div className='relative mx-auto flex max-w-6xl flex-col items-center gap-5 px-4 py-28 text-center sm:px-6'>
        <h2 id='open-source-title' className='font-serif text-[32px] text-balance text-[#f4ead8] sm:text-[44px]'>The stage is lit.</h2>
        <p className='max-w-xl text-[16px] text-[#d8c7a8]/80 text-pretty'>Nodestra is open source under the AGPL-3.0 and runs entirely in your browser. Open it, press a key, and start wiring.</p>
        <OpenAppButton large />
      </div>
      {curtain('l')}
      {curtain('r')}
    </section>
  );
}

/** The keyframes the ember cards use. */
const STAGE_CSS = `
@keyframes eSpin { to { transform: rotate(360deg) } }
@keyframes eRise { 0% { opacity:0; transform: translateY(0) scale(.6) } 20% { opacity:1 } 100% { opacity:0; transform: translateY(-120px) scale(1.2) } }
`;

export { CurtainCTA, EmberCard, Embers, ImpactFilters, Proscenium, STAGE_CSS };
