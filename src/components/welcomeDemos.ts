import type { WelcomeDemo } from './WelcomePage';

/** Featured on the Welcome page; ids are Demos-menu ids. */
const WELCOME_DEMOS: readonly WelcomeDemo[] = [
  { id: 'piano', title: 'Piano', blurb: 'A physically modelled grand — play it with your keyboard.' },
  { id: 'violinSolo', title: 'Violin', blurb: 'Lament and Flight — a bowed-string solo on a score.' },
  { id: 'guitarSolo', title: 'Guitar', blurb: 'Back Porch Run — a country flatpick.' },
  { id: 'fluteSolo', title: 'Flute', blurb: 'Reed at Dusk — a breath-driven pipe.' },
  { id: 'curveOrchestra', title: 'Curve Orchestra', blurb: 'Timeline curves conducting a small band.' },
  { id: 'starryNight', title: 'Starry Night', blurb: 'A deep-space ambient score.' },
];

export { WELCOME_DEMOS };
