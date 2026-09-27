(() => {
  'use strict';

  const STORAGE_KEY = 'learnmytext.source.v1';
  const wordPattern = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:[’'][\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*/gu;
  const dashPattern = /[\p{Pd}\u00AD]/u;
  const dashSeparatorPattern = /^[\p{Zs}\t\p{Pd}\u00AD]+$/u;
  const apostropheSeparatorPattern = /^[\p{Zs}\t’']+$/u;
  const spaceSeparatorPattern = /^[\p{Zs}\t]+$/u;
  const elements = Object.fromEntries([
    'setup-view', 'practice-view', 'source-text', 'source-count', 'setup-error',
    'start-button', 'learn-tab', 'recite-tab', 'learn-panel', 'recite-panel',
    'edit-button', 'go-recite-button', 'learning-text', 'recitation-input',
    'recitation-highlight', 'recitation-feedback', 'recitation-progress', 'completion',
    'restart-button', 'help-button', 'close-help-button', 'help-dialog'
  ].map(id => [id, document.getElementById(id)]));

  let sourceWords = [];
  let sourceText = '';
  let composing = false;

  function normalize(word) {
    return word.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC')
      .replace(/\p{P}/gu, '').toLocaleLowerCase('fr');
  }

  function restoreSpelling(actual, expected) {
    const graphemes = /[\p{L}\p{N}]\p{M}*/gu;
    const actualGroups = [...actual.normalize('NFD').matchAll(graphemes)].map(match => match[0]);
    const expectedGroups = [...expected.normalize('NFD').matchAll(graphemes)].map(match => match[0]);
    if (actualGroups.length !== expectedGroups.length) return actual;
    let index = 0;
    return expected.normalize('NFD').replace(graphemes, expectedGroup => {
      const base = Array.from(actualGroups[index++])[0];
      const expectedBase = Array.from(expectedGroup)[0];
      return base + expectedGroup.slice(expectedBase.length);
    }).normalize('NFC');
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
        hyphenBefore: dashPattern.test(gap) && dashSeparatorPattern.test(gap),
        apostropheJoinBefore: apostropheSeparatorPattern.test(gap),
        spaceBefore: spaceSeparatorPattern.test(gap)
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

  function isUnfinishedWord(word, index, count, text) {
    return index === count && !/\s/u.test(text.slice(word.end));
  }

  function isPendingApostropheSplit(actual, expected, index, count) {
    return index === count && /[’']/.test(expected.text) &&
      normalize(expected.text.split(/[’']/)[0]) === actual.normalized;
  }

  // Word alignment prevents one omitted or extra word from marking every
  // following word as incorrect.
  function compareWords(written, text) {
    const referenceCount = sourceWords.length;
    const writtenCount = written.length;
    const width = writtenCount + 1;
    const size = (referenceCount + 1) * width;
    const costs = new Uint32Array(size);
    const matches = new Uint32Array(size);
    const steps = new Uint8Array(size); // 1: compare, 2: missing, 3: extra, 4: hyphen, 5: split apostrophe, 6: extra apostrophe
    const joinedSpans = new Uint16Array(size);
    const splitSpans = new Uint16Array(size);
    const spacedSpans = new Uint16Array(size);

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
        const unfinished = isUnfinishedWord(written[j - 1], j, writtenCount, text);
        const pendingSplit = isPendingApostropheSplit(written[j - 1], sourceWords[i - 1], j, writtenCount);
        const prefix = !exact && (unfinished || pendingSplit) && sourceWords[i - 1].normalized.startsWith(written[j - 1].normalized);
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

        // An apostrophe may have been replaced with a space: c'est / c est.
        let bestSplitSpan = 0;
        if (/[’']/.test(sourceWords[i - 1].text)) {
          const maxSpan = sourceWords[i - 1].text.match(/[’']/g).length + 1;
          let joinedWritten = written[j - 1].normalized;
          for (let span = 2; span <= Math.min(j, maxSpan) && written[j - span + 1].apostropheJoinBefore; span++) {
            joinedWritten = written[j - span].normalized + joinedWritten;
            const joinedExact = joinedWritten === sourceWords[i - 1].normalized;
            const joinedPrefix = !joinedExact && unfinished && sourceWords[i - 1].normalized.startsWith(joinedWritten);
            if (!joinedExact && !joinedPrefix) continue;
            const previous = (i - 1) * width + j - span;
            const splitCost = costs[previous];
            const splitMatches = matches[previous] + (joinedExact ? span * 2 : span);
            if (splitCost < bestCost || (splitCost === bestCost && splitMatches > bestMatches)) {
              bestCost = splitCost;
              bestMatches = splitMatches;
              bestStep = 5;
              bestSplitSpan = span;
            }
          }
        }

        // Likewise, an apostrophe typed between separate words is removed.
        let bestSpacedSpan = 0;
        if (/[’']/.test(written[j - 1].text)) {
          const maxSpan = written[j - 1].text.match(/[’']/g).length + 1;
          let joinedSource = sourceWords[i - 1].normalized;
          for (let span = 2; span <= Math.min(i, maxSpan) && sourceWords[i - span + 1].spaceBefore; span++) {
            joinedSource = sourceWords[i - span].normalized + joinedSource;
            const joinedExact = joinedSource === written[j - 1].normalized;
            const joinedPrefix = !joinedExact && unfinished && joinedSource.startsWith(written[j - 1].normalized);
            if (!joinedExact && !joinedPrefix) continue;
            const previous = (i - span) * width + j - 1;
            const spacedCost = costs[previous];
            const spacedMatches = matches[previous] + (joinedExact ? span * 2 : span);
            if (spacedCost < bestCost || (spacedCost === bestCost && spacedMatches > bestMatches)) {
              bestCost = spacedCost;
              bestMatches = spacedMatches;
              bestStep = 6;
              bestSpacedSpan = span;
            }
          }
        }

        costs[cell] = bestCost;
        matches[cell] = bestMatches;
        steps[cell] = bestStep;
        joinedSpans[cell] = bestSpan;
        splitSpans[cell] = bestSplitSpan;
        spacedSpans[cell] = bestSpacedSpan;
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
    const corrections = [];
    const aligned = new Array(referenceCount);
    let matchedWords = 0;
    let partial = false;
    let i = end;
    let j = writtenCount;
    while (i > 0 || j > 0) {
      const step = steps[i * width + j];
      if (step === 1) {
        const actual = written[j - 1];
        const expected = sourceWords[i - 1];
        const unfinished = isUnfinishedWord(actual, j, writtenCount, text) ||
          isPendingApostropheSplit(actual, expected, j, writtenCount);
        if (actual.normalized !== expected.normalized) {
          if (unfinished && expected.normalized.startsWith(actual.normalized)) partial = true;
          else errors.push({ word: actual, expected: expected.display });
        } else {
          aligned[i - 1] = j - 1;
          matchedWords++;
          const replacement = restoreSpelling(actual.text, expected.text);
          if (replacement !== actual.text) corrections.push({ start: actual.start, end: actual.end, replacement });
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
        else {
          matchedWords += span;
          const actual = written[j - 1];
          const reference = sourceText.slice(sourceWords[i - span].start, sourceWords[i - 1].end);
          const replacement = restoreSpelling(actual.text, reference);
          if (replacement !== actual.text) corrections.push({ start: actual.start, end: actual.end, replacement });
        }
        i -= span;
        j--;
      } else if (step === 5) {
        const span = splitSpans[i * width + j];
        const actual = written.slice(j - span, j);
        const expected = sourceWords[i - 1];
        const normalized = actual.map(word => word.normalized).join('');
        if (normalized !== expected.normalized) partial = true;
        else {
          matchedWords++;
          const start = actual[0].start;
          const end = actual.at(-1).end;
          const replacement = restoreSpelling(text.slice(start, end), expected.text);
          if (replacement !== text.slice(start, end)) corrections.push({ start, end, replacement });
        }
        i--;
        j -= span;
      } else if (step === 6) {
        const span = spacedSpans[i * width + j];
        const actual = written[j - 1];
        const expected = sourceWords.slice(i - span, i).map(word => word.normalized).join('');
        if (actual.normalized !== expected) partial = true;
        else {
          matchedWords += span;
          const reference = sourceText.slice(sourceWords[i - span].start, sourceWords[i - 1].end);
          const replacement = restoreSpelling(actual.text, reference);
          if (replacement !== actual.text) corrections.push({ start: actual.start, end: actual.end, replacement });
        }
        i -= span;
        j--;
      } else {
        errors.push({ word: written[j - 1], expected: null });
        j--;
      }
    }

    for (let index = 1; index < referenceCount; index++) {
      const left = aligned[index - 1];
      const right = aligned[index];
      if (left === undefined || right !== left + 1) continue;
      const sourceGap = sourceText.slice(sourceWords[index - 1].end, sourceWords[index].start);
      const actualGap = text.slice(written[left].end, written[right].start);
      if (sourceGap !== actualGap && (dashPattern.test(sourceGap) || dashPattern.test(actualGap))) {
        corrections.push({ start: written[left].end, end: written[right].start, replacement: sourceGap });
      }
    }

    return {
      errors: errors.reverse(), missing: missing.reverse(), corrections,
      matchedWords,
      complete: end === referenceCount && costs[end * width + writtenCount] === 0 && !partial
    };
  }

  function applyCorrections(corrections) {
    const editor = elements['recitation-input'];
    let selectionStart = editor.selectionStart;
    let selectionEnd = editor.selectionEnd;
    for (const correction of corrections.sort((a, b) => b.start - a.start)) {
      const delta = correction.replacement.length - (correction.end - correction.start);
      const adjusted = position => position >= correction.end ? position + delta
        : position > correction.start ? correction.start + correction.replacement.length : position;
      selectionStart = adjusted(selectionStart);
      selectionEnd = adjusted(selectionEnd);
      editor.setRangeText(correction.replacement, correction.start, correction.end, 'preserve');
    }
    editor.setSelectionRange(selectionStart, selectionEnd);
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
    let text = elements['recitation-input'].value;
    let written = extractWords(text);
    let result = composing ? { errors: [], missing: [], corrections: [], matchedWords: 0, complete: false } : compareWords(written, text);
    for (let pass = 0; pass < Math.min(sourceWords.length + 1, 20) && result.corrections.length; pass++) {
      applyCorrections(result.corrections);
      text = elements['recitation-input'].value;
      written = extractWords(text);
      result = compareWords(written, text);
    }
    renderHighlights(text, result.errors);

    const percentage = composing ? Number(elements['recitation-progress'].value)
      : result.complete ? 100 : Math.min(99, Math.round(result.matchedWords / sourceWords.length * 100));
    elements['recitation-progress'].value = percentage;

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
    sourceText = text;
    elements['learning-text'].textContent = text;
    elements['setup-view'].hidden = true;
    elements['practice-view'].hidden = false;
    resetRecitation();
    setMode('learn');
  }

  elements['source-text'].addEventListener('input', updateCount);
  elements['help-button'].addEventListener('click', () => elements['help-dialog'].showModal());
  elements['close-help-button'].addEventListener('click', () => elements['help-dialog'].close());
  elements['help-dialog'].addEventListener('click', event => {
    if (event.target === elements['help-dialog']) elements['help-dialog'].close();
  });
  elements['help-dialog'].addEventListener('close', () => elements['help-button'].focus());
  elements['start-button'].addEventListener('click', startPractice);
  elements['edit-button'].addEventListener('click', () => {
    elements['practice-view'].hidden = true;
    elements['setup-view'].hidden = false;
    elements['source-text'].focus();
  });
  elements['learn-tab'].addEventListener('click', () => setMode('learn'));
  elements['recite-tab'].addEventListener('click', () => setMode('recite'));
  elements['go-recite-button'].addEventListener('click', () => setMode('recite'));
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
