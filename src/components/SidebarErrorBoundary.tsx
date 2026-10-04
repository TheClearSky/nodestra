import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

type Props = {
  children: ReactNode;
  /** When this changes (e.g. the library switches mode), a crashed panel
   *  gets a fresh try on its own — no dead "Try again" after a link. */
  resetKey?: string;
};
type State = { error: Error | null };

/**
 * Keeps a failure in the library sidebar inside the sidebar. Without it an
 * exception while rendering the tree unmounted the whole React root —
 * graph editor included — which is a far worse outcome than a broken panel.
 */
class SidebarErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(previous: Props): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[library] sidebar crashed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <aside className='flex h-full w-[260px] flex-none flex-col gap-2 border-r border-secondary-dark-gray bg-secondary-black p-3 text-[12px] text-primary-light-gray'>
        <p className='text-primary-white'>The library panel hit an error.</p>
        <p className='break-words'>{this.state.error.message}</p>
        <button
          type='button'
          className='cursor-pointer self-start rounded border border-primary-gray bg-primary-dark-gray px-2 py-1 text-primary-white hover:bg-secondary-dark-gray'
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </aside>
    );
  }
}

export { SidebarErrorBoundary };
