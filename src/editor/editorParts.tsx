import type { GraphBottomDrawer, InputComponentRegistry } from '@theclearsky/react-blender-nodes';
import { CurveTimeline, TimelineCurvePicker } from '@theclearsky/react-blender-nodes-timeline';
import { SignalBaseInput } from '../components/SignalBaseInput';
import { WaveformDrawInput } from '../components/WaveformDrawInput';

/*
 * The editor's parts, shared by the app (`App.tsx`) and the landing page's
 * live showcases (`src/showcase/`), so a showcase IS the app's editor — same
 * inputs, same timeline drawer — never a look-alike.
 */

// The curve timeline as a host BOTTOM DRAWER: the runner panel's chrome, a
// floating button beside the Runner's, and the host guarantees only one of the
// two is open at a time (user ruling 2026-09-18, superseding the timeline
// plan's Q-TL-6 dual dock). Module-level so the array identity is stable —
// the drawer chrome re-renders when it changes (host guidance). It renders
// inside FullGraph, which sits under <TimelineProvider>, so the timeline still
// finds its store and transport.
const bottomDrawers: GraphBottomDrawer[] = [
  {
    id: 'curveTimeline',
    label: 'Timeline',
    title: 'Open the curve timeline',
    // Toolbar + ruler + two full lanes; the runner's 220 shows ~1.4 lanes.
    // The user can still drag the handle (80–600).
    defaultHeight: 320,
    // keepMounted defaults to true: zoom, scroll and selection survive a
    // switch to the Runner and back, exactly as they did in the old dock.
    icon: (
      <svg
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
        aria-hidden='true'
      >
        <path d='M2 12h3l3-8 4 16 3-8h3' />
      </svg>
    ),
    // Fit the plugin's panel to the drawer. `overflow-visible` is
    // load-bearing: the timeline's transport toolbar is `sticky`, and while
    // the timeline clips its own overflow IT becomes the sticky container — one
    // that never scrolls — so ▶ would scroll away with the lanes. Letting
    // overflow through makes the drawer's scroll box the container. `min-h-full`
    // fills the drawer body so a one-lane document shows no seam, and the inset
    // ring restores the keyboard-focus cue the removed border used to give.
    content: (
      <CurveTimeline className='min-h-full overflow-visible rounded-none border-none focus-visible:shadow-[inset_0_0_0_1px_var(--color-secondary-light-gray)]' />
    ),
  },
];

// Module-level registries — an inline literal would remount the components
// every App render (host guidance).
const inputComponents: InputComponentRegistry = {
  signal: SignalBaseInput,
  waveform: WaveformDrawInput,
  // Needs <TimelineProvider> above the graph. The plugin's picker is built on
  // the host's `Select`, so it is the same widget as a node's enum input.
  curveRef: TimelineCurvePicker,
};

export { bottomDrawers, inputComponents };
