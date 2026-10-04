/**
 * GENERATED — DO NOT EDIT.
 */

import type { InstrumentSpec } from './groupBuilder';
import { buildInstrumentType } from './groupBuilder';

const spec = {
  "id": "inst_deepKit_f",
  "name": "Deep Kit F (kick)",
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
      "id": "osc",
      "type": "oscillator",
      "x": -400,
      "y": 0,
      "values": {
        "Shape": "sine",
        "Level": 1
      }
    },
    {
      "id": "base",
      "type": "constant",
      "x": -650,
      "y": -160,
      "values": {
        "Value": 135.5
      }
    },
    {
      "id": "adsrP",
      "type": "adsr",
      "x": -650,
      "y": 160,
      "values": {
        "Trigger": "rising",
        "Attack s": 0.001,
        "Decay s": 0.05,
        "Sustain": 0,
        "Release s": 0.01
      }
    },
    {
      "id": "peA",
      "type": "toAudio",
      "x": -500,
      "y": 160
    },
    {
      "id": "peScale",
      "type": "gain",
      "x": -350,
      "y": 160,
      "values": {
        "Gain": 215.2
      }
    },
    {
      "id": "peS",
      "type": "toSignal",
      "x": -200,
      "y": 160
    },
    {
      "id": "adsrA",
      "type": "adsr",
      "x": 0,
      "y": 0,
      "values": {
        "Trigger": "rising",
        "Attack s": 0.001,
        "Decay s": 0.1448,
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
      "from": "base",
      "output": "Out",
      "to": "osc",
      "input": "Frequency"
    },
    {
      "from": "$in",
      "output": "Gate",
      "to": "adsrP",
      "input": "Gate"
    },
    {
      "from": "adsrP",
      "output": "Env",
      "to": "peA",
      "input": "In"
    },
    {
      "from": "peA",
      "output": "Out",
      "to": "peScale",
      "input": "In"
    },
    {
      "from": "peScale",
      "output": "Out",
      "to": "peS",
      "input": "In"
    },
    {
      "from": "peS",
      "output": "Out",
      "to": "osc",
      "input": "Frequency"
    },
    {
      "from": "osc",
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

const inst_deepKit_f = buildInstrumentType(spec);

export { inst_deepKit_f };
