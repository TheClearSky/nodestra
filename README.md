# Nodestra

<img src="public/favicon.svg" alt="" width="56" align="left">

**Nodestra** — build instruments and songs from nodes, and hear every change.
Node-based sound system built on
[`@theclearsky/react-blender-nodes`](https://github.com/TheClearSky/react-blender-nodes)
and [Tone.js](https://tonejs.github.io/) — an editable audio node graph with
all-operations sound processing, a drawn-waveform oscillator, live per-node
waveform/audiogram previews, and a custom sound input component.

## How these projects fit together

```text
                react-blender-nodes  ·  MIT  ·  published
                            T H E   E N G I N E
     ┌────────────────────────────────────────────────────────────┐
     │  A Blender-style node-graph editor for React.              │
     │  Typed handles · validate → plan → apply state · node      │
     │  groups · loops & switches · graph compiler + runner ·     │
     │  import / export                                           │
     └──────┬──────────────────────┬────────────────────────┬─────┘
            │                      │                        │
            │ peerDependency       │ peerDependency         │ file:
            │ >=0.0.14 <1          │ >=0.0.14 <1            │ dependency
            │                      │ (via /contract —       │
            ▼                      ▼  React-free)           │
  ┌──────────────────────┐  ┌──────────────────────┐        │
  │ …-timeline           │  │ …-codegen            │        │
  │ AGPL-3.0 · published │  │ AGPL-3.0 · published │        │
  ├──────────────────────┤  ├──────────────────────┤        │
  │ Keyframed CURVES and │  │ Compiles a graph into│        │
  │ a transport. A curve │  │ a standalone,        │        │
  │ becomes a live signal│  │ dependency-free      │        │
  │ the running graph    │  │ runGraph module.     │        │
  │ can read.            │  │ No React at runtime. │        │
  └──────────┬───────────┘  └──────────────────────┘        │
             │                                              │
             │ file: dependency                             │
             └───────────────────┬──────────────────────────┘
                                 ▼
     ┌────────────────────────────────────────────────────────────┐
     │  nodestra  ·  AGPL-3.0  ·  app                             │
     │                  T H E   A P P L I C A T I O N             │
     ├────────────────────────────────────────────────────────────┤
     │  Here the nodes ARE the audio graph (Tone.js / Web Audio): │
     │  draw a waveform and hear it · gate-driven envelopes ·     │
     │  17-key polyphony · timeline curves automating any         │
     │  parameter while it plays · a spectrally-modelled          │
     │  instrument library                                        │
     └────────────────────────────────────────────────────────────┘
```

An arrow points from a package **to the package that depends on it**. The
two plugins never import each other — this app is the only place they meet.
The engine is MIT so anyone can build on it; the plugins and this app are
AGPL-3.0-only, with commercial licensing available separately.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
npm run type-check   # tsc --noEmit
npm run test:unit    # vitest (DFT oracles + build lifecycle)
```

Click **"Click to start audio"** (browsers require a real gesture), then press
the runner's **Run** — a Run BUILDS the live audio graph; re-Run replaces it;
the toolbar **Stop** (or Esc) silences it.

- **Draw a sound:** edit the Drawn Osc's waveform canvas (presets seed it:
  Sine/Square/Saw/Tri/Noise; then draw freely). The drawing IS the sound —
  verified against its own FFT preview to within ~0.5 dB of Fourier theory.
- **Play it:** `a w s e d f t g y h u j k o l p` = chromatic from C4; `,`/`.`
  shift octaves (z/x belong to the editor — `x` deletes selected nodes,
  Ctrl+Z undoes). ADSR nodes gate on key down/up; modifier chords never play
  notes.
- **Modulate:** `signal` inputs (amber) show a number knob when unconnected;
  connecting a Pulser/Constant REPLACES the knob, and multiple signal
  connections SUM. Base + wobble = Pulser with an Offset (or add a Constant).
- **Previews:** every audio node shows a live waveform; toggle per node to the
  scrolling **audiogram** heat map (Render also has a meter mode).
- **Automate over time:** the **Timeline** drawer (the floating **Timeline**
  button beside **Runner** at the bottom of the graph, or the **Timeline**
  switcher in the Runner's header — only one of the two is open at a time)
  edits multipart named curves with per-side interpolation (step / linear /
  ease); a **Timeline Curve** node picks a curve and outputs it as a live
  `signal` — bind it to Filter Freq, Level, anything — plus the value at
  Run time as a `number`. Scrub or press ▶ in the drawer's toolbar and the
  sound follows the curve, no re-Run needed (powered by
  `@theclearsky/react-blender-nodes-timeline`, AGPL-3.0-only).
- **Record / save:** ● Record captures the master bus to `.webm`;
  Export/Import move the whole project as one JSON file (graph + timeline);
  the project also autosaves to localStorage.
- **URL flags:** `?muted=1` mutes the speakers only, while the meters keep
  measuring (useful for silent measurement runs); `?nosave=1` disables
  autosave. Flag semantics: present = on, except explicit `=0`/`=false`.

## Node catalog (v1)

Sources: Drawn Osc · Oscillator · Noise · Player · Pulser · Constant ·
Keyboard Pitch — Adapters: To Signal · To Audio — Effects: Distortion ·
Chebyshev · Bit Crusher · Chorus · Phaser · Tremolo · Vibrato · Auto Filter ·
Auto Wah · Auto Panner · Delay · Ping Pong Delay · Reverb · Freeverb ·
JC Reverb · Freq Shifter · Pitch Shift · Stereo Widener · Saturator —
Processing: Filter · EQ3 · Compressor · Limiter · Noise Gate · Gain · Pan ·
Cross Fade · Mix · ADSR — Timeline: **Timeline Curve** (a named curve as a
live signal + Run-time number) — Output: **Render** (what you listen to;
several Renders sum).

The polyphony set: **All Keys** (16 physical keys as `[Gate, Hz]` output pairs —
polyphony by wiring one voice per key), **Threshold** (a signal → gate
Schmitt trigger, so a timeline lane can articulate a voice), and an **ADSR**
that follows a `Gate` input sample-accurately (leave Gate unwired and the
node behaves exactly as it always did, on the global keyboard bus).

## Instrument library

`Instruments > Bass & 808 / Kits / Plucks & Keys / Vox` in the Add-node
menu: node groups built from **measured spectral analysis**, not
hand-tuned — harmonic partial tracking → a drawn wavetable, envelope fits,
noise layers, pitch envelopes, drive.

The library ships **Vampire Synth · Organ · Windy Vox · Deep Flute** plus
**Deep Kit**, **Light Kit** and **Kit 3**.

Contract, the same for every instrument:

| Handle      | Meaning                                                 |
| ----------- | ------------------------------------------------------- |
| `Hz` (in)   | pitch, one connection — tonal instruments only          |
| `Gate` (in) | articulation; rises = note on. Kit pieces are one-shots |
| `Amp` (in)  | optional expression multiplier, default 1               |
| `Out` (out) | audio                                                   |

**Play one in three moves:** add an instrument, add **All Keys**, wire a
key's `Hz`+`Gate` pair into it and its `Out` into a **Render** — then Run and
play `a w s e d f t g y h u j k o l p` (`,`/`.` shift octave). Want chords?
Add the instrument again and wire another key: each group is one voice.
Kit pieces need only `Gate`, so one key per drum.

Prefer to just listen? The toolbar's **Instrument library** dropdown has one
demo per instrument — tonal ones arrive with a voice on every one of the 16
keys, kits as a playable drum row (Deep Kit on `a·s·d·f·g·h`, Light Kit on
`a·s·d·f·g·h·j·k·l·w`). Open any instrument group (the header's edit
action) to see exactly how it is built.

The modules under `src/soundDefinitions/instruments/` are generated output;
they are produced by local authoring tooling that is not part of this repo.

## License

GNU Affero General Public License v3.0 (`AGPL-3.0-only`) — see
[LICENSE](./LICENSE). Copyright (C) 2026 Deepak Prasad.

Audio and recordings you create with the app are yours — the license covers
the code, not your output. Commercial/proprietary licensing is available
separately — contact [@TheClearSky](https://github.com/TheClearSky).
