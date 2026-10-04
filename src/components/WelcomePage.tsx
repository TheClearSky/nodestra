import type { ReactNode } from 'react';
import { KEY_ORDER, KEY_TO_SEMITONE } from '../audio/keyMap';
import { NodestraMark } from './NodestraMark';

/**
 * The Welcome page (ruling Q8-W1): a closable tab that a first visit opens
 * instead of any graph (Q7). Everything on it is an action — no reading
 * required to get to sound.
 *
 * Demo thumbnails are procedural: a small waveform drawn from a hash of the
 * demo id (no images ship, in keeping with "no asset files").
 */

type WelcomeDemo = { id: string; title: string; blurb: string };
type WelcomeTutorial = { id: string; title: string; minutes: number; done: boolean };

type WelcomePageProps = {
  recentFiles: readonly { id: string; name: string }[];
  demos: readonly WelcomeDemo[];
  /** Filled in by the tutorials phase (P3); the section hides while empty. */
  tutorials: readonly WelcomeTutorial[];
  canCreate: boolean;
  canLinkFolders: boolean;
  showOnStartup: boolean;
  onShowOnStartupChange(value: boolean): void;
  onNewGraph(): void;
  onImport(): void;
  onLinkFolder(): void;
  onOpenFile(id: string): void;
  onOpenDemo(id: string): void;
  onStartTutorial(id: string): void;
};

const WHITE_SEMITONES = new Set([0, 2, 4, 5, 7, 9, 11, 12, 14, 16]);
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** A deterministic little waveform per demo id. */
function WaveThumb({ seed }: { seed: string }) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  const random = () => {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507) >>> 0;
    return hash / 4294967296;
  };
  const partials = [1, 2 + Math.floor(random() * 3), 5 + Math.floor(random() * 4)].map((harmonic) => ({
    harmonic,
    amp: 0.2 + random() * 0.8,
    phase: random() * Math.PI * 2,
  }));
  const points: string[] = [];
  for (let x = 0; x <= 120; x += 2) {
    const t = (x / 120) * Math.PI * 2;
    const y = partials.reduce((sum, p) => sum + (p.amp / p.harmonic) * Math.sin(t * p.harmonic + p.phase), 0);
    points.push(`${x},${(20 - y * 11).toFixed(1)}`);
  }
  return (
    <svg viewBox='0 0 120 40' className='h-10 w-full' aria-hidden='true'>
      <polyline points={points.join(' ')} fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinejoin='round' />
    </svg>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className='flex flex-col gap-2'>
      <h2 className='text-[11px] font-semibold tracking-[0.12em] text-primary-light-gray uppercase'>{title}</h2>
      {children}
    </section>
  );
}

const ACTION =
  'flex w-full cursor-pointer items-center justify-between gap-4 rounded px-2 py-1.5 text-left text-[13px] text-primary-white hover:bg-primary-dark-gray disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent';

function WelcomePage(props: WelcomePageProps) {
  const whites = KEY_ORDER.filter((key) => WHITE_SEMITONES.has(KEY_TO_SEMITONE[key]));
  const blacks = KEY_ORDER.filter((key) => !WHITE_SEMITONES.has(KEY_TO_SEMITONE[key]));
  return (
    <div className='h-full overflow-y-auto bg-primary-black'>
      <div className='mx-auto flex max-w-[980px] flex-col gap-8 px-6 py-8'>
        <header>
          <h1 className='flex items-center gap-3 text-[26px] font-light text-primary-white'>
            <NodestraMark size={34} />
            Nodestra
          </h1>
          <p className='mt-1 text-[14px] text-primary-light-gray'>
            Build instruments and songs from nodes — and hear every change.
          </p>
        </header>

        <div className='grid gap-8 md:grid-cols-2'>
          <Section title='Start'>
            <button type='button' className={ACTION} disabled={!props.canCreate} onClick={props.onNewGraph}>
              <span>＋ New empty graph</span>
            </button>
            <button type='button' className={ACTION} onClick={() => props.onOpenDemo('piano')}>
              <span>🎹 Open the piano demo</span>
            </button>
            <button type='button' className={ACTION} disabled={!props.canCreate} onClick={props.onImport}>
              <span>⇪ Import a file…</span>
            </button>
            {props.canLinkFolders && (
              <button type='button' className={ACTION} onClick={props.onLinkFolder}>
                <span>🔗 Link a folder on this computer…</span>
              </button>
            )}
          </Section>

          <Section title='Recent'>
            {props.recentFiles.length === 0 ? (
              <p className='px-2 py-1.5 text-[13px] text-primary-light-gray'>
                Nothing yet — open a demo below to start.
              </p>
            ) : (
              props.recentFiles.map((file) => (
                <button key={file.id} type='button' className={ACTION} onClick={() => props.onOpenFile(file.id)}>
                  <span className='truncate'>{file.name}</span>
                </button>
              ))
            )}
          </Section>
        </div>

        <Section title='Demos'>
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6'>
            {props.demos.map((demo) => (
              <button
                key={demo.id}
                type='button'
                onClick={() => props.onOpenDemo(demo.id)}
                title={demo.blurb}
                className='flex cursor-pointer flex-col gap-1 rounded-md border border-secondary-dark-gray bg-secondary-black p-2 text-left text-[#b444d8] transition-colors hover:border-[#7b5cff] hover:bg-primary-dark-gray'
              >
                <WaveThumb seed={demo.id} />
                <span className='truncate text-[12px] font-semibold text-primary-white'>{demo.title}</span>
                <span className='line-clamp-2 text-[11px] text-primary-light-gray'>{demo.blurb}</span>
              </button>
            ))}
          </div>
          <p className='px-1 text-[12px] text-primary-light-gray'>More in the Demos menu at the top. A demo opens as a new file in your library.</p>
        </Section>

        {props.tutorials.length > 0 && (
          <Section title={`Learn · ${props.tutorials.filter((t) => t.done).length} of ${props.tutorials.length} done`}>
            {props.tutorials.map((tutorial) => (
              <button key={tutorial.id} type='button' className={ACTION} onClick={() => props.onStartTutorial(tutorial.id)}>
                <span>
                  {tutorial.done ? '✔ ' : '○ '}
                  {tutorial.title} <span className='text-primary-light-gray'>· ~{tutorial.minutes} min</span>
                </span>
                <span className='text-[12px] text-primary-blue'>{tutorial.done ? 'Replay' : 'Start'}</span>
              </button>
            ))}
          </Section>
        )}

        <Section title='Play right now'>
          <div className='flex flex-wrap items-center gap-6'>
            <div data-tour='welcome.keymap' className='relative h-[76px]' style={{ width: whites.length * 30 }} aria-hidden='true'>
              {whites.map((key, index) => (
                <div
                  key={key}
                  className='absolute top-0 flex h-[76px] items-end justify-center rounded-b border border-black/60 bg-[#efe9dc] pb-1 text-[11px] font-semibold text-black/60 uppercase'
                  style={{ left: index * 30, width: 28 }}
                >
                  {key}
                </div>
              ))}
              {blacks.map((key) => (
                <div
                  key={key}
                  className='absolute top-0 z-10 flex h-[46px] items-end justify-center rounded-b bg-[#141414] pb-0.5 text-[10px] font-semibold text-white/70 uppercase'
                  style={{
                    left: whites.filter((white) => KEY_TO_SEMITONE[white] < KEY_TO_SEMITONE[key]).length * 30 - 9,
                    width: 18,
                  }}
                >
                  {key}
                </div>
              ))}
            </div>
            <div className='max-w-[360px] text-[13px] text-primary-light-gray'>
              <p>
                Your keyboard is a piano: <strong className='text-primary-white'>A S D F G H J K L ;</strong> play{' '}
                {whites.map((key) => NOTE_NAMES[KEY_TO_SEMITONE[key] % 12]).join(' ')}; the row above plays the sharps.
                <strong className='text-primary-white'> , </strong>and<strong className='text-primary-white'> . </strong>
                shift the octave.
              </p>
              <button
                type='button'
                className='mt-2 cursor-pointer text-primary-blue hover:underline'
                onClick={() => props.onOpenDemo('piano')}
              >
                Open the piano to try it →
              </button>
            </div>
          </div>
        </Section>

        <Section title='Shortcuts'>
          <dl className='grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 px-2 text-[12px] text-primary-light-gray'>
            <dt className='text-primary-white'>Ctrl+S</dt>
            <dd>Save now</dd>
            <dt className='text-primary-white'>Alt+W</dt>
            <dd>Close tab</dd>
            <dt className='text-primary-white'>Alt+Shift+T</dt>
            <dd>Reopen closed tab</dd>
            <dt className='text-primary-white'>Alt+PageUp / PageDown</dt>
            <dd>Previous / next tab</dd>
            <dt className='text-primary-white'>Esc</dt>
            <dd>Silence everything</dd>
          </dl>
        </Section>

        <label className='flex cursor-pointer items-center gap-2 border-t border-secondary-dark-gray pt-4 text-[12px] text-primary-light-gray'>
          <input
            type='checkbox'
            checked={props.showOnStartup}
            onChange={(event) => props.onShowOnStartupChange(event.target.checked)}
          />
          Show Welcome when nothing else is open at startup
        </label>
      </div>
    </div>
  );
}

export { WelcomePage };
export type { WelcomeDemo, WelcomeTutorial };
