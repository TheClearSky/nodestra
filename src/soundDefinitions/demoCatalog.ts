import { instrumentDemoCategory } from './instrumentDemos';
import type { DemoCategory } from './demoMenu';

/**
 * The curated demo catalogue behind the toolbar's "Demos" menu.
 *
 * Loading one is a deliberate act, like Import — the demo BECOMES the project
 * and keeps autosaving (`__probe` stays the persistence-suppressed debug path).
 *
 * Lives here rather than in `App.tsx` so the tree can be unit-tested without
 * importing the React app (and its audio side-effects).
 */
const demoCategories = [
  {
    label: 'Orchestras',
    options: [
      {
        id: 'curveOrchestra',
        label: 'Curve Orchestra — timeline score (Run, then ▶)',
      },
      {
        id: 'pianoFluteOrchestra',
        label: 'Piano & Flute — pastoral duet (Run, then ▶)',
      },
      { id: 'bellClub', label: 'Bell Club — club-pop score (Run, then ▶)' },
      {
        id: 'neonDrop',
        label: 'Neon Drop — EDM score (Run, then ▶)',
      },
      {
        id: 'filterRush',
        label: 'Filter Rush — EQ-play score (Run, then ▶)',
      },
      {
        id: 'starryNight',
        label: 'Starry Night — deep-space score (Run, then ▶)',
      },
    ],
  },
  {
    label: 'Playable instruments',
    options: [
      { id: 'synthwave', label: 'Synthwave lead' },
      { id: 'darkSynthwave', label: 'Dark synthwave' },
      { id: 'hollowBloom', label: 'Hollow Bloom' },
      {
        id: 'solinaEnsemble',
        label: 'Solina Ensemble (polyphonic — hold a chord)',
      },
      { id: 'strings', label: 'Solina strings (mono)' },
      { id: 'flute', label: 'Flute' },
      { id: 'harpsichord', label: 'Harpsichord' },
      { id: 'tabla', label: 'Tabla (press keys)' },
      { id: 'harmonium', label: 'Harmonium' },
      // The ids stay `dreamyPad` / `dreamyPadA` even though the labels no
      // longer say A: a demo id is what a saved project stores, so renaming
      // one silently breaks every project that loaded it.
      {
        id: 'dreamyPad',
        label: 'Dreamy Pad — no sub bass (hold a key, F is the fitted register)',
      },
      {
        id: 'dreamyPadA',
        label: 'Dreamy Pad — with sub bass (hold an A)',
      },
      // The subtractive "Piano" was retired 2026-09-20 and REPLACED on
      // 2026-09-21 by the physically modelled struck string below. The old one
      // was three detuned saws + a drawn spectrum under ONE ADSR, which cannot
      // sound like a piano for structural reasons: real partials are
      // inharmonically stretched, each decays at its own rate, and the unison
      // group produces a two-stage decay. A fixed spectrum under a single
      // envelope has none of those, and velocity could only change level.
      { id: 'piano', label: 'Piano — struck string (hold a key)' },
      // The two landing-scene instruments (2026-10-04), playable here too.
      { id: 'guitarKeys', label: 'Guitar — plucked steel string (press keys)' },
      { id: 'starryPadKeys', label: 'Starry Pad (hold a key)' },
      // The old Karplus-Strong guitar and sawtooth violin were retired
      // 2026-09-07: the physically modelled Guitar and Violin in the
      // Instrument library replace them.
    ],
  },
  {
    label: 'Sound effects',
    options: [
      { id: 'sfxWetBlast', label: 'Wet blast (press a key)' },
      { id: 'sfxRiser', label: 'Riser (loops)' },
      { id: 'sfxWind', label: 'Wind storm' },
      { id: 'sfxHeartbeat', label: 'Heartbeat (clinical)' },
      { id: 'sfxHeartbeatCinematic', label: 'Heartbeat — cinematic' },
      { id: 'sfxHeartbeatDeep', label: 'Heartbeat — deep (loud, sub bass)' },
      { id: 'sfxAlarm', label: 'Alarm' },
      { id: 'sfxHeal', label: 'Magic — heal (press a key)' },
      { id: 'sfxLightning', label: 'Magic — lightning (press a key)' },
      { id: 'sfxTimeWarp', label: 'Magic — time warp (press a key)' },
      { id: 'sfxIce', label: 'Magic — ice (press a key)' },
      { id: 'sfxFire', label: 'Magic — fire (hold a key)' },
      { id: 'sfxNature', label: 'Magic — nature (hold a key)' },
      { id: 'sfxBubbleWater', label: 'Magic — bubble/water (press a key)' },
    ],
  },
  {
    label: 'Solos',
    options: [
      {
        id: 'guitarSolo',
        label: 'Guitar — Back Porch Run, country flatpick (Run, then ▶)',
      },
      { id: 'violinSolo', label: 'Violin — Lament and Flight (Run, then ▶)' },
      {
        id: 'violinCaprice',
        label: 'Violin — Firebrand Caprice, virtuosic (Run, then ▶)',
      },
      { id: 'fluteSolo', label: 'Flute — Reed at Dusk (Run, then ▶)' },
      { id: 'padSolo', label: 'Starry Pad — Starfield (Run, then ▶)' },
      {
        id: 'vampireSoloExtended',
        label: 'Vampire Synth — Nosferatu (Run, then ▶)',
      },
    ],
  },
  {
    label: 'Easy Effects',
    options: [
      {
        id: 'fxKeys',
        label: 'Crunch → Echo → Big Space (Run, then play a s d f…)',
      },
      { id: 'fxRhythm', label: 'Wobble → Stutter → Big Space (Run)' },
    ],
  },
  {
    label: 'Background sounds',
    options: [
      { id: 'droneAbyss', label: 'Drone — Abyss' },
      { id: 'droneVoid', label: 'Drone — Void' },
      { id: 'droneDread', label: 'Drone — Dread choir' },
    ],
  },
  {
    label: 'Tutorial',
    options: [{ id: 'starter', label: 'Starter (drawn sine)' }],
  },
] as const satisfies readonly DemoCategory[];

/** Curated categories + the generated per-instrument demos (one per instrument/kit). */
const allDemoCategories: readonly DemoCategory[] = [
  ...demoCategories,
  instrumentDemoCategory,
];

export { demoCategories, allDemoCategories };
