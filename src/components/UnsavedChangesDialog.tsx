import { useCallback, useEffect, useRef, useState } from 'react';

type Choice = 'save' | 'discard' | 'cancel';
type Request = { names: readonly string[]; resolve(choice: Choice): void };

/**
 * "Save changes before closing?" — Save / Don't save / Cancel, like every
 * editor. A native `<dialog>` opened with `showModal()`: the browser traps
 * focus, makes the rest of the page inert and maps Escape to Cancel.
 *
 * `useUnsavedChangesDialog()` returns the async `ask(names)` for the session
 * and the element to render.
 */
function useUnsavedChangesDialog() {
  const [request, setRequest] = useState<Request | null>(null);
  const ask = useCallback(
    (names: readonly string[]) => new Promise<Choice>((resolve) => setRequest({ names, resolve })),
    [],
  );
  const element = request ? (
    <UnsavedChangesDialog
      names={request.names}
      onChoose={(choice) => {
        request.resolve(choice);
        setRequest(null);
      }}
    />
  ) : null;
  return { ask, element };
}

function UnsavedChangesDialog({
  names,
  onChoose,
}: {
  names: readonly string[];
  onChoose(choice: Choice): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const single = names.length === 1;
  return (
    <dialog
      ref={ref}
      aria-labelledby='unsaved-title'
      onCancel={(event) => {
        event.preventDefault();
        onChoose('cancel');
      }}
      className='m-auto w-[420px] max-w-[calc(100vw-32px)] rounded-lg border border-secondary-dark-gray bg-primary-dark-gray p-5 text-primary-white backdrop:bg-black/60'
    >
      <h2 id='unsaved-title' className='mb-2 text-[15px] font-semibold'>
        {single ? `Save changes to “${names[0]}”?` : `Save changes to ${names.length} files?`}
      </h2>
      {!single && (
        <ul className='mb-2 max-h-40 list-disc overflow-auto pl-5 text-[13px] text-primary-light-gray'>
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      )}
      <p className='mb-4 text-[13px] text-primary-light-gray'>Your changes will be lost if you don’t save them.</p>
      <div className='flex justify-end gap-2'>
        <button
          type='button'
          className='cursor-pointer rounded px-3 py-1.5 text-[13px] hover:bg-secondary-dark-gray'
          onClick={() => onChoose('discard')}
        >
          Don’t save
        </button>
        <button
          type='button'
          className='cursor-pointer rounded px-3 py-1.5 text-[13px] hover:bg-secondary-dark-gray'
          onClick={() => onChoose('cancel')}
        >
          Cancel
        </button>
        <button
          type='button'
          autoFocus
          className='cursor-pointer rounded bg-primary-blue px-3 py-1.5 text-[13px] font-semibold text-white hover:brightness-110'
          onClick={() => onChoose('save')}
        >
          Save
        </button>
      </div>
    </dialog>
  );
}

export { useUnsavedChangesDialog };
