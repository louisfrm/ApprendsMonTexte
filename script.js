(() => {
  'use strict';

  const STORAGE_KEY = 'learnmytext.source.v1';
  const wordPattern = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:[’'][\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*/gu;
  const dashPattern = /[\p{Pd}\u00AD]/u;
  const dashSeparatorPattern = /^[\p{Zs}\t\p{Pd}\u00AD]+$/u;
  const elements = Object.fromEntries([
    'setup-view', 'practice-view', 'source-text', 'source-count', 'setup-error',
    'start-button', 'learn-tab', 'recite-tab', 'learn-panel', 'recite-panel',
    'edit-button', 'go-recite-button', 'learning-text', 'recitation-input',
    'recitation-highlight', 'recitation-feedback', 'completion',
    'restart-button', 'show-text-button'
  ].map(id => [id, document.getElementById(id)]));

  let sourceWords = [];
  let composing = false;

  function normalize(word) {
    return word.normalize('NFD').replace(/\u0302/gu, '').normalize('NFC')
      .replace(/\p{P}/gu, '').toLocaleLowerCase('fr');
  }

  function extractWords(text) {
    const matches = [...text.matchAll(wordPattern)];
    const words = matches.map((match, index) => {
      const start = match.index;
      const previous = matches[index - 1];
      const gap = previous ? text.slice(previous.index + previous[0].length, start) : '';
      return {
        text: match[0], start, end: start + match[0].length,
        normalized: normalize(match[0]),
        hyphenBefore: dashPattern.test(gap) && dashSeparatorPattern.test(gap)
      };
    });
    for (let first = 0; first < words.length;) {
      let last = first;
      while (last + 1 < words.length && words[last + 1].hyphenBefore) last++;
      const display = text.slice(words[first].start, words[last].end);
      for (let index = first; index <= last; index++) words[index].display = display;
      first = last + 1;
    }
    return words;
  }

  function updateCount() {
    const count = extractWords(elements['source-text'].value).length;
    elements['source-count'].textContent = `${count} mot${count > 1 ? 's' : ''}`;
    elements['setup-error'].hidden = true;
    try { localStorage.setItem(STORAGE_KEY, elements['source-text'].value); } catch { /* Storage may be unavailable. */ }
  }

  function setMode(mode) {
    const learning = mode === 'learn';
    elements['learn-panel'].hidden = !learning;
    elements['recite-panel'].hidden = learning;
    elements['learn-tab'].setAttribute('aria-selected', String(learning));
    elements['recite-tab'].setAttribute('aria-selected', String(!learning));
    elements['learn-tab'].tabIndex = learning ? 0 : -1;
    elements['recite-tab'].tabIndex = learning ? -1 : 0;
    if (!learning) elements['recitation-input'].focus();
  }

  // Word alignment prevents one omitted or extra word from marking every
  // following word as incorrect.
  function compareWords(written, textLength) {
    const referenceCount = sourceWords.length;
    const writtenCount = written.length;
    const width = writtenCount + 1;
    const size = (referenceCount + 1) * width;
    const costs = new Uint32Array(size);
    const matches = new Uint32Array(size);
    const steps = new Uint8Array(size); // 1: compare, 2: missing, 3: extra, 4: hyphenated compound
    const joinedSpans = new Uint16Array(size);

    for (let i = 1; i <= referenceCount; i++) {
      costs[i * width] = i;
      steps[i * width] = 2;
    }
    for (let j = 1; j <= writtenCount; j++) {
      costs[j] = j;
      steps[j] = 3;
    }

    for (let i = 1; i <= referenceCount; i++) {
      for (let j = 1; j <= writtenCount; j++) {
        const cell = i * width + j;
        const before = cell - width - 1;
        const exact = sourceWords[i - 1].normalized === written[j - 1].normalized;
        const unfinished = j === writtenCount && written[j - 1].end === textLength;
        const prefix = !exact && unfinished && sourceWords[i - 1].normalized.startsWith(written[j - 1].normalized);
        let bestCost = costs[before] + (exact || prefix ? 0 : 1);
        let bestMatches = matches[before] + (exact ? 2 : prefix ? 1 : 0);
        let bestStep = 1;

        const missingCost = costs[cell - width] + 1;
        const missingMatches = matches[cell - width];
        if (missingCost < bestCost || (missingCost === bestCost && missingMatches > bestMatches)) {
          bestCost = missingCost;
          bestMatches = missingMatches;
          bestStep = 2;
        }

        const extraCost = costs[cell - 1] + 1;
        const extraMatches = matches[cell - 1];
        if (extraCost < bestCost || (extraCost === bestCost && extraMatches > bestMatches)) {
          bestCost = extraCost;
          bestMatches = extraMatches;
          bestStep = 3;
        }

        // A hyphenated compound may also be typed without its dashes or with
        // spaces: sur-le-champ, sur le champ and surlechamp are equivalent.
        let joined = sourceWords[i - 1].normalized;
        let bestSpan = 0;
        for (let span = 2; span <= i && sourceWords[i - span + 1].hyphenBefore; span++) {
          joined = sourceWords[i - span].normalized + joined;
          const joinedExact = joined === written[j - 1].normalized;
          const joinedPrefix = !joinedExact && unfinished && joined.startsWith(written[j - 1].normalized);
          if (!joinedExact && !joinedPrefix) continue;
          const previous = (i - span) * width + j - 1;
          const joinedCost = costs[previous];
          const joinedMatches = matches[previous] + (joinedExact ? span * 2 : span);
          if (joinedCost < bestCost || (joinedCost === bestCost && joinedMatches > bestMatches)) {
            bestCost = joinedCost;
            bestMatches = joinedMatches;
            bestStep = 4;
            bestSpan = span;
          }
        }

        costs[cell] = bestCost;
        matches[cell] = bestMatches;
        steps[cell] = bestStep;
        joinedSpans[cell] = bestSpan;
      }
    }

    // The unspoken end of the reference is free: compare only what is typed.
    let end = 0;
    for (let i = 1; i <= referenceCount; i++) {
      const candidate = i * width + writtenCount;
      const previous = end * width + writtenCount;
      if (costs[candidate] < costs[previous] ||
          (costs[candidate] === costs[previous] && matches[candidate] >= matches[previous])) end = i;
    }

    const errors = [];
    const missing = [];
    let partial = false;
    let i = end;
    let j = writtenCount;
    while (i > 0 || j > 0) {
      const step = steps[i * width + j];
      if (step === 1) {
        const actual = written[j - 1];
        const expected = sourceWords[i - 1];
        const unfinished = j === writtenCount && actual.end === textLength;
        if (actual.normalized !== expected.normalized) {
          if (unfinished && expected.normalized.startsWith(actual.normalized)) partial = true;
          else errors.push({ word: actual, expected: expected.display });
        }
        i--;
        j--;
      } else if (step === 2) {
        missing.push(sourceWords[i - 1].display);
        i--;
      } else if (step === 4) {
        const span = joinedSpans[i * width + j];
        const expected = sourceWords.slice(i - span, i).map(word => word.normalized).join('');
        if (written[j - 1].normalized !== expected) partial = true;
        i -= span;
        j--;
      } else {
        errors.push({ word: written[j - 1], expected: null });
        j--;
      }
    }

    return {
      errors: errors.reverse(), missing: missing.reverse(),
      complete: end === referenceCount && costs[end * width + writtenCount] === 0 && !partial
    };
  }

  function renderHighlights(text, errors) {
    const fragment = document.createDocumentFragment();
    let position = 0;
    for (const error of errors) {
      fragment.append(document.createTextNode(text.slice(position, error.word.start)));
      const marker = document.createElement('mark');
      marker.className = 'incorrect-word';
      marker.textContent = text.slice(error.word.start, error.word.end);
      fragment.append(marker);
      position = error.word.end;
    }
    fragment.append(document.createTextNode(text.slice(position) + '\u200b'));
    elements['recitation-highlight'].replaceChildren(fragment);
    elements['recitation-highlight'].scrollTop = elements['recitation-input'].scrollTop;
    elements['recitation-highlight'].scrollLeft = elements['recitation-input'].scrollLeft;
  }

  function updateRecitation() {
    const text = elements['recitation-input'].value;
    const written = extractWords(text);
    const result = composing ? { errors: [], missing: [], complete: false } : compareWords(written, text.length);
    renderHighlights(text, result.errors);

    const feedback = elements['recitation-feedback'];
    const lastError = result.errors.at(-1);
    if (lastError) {
      feedback.textContent = lastError.expected
        ? `« ${lastError.word.text} » → « ${lastError.expected} »`
        : `« ${lastError.word.text} » : mot en trop.`;
      feedback.classList.add('has-error');
    } else if (result.missing.length) {
      feedback.textContent = `Mot manquant : « ${result.missing[0]} ».`;
      feedback.classList.add('has-error');
    } else {
      feedback.textContent = '';
      feedback.classList.remove('has-error');
    }

    elements['completion'].hidden = !result.complete;
  }

  function resetRecitation() {
    elements['recitation-input'].value = '';
    updateRecitation();
    if (!elements['recite-panel'].hidden) elements['recitation-input'].focus();
  }

  function startPractice() {
    const text = elements['source-text'].value.trim();
    const parsed = extractWords(text);
    if (!parsed.length) {
      elements['setup-error'].textContent = 'Ajoute au moins un mot pour commencer.';
      elements['setup-error'].hidden = false;
      elements['source-text'].focus();
      return;
    }
    sourceWords = parsed;
    elements['learning-text'].textContent = text;
    elements['setup-view'].hidden = true;
    elements['practice-view'].hidden = false;
    resetRecitation();
    setMode('learn');
  }

  elements['source-text'].addEventListener('input', updateCount);
  elements['start-button'].addEventListener('click', startPractice);
  elements['edit-button'].addEventListener('click', () => {
    elements['practice-view'].hidden = true;
    elements['setup-view'].hidden = false;
    elements['source-text'].focus();
  });
  elements['learn-tab'].addEventListener('click', () => setMode('learn'));
  elements['recite-tab'].addEventListener('click', () => setMode('recite'));
  elements['go-recite-button'].addEventListener('click', () => setMode('recite'));
  elements['show-text-button'].addEventListener('click', () => setMode('learn'));
  elements['restart-button'].addEventListener('click', resetRecitation);
  elements['recitation-input'].addEventListener('input', updateRecitation);
  elements['recitation-input'].addEventListener('scroll', () => {
    elements['recitation-highlight'].scrollTop = elements['recitation-input'].scrollTop;
    elements['recitation-highlight'].scrollLeft = elements['recitation-input'].scrollLeft;
  });
  elements['recitation-input'].addEventListener('compositionstart', () => { composing = true; });
  elements['recitation-input'].addEventListener('compositionend', () => { composing = false; updateRecitation(); });

  try { elements['source-text'].value = localStorage.getItem(STORAGE_KEY) || ''; } catch { /* Storage may be unavailable. */ }
  updateCount();
})();
