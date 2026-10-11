import type { LandingInstrument } from '../landing/StageLanding';
import { instrumentDemoBuilders } from './instrumentDemos';
import { buildProbeGraphState } from './probeGraphs';
import type { ProbeState } from './probeGraphs';

/** The demo each of the start stage's play buttons installs — a probe graph
 *  or an Instrument-library demo. The sakura plays the library's Organ demo
 *  (2026-10-04, Deepak: "organ demo suits sakura scene the best"), the
 *  hellscape its Vampire Synth.
 *  `landingGraphs.test.ts` checks every id resolves. */
const LANDING_GRAPHS: Record<LandingInstrument, string> = {
  piano: 'piano',
  guitar: 'guitarKeys',
  sakura: 'demoInst_inst_organ',
  // The hellscape's synth on the castle roof (2026-10-11).
  hell: 'demoInst_inst_vampireSynth',
};

function landingGraphState(instrument: LandingInstrument): ProbeState {
  const id = LANDING_GRAPHS[instrument];
  return id in instrumentDemoBuilders ? instrumentDemoBuilders[id]() : buildProbeGraphState(id);
}

export { LANDING_GRAPHS, landingGraphState };
