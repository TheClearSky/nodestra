import { useEffect, useRef, useState } from 'react';
import type { LiveComponentProps } from './LiveSlot';
import { frameSearch, isMessage } from './frame/protocol';
import type { FrameQuery, FrameToPage, PageToFrame } from './frame/protocol';

/**
 * A live showcase in its own window: an iframe of `showcase.html`, which runs
 * the real app component (see `frame/main.tsx` for why a window of its own).
 * In a slot it is laid out at the slot's desktop size and scaled; in the
 * "Try it" dialog it fills the dialog and takes input.
 */
function FrameLive({ query, visible, interactive, onReady }: { query: FrameQuery } & LiveComponentProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frameRef.current?.contentWindow) return;
      if (!isMessage<FrameToPage>(event.data)) return;
      if (event.data.type === 'showcase:ready') readyRef.current();
      else {
        console.error('[showcase] a showcase frame failed:', event.data.message);
        setFailure(event.data.message);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    const message: PageToFrame = { type: 'showcase:visible', visible };
    frameRef.current?.contentWindow?.postMessage(message, location.origin);
  }, [visible]);

  // The slot's error boundary turns this into its poster.
  if (failure !== null) throw new Error(`[showcase] the frame failed: ${failure}`);

  const src = `${import.meta.env.BASE_URL}showcase.html${frameSearch(query)}${interactive ? '&interactive' : ''}`;
  return (
    <iframe
      ref={frameRef}
      src={src}
      title='A live part of the Nodestra app'
      tabIndex={interactive ? 0 : -1}
      className='block h-full w-full border-0 bg-primary-black'
    />
  );
}

export { FrameLive };
