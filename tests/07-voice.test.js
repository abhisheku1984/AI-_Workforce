import test from 'node:test';
import assert from 'node:assert/strict';
import { toSpeechText, speechSummary, matchSpokenSuggestion, speechLocale } from '../src/lib/voice.js';

test('Voice: text prepared for speech keeps the words and loses the typography', async (t) => {
  await t.test('markdown emphasis and headings are stripped', () => {
    assert.equal(toSpeechText('**Utilization** is _79.5%_'), 'Utilization is 79.5%');
    assert.equal(toSpeechText('## Summary\nCapacity is tight'), 'Summary\nCapacity is tight');
  });

  await t.test('bullets and arrows become spoken pauses, not symbols', () => {
    // A synthesiser reads "→" as nothing or as "right arrow"; a comma is a real pause.
    assert.equal(toSpeechText('Nexora → 61 people'), 'Nexora, 61 people');
    assert.equal(toSpeechText('- 61 people\n- 79.5% utilized'), '61 people\n79.5% utilized');
  });

  await t.test('table pipes are not read aloud as "pipe"', () => {
    // Edge pipes must not leave a leading or trailing comma — a synthesiser reads those as pauses.
    assert.equal(toSpeechText('| Month | Cost |\n| Nov | 65.6 |'), 'Month, Cost\nNov, 65.6');
  });

  await t.test('code fences keep their contents', () => {
    assert.match(toSpeechText('Try `npm start` now'), /npm start/);
    assert.doesNotMatch(toSpeechText('Try `npm start` now'), /`/);
  });

  await t.test('whitespace is collapsed but paragraphs survive', () => {
    assert.equal(toSpeechText('a    b\n\n\n\nc'), 'a b\n\nc');
  });

  await t.test('null and undefined are empty, not "null"', () => {
    assert.equal(toSpeechText(null), '');
    assert.equal(toSpeechText(undefined), '');
  });
});

test('Voice: spoken summary is shorter than the displayed answer', async (t) => {
  const answer = {
    answer: 'Nexora has 61 people with 79.5% utilization in November 2026.',
    confidence: 'high',
    evidence: [{ a: 1 }],
    limitations: ['Timesheet data lags by five working days.', 'Contractor hours are estimated.'],
    assumptions: ['Standard 8-hour day.'],
    sources: ['Utilization report'],
    period: { label: 'Nov 2026' },
  };

  await t.test('the answer is spoken, the evidence block is not', () => {
    const spoken = speechSummary(answer);
    assert.match(spoken, /61 people/);
    assert.doesNotMatch(spoken, /\{"a":1\}/);
    assert.doesNotMatch(spoken, /Utilization report/);
  });

  await t.test('exactly one limitation is spoken, as a caveat', () => {
    const spoken = speechSummary(answer);
    assert.match(spoken, /One limitation: Timesheet data lags by five working days\./);
    assert.doesNotMatch(spoken, /Contractor hours are estimated/);
    // Assumptions stay on screen too — they are reference material, not conversation.
    assert.doesNotMatch(spoken, /Standard 8-hour day/);
  });

  await t.test('insufficient data is stated out loud, not left to the screen', () => {
    const spoken = speechSummary({ answer: 'Only two months of data.', insufficient: true });
    assert.match(spoken, /incomplete data/i);
  });

  await t.test('low confidence is announced; high confidence is not', () => {
    assert.match(speechSummary({ answer: 'x', confidence: 'low' }), /confidence .* is low/i);
    assert.doesNotMatch(speechSummary({ answer: 'x', confidence: 'high' }), /confidence/i);
  });

  await t.test('a blocked request is spoken verbatim and adds nothing', () => {
    const spoken = speechSummary({ blocked: true, answer: 'I cannot answer that.' });
    assert.equal(spoken, 'I cannot answer that.');
  });

  await t.test('an empty answer produces no speech rather than "undefined"', () => {
    assert.equal(speechSummary(null), '');
    assert.equal(speechSummary({ answer: '' }), '');
  });
});

test('Voice: spoken phrases map onto the suggested questions', async (t) => {
  const suggestions = [
    'Which departments have the highest unallocated capacity?',
    'Where are we experiencing over-allocation?',
    'Which projects have staffing gaps?',
  ];

  await t.test('a recognised phrase resolves to the closest suggestion', () => {
    assert.equal(matchSpokenSuggestion('which projects have staffing gaps', suggestions), suggestions[2]);
  });

  await t.test('an unrelated phrase resolves to nothing instead of a wrong guess', () => {
    assert.equal(matchSpokenSuggestion('what is the weather in Hyderabad', suggestions), null);
  });

  await t.test('empty input resolves to nothing', () => {
    assert.equal(matchSpokenSuggestion('', suggestions), null);
    assert.equal(matchSpokenSuggestion(null, suggestions), null);
  });
});

test('Voice: locale tags are valid', async (t) => {
  await t.test('a normal tag is preserved', () => {
    assert.equal(speechLocale('en-IN'), 'en-IN');
    assert.equal(speechLocale('en'), 'en');
  });

  await t.test('a malformed tag falls back rather than throwing in the synthesiser', () => {
    assert.equal(speechLocale('not a locale!'), 'en-IN');
    assert.equal(speechLocale(undefined), 'en-IN');
  });
});

// ---------------------------------------------------------------------------
// Interface regressions found from a screenshot.
// ---------------------------------------------------------------------------

test('Interface: icon sizing does not depend on a Tailwind class that does not exist', async (t) => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..');

  await t.test('the icon component sets width and height as attributes', () => {
    const layout = fs.readFileSync(path.join(root, 'src/components/Layout.jsx'), 'utf8');
    // 'w-4.5 h-4.5' is not in Tailwind v3's spacing scale: it compiled to no rule, the <svg>
    // fell back to its 300x150 default, and the sidebar was swallowed by the icons.
    assert.match(layout, /<svg[\s\S]{0,200}width="18"/, 'the icon <svg> must have an explicit width');
    assert.match(layout, /<svg[\s\S]{0,200}height="18"/, 'the icon <svg> must have an explicit height');
    const code = layout.replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /w-4\.5|h-4\.5/, 'w-4.5/h-4.5 compile to nothing and must not size an icon');
  });

  await t.test('the sidebar can be collapsed and the choice is remembered', () => {
    const layout = fs.readFileSync(path.join(root, 'src/components/Layout.jsx'), 'utf8');
    assert.match(layout, /wiq\.sidebar\.collapsed/, 'the collapse preference is not persisted');
    assert.match(layout, /lg:grid-cols-\[68px_1fr\]/, 'no collapsed grid width');
  });
});

test('Interface: the navigation is pinned to the viewport, not the document', async (t) => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..');

  await t.test('the sidebar uses sticky positioning on desktop', () => {
    const layout = fs.readFileSync(path.join(root, 'src/components/Layout.jsx'), 'utf8');
    assert.match(layout, /lg:sticky/, 'the sidebar must be sticky, or it scrolls away with long pages');
    assert.match(layout, /lg:top-0/, 'a sticky element needs a top offset');
    assert.match(layout, /lg:self-start/, 'without self-start the grid stretches the sidebar and sticky has no effect');
    assert.doesNotMatch(layout, /lg:static lg:translate-x-0/, 'lg:static removes the sidebar from the scroll container');
  });

  await t.test('the sidebar still behaves as an overlay drawer on small screens', () => {
    const layout = fs.readFileSync(path.join(root, 'src/components/Layout.jsx'), 'utf8');
    assert.match(layout, /fixed inset-y-0 left-0/);
    assert.match(layout, /-translate-x-full/);
  });

  await t.test('the built stylesheet actually contains the sticky rule', () => {
    const dir = path.join(root, 'dist/assets');
    if (!fs.existsSync(dir)) return; // no build in this checkout; the source check above stands
    const css = fs.readdirSync(dir).filter((f) => f.endsWith('.css'))
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
    assert.match(css, /position:\s*sticky/, 'no sticky rule in the built CSS');
  });
});
