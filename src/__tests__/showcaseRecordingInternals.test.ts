/**
 * The showcase recording reaches two PRIVATE fields of the audio libraries
 * (`audio/showcaseRecording.ts`): a Tone analyser's native nodes
 * (`_analyser._analysers`) and the native context inside
 * standardized-audio-context's OfflineAudioContext
 * (`_nativeOfflineAudioContext`). An upgrade that renames either would leave
 * every showcase flat, with only a console warning — so the installed
 * sources are checked here, and this fails first.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The installed package's file (both are top-level installs). */
function packageFile(pkg: string, path: string): string {
  return readFileSync(join(__dirname, '..', '..', 'node_modules', pkg, path), 'utf8');
}

describe('private library fields the showcase recording relies on', () => {
  it("Tone's analysers keep their native nodes in `_analysers`", () => {
    const analyser = packageFile('tone', 'build/esm/component/analysis/Analyser.js');
    expect(analyser).toMatch(/this\._analysers\s*=\s*\[\]/);
    // Waveform, FFT and Meter all keep their Analyser in MeterBase's field.
    const base = packageFile('tone', 'build/esm/component/analysis/MeterBase.js');
    expect(base).toMatch(/this\._analyser\s*=/);
    for (const tap of ['Waveform', 'FFT', 'Meter']) {
      const source = packageFile('tone', `build/esm/component/analysis/${tap}.js`);
      expect(source, tap).toMatch(/extends MeterBase/);
    }
  });

  it("standardized-audio-context's OfflineAudioContext keeps its native context", () => {
    const source = packageFile('standardized-audio-context', 'build/es2019/factories/offline-audio-context-constructor.js');
    expect(source).toMatch(/_nativeOfflineAudioContext/);
  });
});
