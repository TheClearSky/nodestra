/**
 * The Nodestra mark: an orchestra's fan of seats — five nodes in the socket
 * colours (Audio, Number, Signal, Gate, Waveform), each wired to the
 * conductor at the front. Outlines use `currentColor`, so it works on any
 * ground.
 */
function NodestraMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 64 64'
      className={className}
      aria-hidden='true'
      focusable='false'
    >
      <g fill='none' strokeWidth='3' strokeLinecap='round'>
        <path d='M32 52 Q14 54 6.9 45.3' stroke='#2ECC71' />
        <path d='M32 52 Q18 42 16.2 31.4' stroke='#3498DB' />
        <path d='M32 52 Q32 38 32 26' stroke='#F1C40F' />
        <path d='M32 52 Q46 42 47.8 31.4' stroke='#E74C3C' />
        <path d='M32 52 Q50 54 57.1 45.3' stroke='#9B59B6' />
      </g>
      <circle cx='6.9' cy='45.3' r='4.2' fill='#2ECC71' />
      <circle cx='16.2' cy='31.4' r='4.2' fill='#3498DB' />
      <circle cx='32' cy='26' r='4.2' fill='#F1C40F' />
      <circle cx='47.8' cy='31.4' r='4.2' fill='#E74C3C' />
      <circle cx='57.1' cy='45.3' r='4.2' fill='#9B59B6' />
      <circle cx='32' cy='52' r='6' fill='none' stroke='currentColor' strokeWidth='3' />
    </svg>
  );
}

export { NodestraMark };
