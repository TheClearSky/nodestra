import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { NodestraMark } from '../components/NodestraMark';
import { GitHubLink } from './GitHubLink';
import { SCREENS } from './screens';

/*
 * What the landing page says, and its shared pieces. Every claim is on the
 * faithful feature list.
 */

const TAGLINE = 'Build instruments and songs from nodes — and hear every change.';
const SUBLINE = 'Wire up oscillators, physically modelled strings and ready-made effects. Every node is a real sound, and it plays as you build.';
const GOLD = '#e9d3a8';

/** Socket colours, as in the app (`src/soundDefinitions/dataTypes.ts`). */
const SOCKET = { audio: '#2ECC71', signal: '#F1C40F', number: '#3498DB', gate: '#E74C3C', wave: '#9B59B6' } as const;

const NAV: ReadonlyArray<{ href: string; label: string }> = [
  { href: '#tour', label: 'Tour' },
  { href: '#screens', label: 'Screens' },
  { href: '#features', label: 'Features' },
  { href: '#open-source', label: 'Open source' },
];

type Feature = { key: string; color: string; title: string; text: string };
const FEATURES: Feature[] = [
  { key: 'stage', color: GOLD, title: 'A stage you can play', text: 'A grand piano under a spotlight. Play it from your keyboard, or click and tap the keys — chords too; , and . shift the octave.' },
  { key: 'nodes', color: SOCKET.audio, title: 'Nodes are the sound', text: 'Each node is a real audio node. Wires carry audio, live signals, numbers and gates, and Auto-run plays every change as you make it.' },
  { key: 'physical', color: SOCKET.wave, title: 'Physically modelled instruments', text: 'A struck-string piano, a plucked guitar, a bowed violin, a breath-driven flute — and a library of drum kits, pads, synths and organ.' },
  { key: 'effects', color: '#E91E63', title: 'Easy Effects', text: 'Stutter, Chopper, Pump, Echo, Big Space, Lo-Fi Radio, Wobble and Crunch, with plain-word knobs. Open any of them to see how it works inside.' },
  { key: 'timeline', color: SOCKET.signal, title: 'Timeline curves', text: 'Draw curves that move any setting while it plays, with MIDI-style bar lanes, tempo, grid and snap.' },
  { key: 'grid', color: '#F39C12', title: 'Grid finder', text: 'Suggests tempos that fit your notes and shows how many land on the grid.' },
  { key: 'blip', color: '#8b5cf6', title: 'Blip, your guide', text: 'A small conductor walks you through the app step by step, spotlighting what to click — with a voice you can mute.' },
  { key: 'docs', color: SOCKET.number, title: 'Docs where you need them', text: 'Hover a node, a socket or a zone, and an ⓘ explains it in plain words.' },
  { key: 'library', color: SOCKET.gate, title: 'Your library', text: 'Graphs saved in your browser, in folders and tabs; link a folder on your computer, import and export, record to a file.' },
];

/** Into the app: always a FULL page load (see `routes.tsx`). `/app/`, with
 *  its slash: that is the page GitHub Pages serves (`/app` answers with a
 *  redirect to it). */
function OpenAppButton({ large = false, className = '' }: { large?: boolean; className?: string }) {
  return (
    <Link
      to='/app/'
      reloadDocument
      className={`inline-flex items-center gap-2 rounded-full border border-[#e9d3a8]/40 bg-white/8 font-medium text-primary-white shadow-[0_0_48px_rgba(255,190,110,0.22)] backdrop-blur-sm transition-colors hover:bg-white/16 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9d3a8] ${large ? 'px-8 py-4 text-[18px]' : 'px-5 py-2 text-[14px]'} ${className}`}
    >
      Open the app <span aria-hidden='true'>›</span>
    </Link>
  );
}

function SiteFooter() {
  return (
    <footer className='relative border-t border-white/8 bg-[#151515]'>
      <div className='mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6'>
        <div className='flex max-w-sm flex-col gap-2'>
          <span className='flex items-center gap-2 text-[16px] font-semibold'>
            <NodestraMark size={24} />
            Nodestra
          </span>
          <p className='text-[13px] text-primary-white/60'>{TAGLINE}</p>
        </div>
        <nav aria-label='Footer' className='grid grid-cols-2 gap-x-10 gap-y-2 text-[14px] text-primary-white/70'>
          <Link to='/app/' reloadDocument className='hover:text-primary-white'>
            Open the app
          </Link>
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className='hover:text-primary-white'>
              {item.label}
            </a>
          ))}
          <a href='https://github.com/TheClearSky/nodestra' target='_blank' rel='noreferrer' className='hover:text-primary-white'>
            Nodestra on GitHub ↗
          </a>
          <a href='https://github.com/TheClearSky/react-blender-nodes' target='_blank' rel='noreferrer' className='hover:text-primary-white'>
            Built on react-blender-nodes ↗
          </a>
        </nav>
      </div>
      <p className='border-t border-white/5 px-4 py-4 text-center text-[12px] text-primary-white/40'>Open source · AGPL-3.0 · Runs in your browser</p>
    </footer>
  );
}

/** The sticky top bar every page shares (variants may restyle it via `className`). */
function SiteNav({ className = 'border-b border-white/8 bg-primary-black/80 backdrop-blur-md' }: { className?: string }) {
  return (
    <header className={`sticky top-0 z-40 ${className}`}>
      <nav aria-label='Main' className='mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 sm:px-6'>
        <a href='#top' className='flex items-center gap-2.5 text-[17px] font-semibold'>
          <NodestraMark size={28} />
          Nodestra
        </a>
        <ul className='hidden flex-1 items-center gap-5 text-[14px] text-primary-white/70 md:flex'>
          {NAV.map((item) => (
            <li key={item.href}>
              <a href={item.href} className='transition-colors hover:text-primary-white'>
                {item.label}
              </a>
            </li>
          ))}
        </ul>
        <div className='ml-auto flex items-center gap-2.5 md:ml-0'>
          <GitHubLink className='grid h-9 w-9 place-items-center rounded-full border border-[#e9d3a8]/40 bg-white/8 text-primary-white backdrop-blur-sm transition-colors hover:bg-white/16 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9d3a8]' />
          <OpenAppButton />
        </div>
      </nav>
    </header>
  );
}

function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title;
    return () => {
      document.title = 'Nodestra';
    };
  }, [title]);
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

export {
  FEATURES,
  GOLD,
  OpenAppButton,
  SCREENS,
  SiteFooter,
  SiteNav,
  SUBLINE,
  TAGLINE,
  usePageTitle,
  useReducedMotion,
};
