import { useEffect, useRef } from 'react';
import type { LiveComponentProps } from './LiveSlot';
import { frameSearch, parseFrameMessage } from './frame/protocol';
import type { FrameQuery } from './frame/protocol';

/**
 * A live showcase in its own window: an iframe of `showcase.html`, which runs
 * the real app component (see `frame/main.tsx` for why a window of its own).
 * In a slot it is laid out at the slot's desktop size and scaled; in the
 * "Try it" dialog it fills the dialog and takes input. The frame pauses its
 * own previews while it is not seen, so `visible` is not needed here.
 */
function FrameLive({ query, interactive, label, onReady, onFailed }: { query: FrameQuery } & LiveComponentProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const callbacks = useRef({ onReady, onFailed });
  useEffect(() => {
    callbacks.current = { onReady, onFailed };
  });

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      console.error('[showcase] a showcase frame failed:', message);
      callbacks.current.onFailed(message);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
      const message = parseFrameMessage(event.data);
      if (!message) return;
      if (message.type === 'showcase:failed') {
        fail(message.message);
        return;
      }
      if (settled) return;
      settled = true;
      if (message.degraded) console.warn('[showcase] a showcase frame is ready without its full look:', message.degraded.join(', '));
      callbacks.current.onReady();
    };
    // A frame whose script never ran — a chunk missing after a deploy, a
    // browser error page — sends nothing; its `load` says so (the module
    // script marks the window before the document finishes loading).
    const onLoad = () => {
      let booted = false;
      try {
        const win = frame.contentWindow as (Window & { __showcaseBooted?: boolean }) | null;
        if (!win || win.location.href === 'about:blank') return;
        booted = win.__showcaseBooted === true;
      } catch {
        booted = false;
      }
      if (!booted) fail('the showcase did not start');
    };
    window.addEventListener('message', onMessage);
    frame.addEventListener('load', onLoad);
    return () => {
      window.removeEventListener('message', onMessage);
      frame.removeEventListener('load', onLoad);
    };
  }, []);

  // "Try it" is the app in use: real audio on the visitor's first click.
  const src = `${import.meta.env.BASE_URL}showcase.html${frameSearch({ ...query, live: interactive })}`;
  return (
    <iframe
      ref={frameRef}
      src={src}
      title={`${label} — the Nodestra app${interactive ? '' : ', playing'}`}
      tabIndex={interactive ? 0 : -1}
      className='block h-full w-full border-0 bg-primary-black'
    />
  );
}

export { FrameLive };
