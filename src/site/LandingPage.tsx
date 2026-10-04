import { useEffect, useRef, useState } from 'react';
import { createStageScene } from '../landing/stageScene';
import { UiShot } from './UiShot';
import {
  FEATURES,
  GOLD,
  OpenAppButton,
  SCREENS,
  SHOTS,
  SiteFooter,
  SiteNav,
  SUBLINE,
  TAGLINE,
  usePageTitle,
  useReducedMotion,
} from './shared';
import { TourPlayer } from './TourPlayer';
import { CurtainCTA, EmberCard, Embers, ImpactFilters, Proscenium, STAGE_CSS } from './stageEffects';
import '../index.css';

/*
 * The landing page at `/`. Chosen by Deepak from the landing variants
 * (2026-10-01, "ok great, pick 5 as final"), with his changes: "hero needs to
 * allow page scroll, make a button on the middle clicking on which it signals
 * you can rotate the scene, otherwise rotate and pan the scene on your own,
 * other places you can just scroll. and the glitch effect should play
 * everytime i scroll down, not just first time. also reduce number of red
 * particles on hero. … remove spotlight and add a rim light around the edges
 * of the card that is a little yellow and premium, make cards shiny and
 * smooth edged, like thin 3d playing cards."
 */

const IMPACT = ['url(#zN1)', 'url(#zN1)', 'url(#zN2)', 'url(#zN2)', 'url(#zN1)', 'url(#zN3)', 'url(#zN3)', 'url(#zMelt)', ''];

/** The Re:Zero impact EVERY time the section is entered while scrolling down. */
function useImpactOnScrollDown(ref: React.RefObject<HTMLElement | null>, reduced: boolean) {
  useEffect(() => {
    const el = ref.current; if (!el || reduced) return undefined;
    let timers: number[] = [];
    let playing = false;
    const play = () => {
      if (playing) return;
      playing = true;
      el.dataset.glitching = '';
      IMPACT.forEach((f, i) => timers.push(window.setTimeout(() => {
        el.style.filter = f;
        if (i === IMPACT.length - 1) { playing = false; delete el.dataset.glitching; }
      }, i * 33)));
    };
    // Fires when the section's top crosses 70 % of the viewport. Entering from
    // below (its top is still below that line) means the visitor scrolled DOWN.
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && e.boundingClientRect.top > 0) play();
    }, { rootMargin: '0px 0px -30% 0px' });
    io.observe(el);
    return () => { io.disconnect(); timers.forEach(clearTimeout); timers = []; el.style.filter = ''; };
  }, [ref, reduced]);
}

function ImpactSection({ children, reduced, ...rest }: React.HTMLAttributes<HTMLElement> & { reduced: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useImpactOnScrollDown(ref, reduced);
  return (
    <section {...rest}>
      <div ref={ref}>{children}</div>
    </section>
  );
}

function StageHero({ reduced }: { reduced: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLElement>(null);
  const [steering, setSteering] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current, box = boxRef.current; if (!canvas || !box) return undefined;
    // idleMotion 3: while nobody steers, the stage turns and pans on its own.
    const stage = createStageScene(canvas, { reducedMotion: reduced, idleMotion: 3 });
    const ro = new ResizeObserver(([e]) => stage.resize(e.contentRect.width, e.contentRect.height));
    ro.observe(box);
    return () => { ro.disconnect(); stage.dispose(); };
  }, [reduced]);

  // Steering ends with Escape, or as soon as the hero scrolls out of view.
  useEffect(() => {
    if (!steering) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSteering(false); };
    const io = new IntersectionObserver(([e]) => { if (e.intersectionRatio < 0.5) setSteering(false); }, { threshold: [0.5] });
    if (boxRef.current) io.observe(boxRef.current);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); io.disconnect(); };
  }, [steering]);

  return (
    <section ref={boxRef} id='top' aria-labelledby='hero-title' className='relative h-[100vh] min-h-[620px] overflow-hidden bg-black'>
      {/* Until "Rotate the stage" is pressed, the canvas takes no input: the wheel and touch scroll the PAGE. */}
      <canvas ref={canvasRef} className={`absolute inset-0 h-full w-full ${steering ? 'pointer-events-auto' : 'pointer-events-none'}`} aria-hidden='true' />
      <Embers reduced={reduced} density={30} />
      <div aria-hidden='true' className='pointer-events-none absolute inset-0' style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.75), transparent 35%, transparent 60%, rgba(0,0,0,0.85))', opacity: steering ? 0.35 : 1, transition: 'opacity .5s' }} />
      <div className='pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-4 px-4 pt-14 text-center transition-opacity duration-500' style={{ opacity: steering ? 0 : 1 }}>
        <p className='font-serif text-[13px] tracking-[0.45em] uppercase' style={{ color: GOLD }}>Nodestra</p>
        <h1 id='hero-title' className='max-w-3xl font-serif text-[32px] leading-[1.12] text-balance text-[#f4ead8] drop-shadow-[0_4px_24px_rgba(0,0,0,0.9)] sm:text-[52px]'>{TAGLINE}</h1>
      </div>

      {/* The steer button, in the middle of the stage. */}
      <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
        {!steering ? (
          <button
            type='button'
            onClick={() => setSteering(true)}
            className='group pointer-events-auto relative flex items-center gap-3 rounded-full border border-[#e9d3a8]/45 bg-black/40 px-6 py-3 text-[15px] text-[#f4ead8] backdrop-blur-md transition-colors hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9d3a8]'
          >
            <span aria-hidden='true' className='absolute inset-0 rounded-full border border-[#e9d3a8]/50 motion-safe:animate-[s5Ping_2.4s_ease-out_infinite]' />
            <svg width='22' height='22' viewBox='0 0 24 24' aria-hidden='true' className='motion-safe:animate-[s5Turn_3.2s_ease-in-out_infinite]'>
              <path d='M4 12a8 8 0 0 1 14-5.3' fill='none' stroke={GOLD} strokeWidth='1.8' strokeLinecap='round' />
              <path d='M18.5 3v4h-4' fill='none' stroke={GOLD} strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' />
              <path d='M20 12a8 8 0 0 1-14 5.3' fill='none' stroke={GOLD} strokeWidth='1.8' strokeLinecap='round' />
              <path d='M5.5 21v-4h4' fill='none' stroke={GOLD} strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' />
            </svg>
            Rotate the stage
          </button>
        ) : (
          <p role='status' className='pointer-events-none absolute top-[18%] rounded-full bg-black/45 px-4 py-2 text-[13px] text-[#e9d3a8] backdrop-blur-md'>
            Drag to turn · scroll or pinch to zoom
          </p>
        )}
      </div>

      <div className='pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-4 px-4 pb-12 text-center'>
        {steering ? (
          <button type='button' onClick={() => setSteering(false)} className='pointer-events-auto rounded-full border border-[#e9d3a8]/45 bg-black/50 px-6 py-3 text-[15px] text-[#f4ead8] backdrop-blur-md hover:bg-black/70'>
            Done — back to scrolling
          </button>
        ) : (
          <>
            <p className='max-w-xl text-[15px] text-[#d8c7a8]/85 text-pretty'>{SUBLINE}</p>
            <div className='pointer-events-auto flex flex-wrap items-center justify-center gap-3'>
              <OpenAppButton large />
              <a href='#tour' className='rounded-full border border-[#e9d3a8]/25 bg-black/30 px-6 py-4 text-[16px] text-[#e9d3a8] backdrop-blur-md transition-colors hover:bg-black/50'>Watch the tour</a>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** A screen as a thin, glossy 3D playing card with a warm gold rim light. */
function PlayingCard({ shot, index, reduced }: { shot: (typeof SCREENS)[number]; index: number; reduced: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const rest = `rotateX(7deg) rotateY(${(index % 3 - 1) * -5}deg)`;
  const onMove = (e: React.PointerEvent) => {
    const el = ref.current; if (!el || reduced) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.style.transform = `rotateX(${(0.5 - y) * 16}deg) rotateY(${(x - 0.5) * 18}deg) translateZ(26px)`;
    el.style.setProperty('--gx', `${x * 100}%`);
    el.style.setProperty('--gy', `${y * 100}%`);
    el.dataset.hot = '1';
  };
  const onLeave = () => { const el = ref.current; if (!el) return; el.style.transform = rest; delete el.dataset.hot; };
  return (
    <li className='[perspective:1100px]'>
      <div
        ref={ref}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        className='s5card relative rounded-[18px] p-[1.5px] transition-transform duration-300 ease-out'
        style={{ transform: rest, transformStyle: 'preserve-3d', animationDelay: `${index * -1.3}s` }}
      >
        <div className='relative overflow-hidden rounded-[16.5px] bg-[#0f0b09]'>
          <UiShot src={`${SHOTS}/${shot.file}.html`} title={shot.title} crop={shot.crop} />
          <p className='px-4 py-3 text-[14px] text-[#f4ead8]/90'>{shot.caption}</p>
          {/* gloss: a sheen that sweeps across, and follows the pointer on hover */}
          <span aria-hidden='true' className='s5sheen pointer-events-none absolute inset-0' style={{ animationDelay: `${index * 0.9}s` }} />
          <span aria-hidden='true' className='pointer-events-none absolute inset-0' style={{ background: 'radial-gradient(420px circle at var(--gx, 30%) var(--gy, 0%), rgba(255,240,210,0.16), transparent 55%)' }} />
          <span aria-hidden='true' className='pointer-events-none absolute inset-0 rounded-[16.5px]' style={{ boxShadow: 'inset 0 1px 0 rgba(255,244,220,0.35), inset 0 0 0 1px rgba(255,236,190,0.08)' }} />
        </div>
      </div>
    </li>
  );
}

const PAGE_CSS = `
${STAGE_CSS}
@keyframes s5Ping { from { transform: scale(1); opacity: .8 } to { transform: scale(1.35, 1.6); opacity: 0 } }
@keyframes s5Turn { 0%,100% { transform: rotate(-25deg) } 50% { transform: rotate(25deg) } }
/* The card: a thin gold-rimmed playing card — rim light, a sliver of edge thickness, a soft lift. */
.s5card {
  background: linear-gradient(135deg, rgba(255,240,205,0.95), rgba(201,151,63,0.45) 28%, rgba(255,232,180,0.22) 55%, rgba(214,170,90,0.75) 82%, rgba(255,240,205,0.9));
  box-shadow:
    0 0 0 1px rgba(255,224,160,0.18),
    0 0 22px rgba(255,206,130,0.22),
    0 0 60px rgba(255,190,110,0.10),
    0 1px 0 #8a6a2c, 0 2px 0 #5c4317, 0 3px 0 #3a2a0e,
    0 26px 50px rgba(0,0,0,0.65);
  animation: s5Float 7s ease-in-out infinite;
}
.s5card[data-hot] { animation: none; box-shadow:
    0 0 0 1px rgba(255,230,170,0.45),
    0 0 30px rgba(255,214,140,0.45),
    0 0 90px rgba(255,190,110,0.22),
    0 1px 0 #8a6a2c, 0 2px 0 #5c4317, 0 3px 0 #3a2a0e,
    0 40px 70px rgba(0,0,0,0.7); }
/* While the impact plays, the cards drop their big soft glows: the row jitter slices a glow into
   stripes and the edge pass then rings every card in red (Deepak: "too agressive on 5c"). */
[data-glitching] .s5card { box-shadow: 0 0 0 1px rgba(255,224,160,0.18), 0 1px 0 #8a6a2c, 0 2px 0 #5c4317 !important; }
@keyframes s5Float { 0%,100% { translate: 0 0 } 50% { translate: 0 -6px } }
.s5sheen {
  background: linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.13) 47%, rgba(255,248,230,0.05) 53%, transparent 62%);
  background-size: 260% 100%;
  animation: s5Sheen 6s ease-in-out infinite;
}
@keyframes s5Sheen { 0%,55% { background-position: 130% 0 } 85%,100% { background-position: -40% 0 } }
@media (prefers-reduced-motion: reduce) { .s5card, .s5sheen { animation: none } }
`;

function LandingPage() {
  usePageTitle('Nodestra — build instruments and songs from nodes');
  const reduced = useReducedMotion();
  return (
    <div className='min-h-full bg-[#0a0606] text-primary-white'>
      <style>{PAGE_CSS}</style>
      <ImpactFilters />
      <SiteNav className='border-b border-[#e9d3a8]/10 bg-black/55 backdrop-blur-md' />
      <main id='main'>
        <StageHero reduced={reduced} />
        <ImpactSection id='tour' reduced={reduced} className='relative mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6'>
          <Proscenium>
            <TourPlayer />
          </Proscenium>
        </ImpactSection>
        <ImpactSection aria-labelledby='screens-title' id='screens' reduced={reduced} className='relative scroll-mt-20 border-t border-[#e9d3a8]/10'>
          <div className='mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6'>
            <h2 id='screens-title' className='font-serif text-[30px] text-[#f4ead8] sm:text-[38px]'>What you see when you open it</h2>
            <ul className='grid gap-10 sm:grid-cols-2 lg:grid-cols-3'>
              {SCREENS.map((s, i) => <PlayingCard key={s.file} shot={s} index={i} reduced={reduced} />)}
            </ul>
          </div>
        </ImpactSection>
        <ImpactSection aria-labelledby='features-title' id='features' reduced={reduced} className='relative scroll-mt-20 border-t border-[#e9d3a8]/10'>
          <div className='mx-auto flex max-w-6xl flex-col gap-8 px-4 py-16 sm:px-6'>
            <h2 id='features-title' className='font-serif text-[30px] text-[#f4ead8] sm:text-[38px]'>Everything it does, in plain words</h2>
            <ul className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
              {FEATURES.map((f) => <EmberCard key={f.title} f={f} />)}
            </ul>
          </div>
        </ImpactSection>
        <CurtainCTA reduced={reduced} />
      </main>
      <SiteFooter />
    </div>
  );
}

export { LandingPage };
