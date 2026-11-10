/**
 * Small helpers for the voice/assistant layer. Pure functions only — no DOM, no React —
 * so they can be unit-tested with node:test.
 */

/**
 * Strip formatting from an answer so a speech synthesiser reads it naturally.
 *
 * Answers are written for the eye: they contain markdown emphasis, bullet glyphs, arrows,
 * table pipes and parenthesised citations. Read aloud verbatim, those become noise
 * ("asterisk asterisk", "greater than"). This keeps the words and the numbers, drops the
 * typography, and collapses whitespace.
 */
export function toSpeechText(input) {
  if (input == null) return '';
  let text = String(input);

  // Code fences and inline code: keep the contents, drop the fences.
  text = text.replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ' '));
  text = text.replace(/`([^`]*)`/g, '$1');
  // Markdown emphasis and headings.
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(\*|_)(.*?)\1/g, '$2');
  text = text.replace(/^#{1,6}\s*/gm, '');
  // Link syntax: keep the label.
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Bullets and arrows become pauses, so the reader breaks where the writer meant.
  text = text.replace(/^[ \t]*[-*•][ \t]+/gm, '');
  text = text.replace(/[ \t]*(→|->|=>)[ \t]*/g, ', ');
  // Table pipes. The edge pipes must go before the inner ones are converted, otherwise a
  // row like "| Nov | 65.6 |" becomes "Nov, 65.6," and the trailing comma is read as a
  // dangling pause. Order is the whole fix here.
  text = text.replace(/^[ \t]*\|/gm, '');
  text = text.replace(/\|[ \t]*$/gm, '');
  text = text.replace(/[ \t]*\|[ \t]*/g, ', ');
  text = text.replace(/,[ \t]*$/gm, '');
  // A row ending in a pipe leaves a leading space on the next line once the edges go.
  text = text.replace(/[ \t]*\n[ \t]*(?=\S)/g, '\n');
  // No doubled separators, and never a sentence starting with one.
  text = text.replace(/([,;:])(\s*[,;:])+/g, '$1');
  text = text.replace(/^[,;:]\s*/gm, '');
  text = text.replace(/,\s*\./g, '.');
  // Collapse runs of spaces and tabs, but keep line structure so paragraphs survive.
  text = text.replace(/[ \t]{2,}/g, ' ');
  text = text.replace(/[ \t]+$/gm, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

/**
 * Turn a full assistant response into what should actually be spoken.
 *
 * Deliberately shorter than what is displayed: the spoken summary gives the answer, the
 * figure, the period and — only when it matters — the caveat. Evidence and limitations stay
 * on screen. Reading an entire evidence block aloud is how voice assistants become hated.
 */
export function speechSummary(answer) {
  if (!answer) return '';
  if (answer.blocked) return toSpeechText(answer.answer);

  const parts = [];
  const body = toSpeechText(answer.answer);
  parts.push(body);

  if (answer.insufficient) {
    parts.push('This is based on incomplete data, so treat it as indicative rather than final.');
  } else if (answer.confidence === 'low') {
    parts.push('Confidence in this answer is low.');
  }

  if (answer.limitations?.length) {
    // One caveat maximum, spoken. The rest are on screen.
    parts.push(`One limitation: ${toSpeechText(answer.limitations[0])}`);
  }

  return parts.join(' ').trim();
}

/** Match a spoken phrase against a list of suggestions, returning the closest one. */
export function matchSpokenSuggestion(spoken, suggestions = []) {
  const normalise = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const said = normalise(spoken);
  if (!said) return null;
  let best = null;
  let bestScore = 0;
  for (const suggestion of suggestions) {
    const words = new Set(normalise(suggestion).split(' ').filter((w) => w.length > 3));
    const saidWords = new Set(said.split(' ').filter((w) => w.length > 3));
    if (!words.size) continue;
    let shared = 0;
    for (const w of words) if (saidWords.has(w)) shared += 1;
    const score = shared / words.size;
    if (score > bestScore) { bestScore = score; best = suggestion; }
  }
  return bestScore >= 0.5 ? best : null;
}

/** BCP-47 tag for speech synthesis, derived from the browser's locale. */
export function speechLocale(navigatorLanguage) {
  const tag = String(navigatorLanguage || 'en-IN');
  // A bare "en" is fine; a malformed tag falls back rather than throwing in SpeechSynthesis.
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i.test(tag) ? tag : 'en-IN';
}

/**
 * Choose a speech voice.
 *
 * Priority: the voice the user picked by name, then an English voice from India, then any
 * English voice, then the platform default. The Indian-English preference is a default, not a
 * constraint — an explicit choice always wins, and the list is offered in the interface.
 */
export function pickVoice(voices = [], chosenName = '') {
  if (!Array.isArray(voices) || voices.length === 0) return null;
  if (chosenName) {
    const chosen = voices.find((v) => v.name === chosenName);
    if (chosen) return chosen;
  }
  const indian = voices.find((v) => /^en[-_]IN$/i.test(v.lang));
  if (indian) return indian;
  const localIndian = voices.find((v) => /^en[-_]IN$/i.test(v.lang) && v.localService);
  if (localIndian) return localIndian;
  const english = voices.find((v) => /^en([-_]|$)/i.test(v.lang));
  return english || voices[0] || null;
}

/** Group voices for a picker, preferring a short, useful list over 200 system defaults. */
export function groupVoices(voices = []) {
  const list = Array.isArray(voices) ? voices : [];
  return {
    indian: list.filter((v) => /^en[-_]IN$/i.test(v.lang)),
    english: list.filter((v) => /^en/i.test(v.lang) && !/^en[-_]IN$/i.test(v.lang)),
    other: list.filter((v) => !/^en/i.test(v.lang)),
  };
}
