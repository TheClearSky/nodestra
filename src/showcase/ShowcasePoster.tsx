/**
 * What a showcase slot shows while its live component is not mounted: a
 * quiet editor-shaped placeholder — dark canvas, dotted grid, a few node
 * shapes — so the card keeps its size and the page never jumps. Pure CSS.
 */
function ShowcasePoster({ title }: { title: string }) {
  return (
    <div className='relative h-full w-full overflow-hidden bg-[#141414]' style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
      <div aria-hidden='true' className='absolute inset-x-0 top-0 h-[7%] border-b border-white/5 bg-[#1d1d1d]' />
      {[
        [12, 30, 18, 26],
        [40, 22, 18, 34],
        [68, 34, 18, 24],
      ].map(([x, y, w, h]) => (
        <div
          key={x}
          aria-hidden='true'
          className='absolute rounded-md border border-white/8 bg-[#2a2a2a]'
          style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}
        >
          <div className='h-[16%] rounded-t-md bg-[#3d3d3d]' />
        </div>
      ))}
      <p className='absolute inset-x-0 bottom-3 text-center text-[12px] text-white/35'>{title} · live demo</p>
    </div>
  );
}

export { ShowcasePoster };
