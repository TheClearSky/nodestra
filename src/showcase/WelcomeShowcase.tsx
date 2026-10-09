import { useEffect, useRef } from 'react';
import { BlipOffer } from '../components/TutorialLayer';
import { WelcomePage } from '../components/WelcomePage';
import { WELCOME_DEMOS } from '../components/welcomeDemos';
import type { LiveComponentProps } from './LiveSlot';

const noop = () => {};

/**
 * The app's real Welcome page with Blip's first-run offer, live on the landing
 * page — the same components the app shows a first-time visitor, on demo data.
 * Nothing it offers navigates from here: the buttons are the app's, the
 * actions are the app's job.
 */
function WelcomeShowcase({ onReady }: LiveComponentProps) {
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  useEffect(() => {
    // Two frames: committed and laid out.
    const id = requestAnimationFrame(() => requestAnimationFrame(() => readyRef.current()));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    // `relative` + `transform`: Blip's fixed-position dock stays inside the
    // showcase instead of the page.
    <div className='relative h-full w-full overflow-hidden bg-primary-black [transform:translateZ(0)]'>
      <WelcomePage
        recentFiles={[]}
        demos={WELCOME_DEMOS}
        tutorials={[{ id: 'open-piano-demo', title: 'Open the piano demo', minutes: 1, done: false }]}
        canCreate
        canLinkFolders
        showOnStartup
        onShowOnStartupChange={noop}
        onNewGraph={noop}
        onImport={noop}
        onLinkFolder={noop}
        onOpenFile={noop}
        onOpenDemo={noop}
        onStartTutorial={noop}
      />
      <BlipOffer onTutorial={noop} onJustOpen={noop} onDismiss={noop} />
    </div>
  );
}

export { WelcomeShowcase };
