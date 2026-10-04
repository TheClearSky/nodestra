/**
 * GENERATED — DO NOT EDIT.
 */

import type { InstrumentSpec } from './groupBuilder';
import { buildInstrumentType } from './groupBuilder';

const spec = {
  "id": "inst_kit3_a",
  "name": "Kit 3 A (snare)",
  "family": "Kits",
  "headerColor": "#374151",
  "inputs": [
    {
      "name": "Gate",
      "dataType": "boolSignal",
      "maxConnections": 1
    },
    {
      "name": "Amp",
      "dataType": "signal",
      "maxConnections": 1
    }
  ],
  "outputs": [
    {
      "name": "Out",
      "dataType": "audio"
    }
  ],
  "nodes": [
    {
      "id": "nz",
      "type": "noise",
      "x": -650,
      "y": -80,
      "values": {
        "Type": "white",
        "Level": 1
      }
    },
    {
      "id": "bp",
      "type": "filter",
      "x": -400,
      "y": -80,
      "values": {
        "Type": "bandpass",
        "Freq": 671.7,
        "Q": 1
      }
    },
    {
      "id": "tone",
      "type": "oscillator",
      "x": -400,
      "y": 100,
      "values": {
        "Shape": "sine",
        "Frequency": 537.4,
        "Level": 0.4
      }
    },
    {
      "id": "pmix",
      "type": "mix",
      "x": -200,
      "y": 0
    },
    {
      "id": "adsrA",
      "type": "adsr",
      "x": 0,
      "y": 0,
      "values": {
        "Trigger": "rising",
        "Attack s": 0.001,
        "Decay s": 0.2,
        "Sustain": 0,
        "Release s": 0.05
      }
    },
    {
      "id": "amp",
      "type": "gain",
      "x": 220,
      "y": 0
    }
  ],
  "edges": [
    {
      "from": "nz",
      "output": "Out",
      "to": "bp",
      "input": "In"
    },
    {
      "from": "bp",
      "output": "Out",
      "to": "pmix",
      "input": "In"
    },
    {
      "from": "tone",
      "output": "Out",
      "to": "pmix",
      "input": "In"
    },
    {
      "from": "pmix",
      "output": "Out",
      "to": "adsrA",
      "input": "In"
    },
    {
      "from": "$in",
      "output": "Gate",
      "to": "adsrA",
      "input": "Gate"
    },
    {
      "from": "adsrA",
      "output": "Out",
      "to": "amp",
      "input": "In"
    },
    {
      "from": "$in",
      "output": "Amp",
      "to": "amp",
      "input": "Gain"
    },
    {
      "from": "amp",
      "output": "Out",
      "to": "$out",
      "input": "Out"
    }
  ]
} as unknown as InstrumentSpec;

const inst_kit3_a = buildInstrumentType(spec);

export { inst_kit3_a };
