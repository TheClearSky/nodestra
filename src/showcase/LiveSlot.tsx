import { Component, useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { releaseLive, reprioritise, requestLive } from './liveScheduler';
import type { LiveSlotHandle } from './liveScheduler';

/** What every live showcase component is given by its slot. */
type LiveComponentProps = {
  /** Any part of the slot is on screen (off screen: freeze what can be frozen). */
  visible: boolean;
  /** The full-size "Try it" instance: it takes input. */
  interactive: boolean;
  /** Call once the component is laid out and set up — the slot fades it in then. */
  onReady(): void;
};

/** Loads the live component (a dynamic import: its code is fetched only
 *  when a slot first goes live). Keep it module-level so it is stable. */
type LiveLoader<P> = () => Promise<ComponentType<P & LiveComponentProps>>;

/** Zoom into part of the virtual screen: centre (x, y) in virtual px, and how
 *  much closer than "the whole screen" (1). */
type LiveCrop = { x: number; y: number; scale: number };

type LiveSlotProps<P> = {
  load: LiveLoader<P>;
  props: P;
  /** Shown until the live component is ready, and whenever it is not live. */
  poster: ReactNode;
  /** Names the component ("A running effects graph"). */
  label: string;
  /** The desktop-sized screen the component lays out at before it is scaled
   *  into the slot (the app is a desktop layout). */
  virtual?: { width: number; height: number };
  crop?: LiveCrop;
  /** 'scale' (default): lay out at `virtual` and scale into the slot.
   *  'fill': the component fills the slot as it is (it scales itself). */
  fit?: 'scale' | 'fill';
  /** Offer "Try it" (the full-size, interactive dialog). Default true. */
  tryIt?: boolean;
  /** How close (rootMargin) before it asks to go live, and how far before it
   *  is unmounted again. Defaults '100% 0px' / '200% 0px': a screen ahead,
   *  two behind. A heavy slot tightens both. */
  nearMargin?: string;
  farMargin?: string;
  /** Go live only after a tap on the poster (heavy content on a constrained
   *  device). The poster then carries the button. */
  waitForTap?: boolean;
  tapLabel?: string;
  className?: string;
};

const DEFAULT_VIRTUAL = { width: 1440, height: 900 };

/** A live component that throws falls back to the poster, never the page. */
class SlotBoundary extends Component<{ onError(): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('[showcase] a live component failed; showing its poster', error);
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The fetched component, shared by every slot that uses the same loader. */
function useLoaded<P>(load: LiveLoader<P>, wanted: boolean) {
  const [loaded, setLoaded] = useState<ComponentType<P & LiveComponentProps> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!wanted || loaded || failed) return undefined;
    let cancelled = false;
    load()
      .then((component) => {
        if (!cancelled) setLoaded(() => component);
      })
      .catch((error: unknown) => {
        console.error('[showcase] could not load a live component', error);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [wanted, loaded, failed, load]);
  return { Live: loaded, failed, setFailed };
}

/** "Try it": the same component, full size and taking input, over the page. */
function LiveDialog<P extends object>({
  Live,
  props,
  label,
  onClose,
}: {
  Live: ComponentType<P & LiveComponentProps>;
  props: P;
  label: string;
  onClose(): void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      root.style.overflow = previous;
    };
  }, [onClose]);
  return createPortal(
    <div role='dialog' aria-modal='true' aria-label={label} className='fixed inset-0 z-[1100] flex flex-col gap-2 bg-black/85 p-2 backdrop-blur-sm sm:p-6'>
      <div className='flex items-center justify-between gap-3 px-1'>
        <p className='truncate text-[14px] text-[#e9d3a8]'>{label} — live</p>
        <button
          ref={closeRef}
          type='button'
          onClick={onClose}
          className='cursor-pointer rounded-full border border-[#e9d3a8]/40 bg-black/60 px-4 py-1.5 text-[13px] text-[#f4ead8] hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9d3a8]'
        >
          Done
        </button>
      </div>
      <div className='relative min-h-0 flex-1 overflow-hidden rounded-xl border border-[#e9d3a8]/20'>
        <div className={`absolute inset-0 transition-opacity duration-300 ${ready ? 'opacity-100' : 'opacity-0'}`}>
          <Live {...props} visible interactive onReady={() => setReady(true)} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * A place on the page where a REAL app component runs — mounted only while
 * it is near the viewport, and only when the scheduler has room for it.
 *
 *   far away         poster only (nothing of the app is loaded)
 *   near (1 screen)  asks to go live; mounted in an idle moment, laid out at
 *                    a desktop size and scaled into the slot, look-only (the
 *                    page keeps scrolling on phones)
 *   ready            faded in over the poster; "Try it" opens the same
 *                    component full size, taking input, in a dialog
 *   far (2 screens)  unmounted again; its place goes to another slot
 */
function LiveSlot<P extends object>({ load, props, poster, label, virtual = DEFAULT_VIRTUAL, crop, fit = 'scale', tryIt = true, nearMargin = '100% 0px', farMargin = '200% 0px', waitForTap = false, tapLabel = 'Load', className = '' }: LiveSlotProps<P>) {
  const box = useRef<HTMLDivElement>(null);
  const share = useRef(0);
  const handleRef = useRef<LiveSlotHandle | null>(null);
  const [tapped, setTapped] = useState(!waitForTap);
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const [trying, setTrying] = useState(false);
  const { Live, failed, setFailed } = useLoaded(load, mounted || trying);
  const closeTrying = useCallback(() => setTrying(false), []);

  useEffect(() => {
    const element = box.current;
    if (!element || !tapped) return undefined;
    const handle: LiveSlotHandle = {
      priority: () => share.current,
      mount: () => setMounted(true),
      unmount: () => {
        setMounted(false);
        setReady(false);
      },
    };
    handleRef.current = handle;
    const near = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) requestLive(handle);
    }, { rootMargin: nearMargin });
    const far = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) releaseLive(handle);
    }, { rootMargin: farMargin });
    const seen = new IntersectionObserver(([entry]) => {
      share.current = entry.intersectionRatio;
      setVisible(entry.intersectionRatio > 0);
      reprioritise();
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
    const size = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    near.observe(element);
    far.observe(element);
    seen.observe(element);
    size.observe(element);
    return () => {
      near.disconnect();
      far.disconnect();
      seen.disconnect();
      size.disconnect();
      releaseLive(handle);
    };
  }, [nearMargin, farMargin, tapped]);

  // A failed component gives its place in the budget up (it shows its
  // poster for good).
  useEffect(() => {
    if (failed && handleRef.current) releaseLive(handleRef.current);
  }, [failed]);

  // Desktop-sized layout, scaled to the slot; a crop zooms in on its focus,
  // clamped so no empty edge shows (as the old snapshot cards did).
  const zoom = crop?.scale ?? 1;
  const scale = (width / virtual.width) * zoom;
  const visibleW = virtual.width / zoom;
  const visibleH = virtual.height / zoom;
  const left = crop ? Math.min(Math.max(crop.x - visibleW / 2, 0), virtual.width - visibleW) : 0;
  const top = crop ? Math.min(Math.max(crop.y - visibleH / 2, 0), virtual.height - visibleH) : 0;

  const showLive = mounted && Live !== null && !failed && width > 0;
  return (
    <div
      ref={box}
      role='group'
      aria-label={label}
      data-live={failed ? 'failed' : !mounted ? 'poster' : ready ? 'ready' : 'loading'}
      className={`relative overflow-hidden ${className}`}
      style={{ aspectRatio: `${virtual.width} / ${virtual.height}` }}
    >
      <div className='absolute inset-0'>{poster}</div>
      {!tapped && (
        <button
          type='button'
          onClick={() => setTapped(true)}
          className='absolute inset-0 z-10 m-auto h-fit w-fit cursor-pointer rounded-full border border-[#e9d3a8]/50 bg-black/60 px-6 py-3 text-[15px] text-[#f4ead8] backdrop-blur-md transition-colors hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9d3a8]'
        >
          {tapLabel}
        </button>
      )}
      {showLive && (
        <SlotBoundary onError={() => setFailed(true)}>
          {fit === 'fill' ? (
            // Its own controls, its own scaling: it takes input as it is.
            <div className={`absolute inset-0 transition-opacity duration-500 ${ready ? 'opacity-100' : 'opacity-0'}`}>
              <Live {...props} visible={visible} interactive onReady={() => setReady(true)} />
            </div>
          ) : (
            <div
              inert
              aria-hidden='true'
              className={`pointer-events-none absolute top-0 left-0 origin-top-left transition-opacity duration-500 ${ready ? 'opacity-100' : 'opacity-0'}`}
              style={{ width: virtual.width, height: virtual.height, transform: `scale(${scale}) translate(${-left}px, ${-top}px)` }}
            >
              <Live {...props} visible={visible} interactive={false} onReady={() => setReady(true)} />
            </div>
          )}
        </SlotBoundary>
      )}
      {tryIt && ready && Live && (
        <button
          type='button'
          onClick={() => setTrying(true)}
          className='absolute right-3 bottom-3 z-10 cursor-pointer rounded-full border border-[#e9d3a8]/40 bg-black/60 px-4 py-1.5 text-[13px] text-[#f4ead8] backdrop-blur-md transition-colors hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9d3a8]'
        >
          Try it
        </button>
      )}
      {trying && Live && <LiveDialog Live={Live} props={props} label={label} onClose={closeTrying} />}
    </div>
  );
}

export { LiveSlot };
export type { LiveComponentProps, LiveCrop, LiveLoader };
