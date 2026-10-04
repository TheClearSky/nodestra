/**
 * What the editor area shows when no file is open (ruling Q7: a first visit
 * opens nothing). A light "watermark" of what to do next; the full Welcome
 * page (P2) builds on this.
 */

type EmptyEditorProps = {
  canCreate: boolean;
  canReopen: boolean;
  onNewGraph(): void;
  onReopen(): void;
  onOpenWelcome(): void;
};

const ROW = 'flex w-full items-center justify-between gap-8 text-[13px]';
const KEY = 'rounded border border-secondary-dark-gray px-1.5 py-0.5 text-[11px] text-primary-light-gray';

function EmptyEditor({ canCreate, canReopen, onNewGraph, onReopen, onOpenWelcome }: EmptyEditorProps) {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-6 bg-primary-black px-6 text-center select-none'>
      <div aria-hidden='true' className='text-[64px] leading-none text-secondary-dark-gray'>
        ♪
      </div>
      <p className='text-[15px] text-primary-light-gray'>Nothing is open</p>
      <div className='flex w-[340px] max-w-full flex-col gap-3 text-left text-primary-light-gray'>
        <div className={ROW}>
          <span>Open a graph</span>
          <span className='text-[12px]'>click it in the library ←</span>
        </div>
        <div className={ROW}>
          <span>Try a demo</span>
          <span className='text-[12px]'>the Demos menu above ↑</span>
        </div>
        {canCreate && (
          <button type='button' className={`${ROW} cursor-pointer hover:text-primary-white`} onClick={onNewGraph}>
            <span>New graph</span>
            <span className={KEY}>＋ Graph</span>
          </button>
        )}
        {canReopen && (
          <button type='button' className={`${ROW} cursor-pointer hover:text-primary-white`} onClick={onReopen}>
            <span>Reopen closed tab</span>
            <span className={KEY}>Alt+Shift+T</span>
          </button>
        )}
        <button type='button' className={`${ROW} cursor-pointer hover:text-primary-white`} onClick={onOpenWelcome}>
          <span>Open Welcome</span>
          <span className='text-[12px]'>demos, recent files, tips</span>
        </button>
        <div className={ROW}>
          <span>Play notes</span>
          <span className={KEY}>A W S E D F T G Y H U J K O L P ;</span>
        </div>
      </div>
    </div>
  );
}

export { EmptyEditor };
