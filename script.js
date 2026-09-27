(() => {
  'use strict';

  const STORAGE_KEY = 'learnmytext.source.v1';
  const wordPattern = /[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu;
  const elements = Object.fromEntries([
    'setup-view', 'practice-view', 'source-text', 'source-count', 'setup-error',
    'start-button', 'learn-tab', 'recite-tab', 'learn-panel', 'recite-panel',
    'edit-button', 'go-recite-button', 'learning-text', 'masked-text',
    'progress-label', 'progress-fill', 'answer-area', 'answer-input',
    'check-button', 'feedback', 'completion', 'restart-button', 'show-text-button'
  ].map(id => [id, document.getElementById(id)]));

  let source = '';
  let words = [];
  let currentIndex = 0;
  let mistakeShownFor = -1;

  function extractWords(text) {
    return [...text.matchAll(wordPattern)].map(match => ({ text: match[0], index: match.index }));
  }

  function normalize(word) {
    return word.normalize('NFC').replace(/\p{P}/gu, '').toLocaleLowerCase('fr');
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
    if (!learning && currentIndex < words.length) elements['answer-input'].focus();
  }

  function renderMaskedText() {
    const fragment = document.createDocumentFragment();
    words.forEach((word, index) => {
      if (index > 0 && /\n/.test(source.slice(words[index - 1].index + words[index - 1].text.length, word.index))) {
        const lineBreak = document.createElement('span');
        lineBreak.className = 'mask-break';
        lineBreak.setAttribute('aria-hidden', 'true');
        fragment.append(lineBreak);
      }
      const token = document.createElement('span');
      token.className = 'mask-token ' + (index < currentIndex ? 'is-done' : index === currentIndex ? 'is-hidden is-current' : 'is-hidden');
      token.textContent = index < currentIndex ? word.text : '';
      token.setAttribute('aria-label', index < currentIndex ? word.text : index === currentIndex ? 'mot en cours' : 'mot masqué');
      fragment.append(token);
    });
    elements['masked-text'].replaceChildren(fragment);
  }

  function updateProgress() {
    const total = words.length;
    elements['progress-label'].textContent = `${currentIndex} / ${total} mot${total > 1 ? 's' : ''}`;
    const percent = total ? Math.round(currentIndex / total * 100) : 0;
    elements['progress-fill'].style.width = `${percent}%`;
    elements['progress-fill'].parentElement.setAttribute('aria-valuenow', String(percent));
    elements['answer-area'].hidden = currentIndex >= total;
    elements['completion'].hidden = currentIndex < total;
  }

  function clearFeedback() {
    elements['feedback'].textContent = '';
    elements['feedback'].classList.remove('is-error');
  }

  function showMistake() {
    if (mistakeShownFor === currentIndex) return;
    mistakeShownFor = currentIndex;
    const expected = words[currentIndex]?.text;
    if (!expected) return;
    elements['feedback'].classList.add('is-error');
    elements['feedback'].replaceChildren('Il y a une faute. Le bon mot est « ', Object.assign(document.createElement('strong'), { textContent: expected }), ' ».');
  }

  function resetRecitation() {
    currentIndex = 0;
    mistakeShownFor = -1;
    elements['answer-input'].value = '';
    clearFeedback();
    renderMaskedText();
    updateProgress();
    if (!elements['recite-panel'].hidden) elements['answer-input'].focus();
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
    source = text;
    words = parsed;
    elements['learning-text'].textContent = text;
    elements['setup-view'].hidden = true;
    elements['practice-view'].hidden = false;
    resetRecitation();
    setMode('learn');
  }

  function checkAnswer() {
    if (currentIndex >= words.length) return;
    const answer = elements['answer-input'].value.trim();
    if (!answer) return;
    const normalizedAnswer = normalize(answer);
    if (!normalizedAnswer) return;
    if (normalizedAnswer !== normalize(words[currentIndex].text)) {
      showMistake();
      elements['answer-input'].select();
      return;
    }
    currentIndex += 1;
    mistakeShownFor = -1;
    elements['answer-input'].value = '';
    clearFeedback();
    renderMaskedText();
    updateProgress();
    if (currentIndex < words.length) elements['answer-input'].focus();
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
  elements['check-button'].addEventListener('click', checkAnswer);
  elements['answer-input'].addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      checkAnswer();
    }
  });
  elements['answer-input'].addEventListener('input', () => {
    if (currentIndex >= words.length || mistakeShownFor === currentIndex) return;
    const typed = normalize(elements['answer-input'].value.trim());
    const expected = normalize(words[currentIndex].text);
    if (typed && !expected.startsWith(typed)) showMistake();
  });

  try { elements['source-text'].value = localStorage.getItem(STORAGE_KEY) || ''; } catch { /* Storage may be unavailable. */ }
  updateCount();
})();
