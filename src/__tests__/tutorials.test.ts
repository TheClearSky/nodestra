/**
 * Tutorials must not rot when the UI changes. Every bundled script has to
 * validate against the app's kit, and every `data-tour` anchor the kit's
 * targets rely on has to exist somewhere in the source.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTutorial } from '@theclearsky/easy-tutorial-builder/schema';
import { tutorialKit } from '../tutorials/kit';
import openPianoDemo from '../tutorials/open-piano-demo.json';
import { allDemoCategories } from '../soundDefinitions/demoCatalog';

const SOURCE_ROOT = path.resolve(__dirname, '..');

function sourceText(): string {
  const chunks: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== '__tests__') walk(full);
      } else if (/\.(tsx?|json)$/.test(name)) {
        chunks.push(readFileSync(full, 'utf8'));
      }
    }
  };
  walk(SOURCE_ROOT);
  return chunks.join('\n');
}

describe('bundled tutorials', () => {
  it('validate against the app kit', () => {
    const parsed = parseTutorial(tutorialKit, openPianoDemo);
    expect(parsed.ok ? [] : parsed.issues).toEqual([]);
  });

  it('every data-tour anchor the kit resolves exists in the source', () => {
    const kitSource = readFileSync(path.join(SOURCE_ROOT, 'tutorials', 'kit.ts'), 'utf8');
    const anchors = [...kitSource.matchAll(/byTourId\('([^']+)'\)/g)].map((match) => match[1]);
    expect(anchors.length).toBeGreaterThan(3);
    const source = sourceText();
    const missing = [...new Set(anchors)].filter(
      (anchor) => !source.includes(`data-tour='${anchor}'`) && !source.includes(`data-tour="${anchor}"`),
    );
    expect(missing).toEqual([]);
  });

  it('the menu labels a script names exist in the Demos catalogue', () => {
    const labels = new Set(allDemoCategories.map((category) => category.label));
    const demoIds = new Set(allDemoCategories.flatMap((category) => category.options.map((option) => option.id)));
    const text = JSON.stringify(openPianoDemo);
    for (const match of text.matchAll(/"args":{"label":"([^"]+)"/g)) expect(labels.has(match[1])).toBe(true);
    for (const match of text.matchAll(/"demoId":"([^"]+)"/g)) expect(demoIds.has(match[1])).toBe(true);
  });
});
