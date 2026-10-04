import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Grep gate: Tone's MEMBER `.connect()` on Signal-family nodes runs
 * `connectSignal`, which ZEROES the destination param — only the free
 * `Tone.connect(src, dst)` is allowed in the audio seam files. One future
 * `chain.output.connect(param)` slip silently flips the modulation
 * semantics; this test makes the slip loud.
 */

const bannedMemberConnect = /(?<!Tone)\.connect\(/;

const seamFiles = [
  '../soundDefinitions/implementations.ts',
  '../audio/bootstrap.ts',
  '../components/previews/tapManager.ts',
];

describe('free-connect discipline', () => {
  for (const relativePath of seamFiles) {
    it(`${relativePath} contains no member .connect( calls`, () => {
      const source = readFileSync(
        fileURLToPath(new URL(relativePath, import.meta.url)),
        'utf-8',
      );
      const offending = source
        .split('\n')
        .map((line, index) => ({ line, number: index + 1 }))
        // Comment lines may legitimately DESCRIBE the banned pattern.
        .filter(({ line }) => {
          const trimmed = line.trim();
          return !(
            trimmed.startsWith('*') ||
            trimmed.startsWith('//') ||
            trimmed.startsWith('/*')
          );
        })
        .filter(({ line }) => bannedMemberConnect.test(line));
      expect(
        offending,
        `member .connect( found — use the free Tone.connect:\n${offending
          .map(({ number, line }) => `  L${number}: ${line.trim()}`)
          .join('\n')}`,
      ).toEqual([]);
    });
  }
});
