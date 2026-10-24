import { analyzeMistake, gradeExam, gradeQuestion, sampleExam } from './quiz-core.js';
import { clearState, loadState, recordExamResults, recordStudyResult, saveState } from './storage.js';

const bank = window.QUESTION_BANK;
const types = ['single', 'multi', 'judge'];
const typeLabels = { single: '单选题', multi: '多选题', judge: '判断题' };
const allQuestions = types.flatMap((type) => bank[type]);
const questionById = new Map(allQuestions.map((question) => [question.id, question]));
let storage = null;
try {
  storage = window.localStorage;
} catch {
  // The quiz remains usable in memory when browser storage is unavailable.
}
let state = loadState(storage);
let studySession = null;
let lastReport = null;
let toastTimer = null;
let storageWarningShown = false;

const $ = (id) => document.getElementById(id);
const views = [...document.querySelectorAll('.view')];

function persist() {
  if (!saveState(storage, state) && !storageWarningShown) {
    storageWarningShown = true;
    showToast('当前浏览器无法保存记录，本次仍可继续答题。');
  }
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function showView(id) {
  for (const view of views) {
    const active = view.id === id;
    view.hidden = !active;
    view.classList.toggle('active', active);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function answerText(question, answer) {
  if (!answer) return '未作答';
  return [...answer].map((letter) => `${letter}. ${question.options[letter] ?? ''}`).join('；');
}

function selectedLetters(container) {
  return [...container.querySelectorAll('input:checked')].map((input) => input.value);
}

function questionMarkup(question, selected = [], disabled = false) {
  const inputType = question.type === 'multi' ? 'checkbox' : 'radio';
  const options = Object.entries(question.options).map(([letter, text]) => `
    <label class="option" data-letter="${letter}">
      <input type="${inputType}" name="answer" value="${letter}" ${selected.includes(letter) ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <span class="option-letter">${letter}</span>
      <span>${escapeHtml(text)}</span>
    </label>`).join('');
  return `
    <div class="question-meta">
      <span class="type-badge">${typeLabels[question.type]}</span>
      <span class="question-number">原题号 ${escapeHtml(String(question.number))}</span>
    </div>
    <div class="question-stem">${escapeHtml(question.stem)}</div>
    <div class="options">${options}</div>`;
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function updateHome() {
  $('stat-total').textContent = allQuestions.length;
  $('stat-single').textContent = bank.single.length;
  $('stat-multi').textContent = bank.multi.length;
  $('stat-judge').textContent = bank.judge.length;
  $('wrong-count').textContent = state.wrongIds.length;
  $('wrong-study-button').disabled = state.wrongIds.length === 0;
  $('resume-exam-button').hidden = !state.exam;
  $('study-filter-select').value = state.study.filter === 'wrong' ? 'all' : state.study.filter;
  for (const type of types) $('exam-' + type + '-count').value = state.settings[type];
  const studyFilter = state.study.filter;
  const studyQuestions = questionsForStudy(studyFilter);
  const activeIndex = state.study.active?.filter === studyFilter
    ? studyQuestions.findIndex((question) => question.id === state.study.active.questionId) : -1;
  const savedIndex = Math.min(Number(state.study.positions[studyFilter] ?? 0), Math.max(studyQuestions.length - 1, 0));
  const studyIndex = activeIndex >= 0 ? activeIndex : savedIndex;
  const learnedCount = Object.keys(state.study.results).length;
  const studyLabel = studyFilter === 'all' ? '全部题型' : studyFilter === 'wrong' ? '错题' : typeLabels[studyFilter];
  $('study-summary-text').textContent = !learnedCount
    ? '尚未开始学习。'
    : studyQuestions.length
      ? `学习进度：${studyLabel}第 ${studyIndex + 1}/${studyQuestions.length} 题，已有 ${learnedCount} 道答题记录。`
      : `已有 ${learnedCount} 道答题记录，当前没有累计错题。`;
  $('last-result-text').textContent = state.lastExam
    ? `最近一次：${state.lastExam.correctCount}/${state.lastExam.totalCount} 题正确，正确率 ${state.lastExam.accuracy}%。累计错题 ${state.wrongIds.length} 道。`
    : `还没有考试记录。当前累计错题 ${state.wrongIds.length} 道。`;
}

function goHome() {
  updateHome();
  showView('home-view');
}

function questionsForStudy(filter) {
  if (filter === 'all') return allQuestions;
  if (filter === 'wrong') return state.wrongIds.map((id) => questionById.get(id)).filter(Boolean);
  return bank[filter] ?? [];
}

function startStudy(filter, ids = null, resume = false) {
  const questions = ids ? ids.map((id) => questionById.get(id)).filter(Boolean) : questionsForStudy(filter);
  if (!questions.length) {
    showToast(filter === 'wrong' ? '当前没有错题，继续保持。' : '该范围没有可学习的题目。');
    return;
  }
  state.study.filter = filter;
  let index = 0;
  if (resume) {
    const activeId = state.study.active?.filter === filter ? state.study.active.questionId : null;
    const activeIndex = activeId ? questions.findIndex((question) => question.id === activeId) : -1;
    const savedIndex = filter === 'wrong' ? 0 : Number(state.study.positions[filter] ?? 0);
    index = activeIndex >= 0 ? activeIndex : Math.min(Math.max(savedIndex, 0), questions.length - 1);
  } else {
    state.study.positions[filter] = 0;
    state.study.active = null;
  }
  studySession = { questions, filter, index, checked: false };
  persist();
  renderStudy();
  showView('study-view');
}

function renderStudy() {
  const { questions, index } = studySession;
  const question = questions[index];
  $('study-title').textContent = studySession.filter === 'wrong' ? '错题学习' : `${typeLabels[question.type]}学习`;
  $('study-progress-text').textContent = `第 ${index + 1} 题 / 共 ${questions.length} 题`;
  $('study-progress-bar').style.width = `${((index + 1) / questions.length) * 100}%`;
  const active = state.study.active?.filter === studySession.filter
    && state.study.active.questionId === question.id ? state.study.active : null;
  const selected = active?.selected ?? [];
  $('study-question-card').innerHTML = questionMarkup(question, selected, Boolean(active?.checked));
  $('study-feedback').hidden = true;
  $('study-feedback').className = 'feedback';
  $('study-prev-button').disabled = index === 0;
  $('study-next-button').disabled = !active?.checked;
  $('study-next-button').textContent = index === questions.length - 1 ? '完成学习' : '下一题';
  studySession.checked = Boolean(active?.checked);
  if (studySession.checked) showStudyFeedback(question, selected);
  else for (const input of $('study-question-card').querySelectorAll('input')) input.addEventListener('change', saveCurrentStudyAnswer);
}

function saveCurrentStudyAnswer() {
  const question = studySession.questions[studySession.index];
  state.study.active = {
    filter: studySession.filter,
    questionId: question.id,
    selected: selectedLetters($('study-question-card')),
    checked: false,
  };
  persist();
}

function showStudyFeedback(question, selected) {
  const result = gradeQuestion(question, selected);
  const analysis = analyzeMistake(question, selected);
  const feedback = $('study-feedback');
  feedback.hidden = false;
  feedback.classList.toggle('incorrect', !result.correct);
  feedback.innerHTML = result.correct
    ? `<strong>回答正确</strong><span>正确答案：${escapeHtml(answerText(question, result.correctAnswer))}</span>`
    : `<strong>${mistakeLabel(analysis.kind)}</strong><span>你的答案：${escapeHtml(answerText(question, result.selected))}<br>正确答案：${escapeHtml(answerText(question, result.correctAnswer))}</span>`;
  markOptions($('study-question-card'), result.correctAnswer, result.selected);
}

function checkStudyAnswer() {
  if (studySession.checked) return;
  const question = studySession.questions[studySession.index];
  const selected = selectedLetters($('study-question-card'));
  if (!selected.length) {
    showToast('请先选择答案。');
    return;
  }
  const result = gradeQuestion(question, selected);
  state = recordStudyResult(state, { questionId: question.id, correct: result.correct });
  state.study.active = { filter: studySession.filter, questionId: question.id, selected, checked: true };
  persist();
  studySession.checked = true;
  showStudyFeedback(question, selected);
  for (const input of $('study-question-card').querySelectorAll('input')) input.disabled = true;
  $('study-next-button').disabled = false;
}

function markOptions(container, correctAnswer, selected) {
  for (const option of container.querySelectorAll('.option')) {
    const letter = option.dataset.letter;
    option.classList.toggle('correct-option', correctAnswer.includes(letter));
    option.classList.toggle('wrong-option', selected.includes(letter) && !correctAnswer.includes(letter));
  }
}

function moveStudy(delta) {
  const nextIndex = studySession.index + delta;
  if (nextIndex >= studySession.questions.length) {
    state.study.positions[studySession.filter] = 0;
    state.study.active = null;
    persist();
    showToast('本轮学习已完成。');
    goHome();
    return;
  }
  studySession.index = Math.max(0, nextIndex);
  state.study.positions[studySession.filter] = studySession.index;
  state.study.active = null;
  persist();
  renderStudy();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function startExam() {
  const counts = Object.fromEntries(types.map((type) => [type, Number($('exam-' + type + '-count').value)]));
  try {
    const questions = sampleExam(bank, counts);
    state.settings = counts;
    state.exam = { questionIds: questions.map((question) => question.id), index: 0, answers: {} };
    persist();
    renderExam();
    showView('exam-view');
  } catch (error) {
    showToast(error.message);
  }
}

function resumeExam() {
  if (!state.exam) return;
  state.exam.questionIds = state.exam.questionIds.filter((id) => questionById.has(id));
  if (!state.exam.questionIds.length) {
    state.exam = null;
    persist();
    updateHome();
    showToast('未完成考试无法恢复，请重新组卷。');
    return;
  }
  state.exam.index = Math.min(state.exam.index, state.exam.questionIds.length - 1);
  renderExam();
  showView('exam-view');
}

function currentExamQuestion() {
  return questionById.get(state.exam.questionIds[state.exam.index]);
}

function renderExam() {
  const question = currentExamQuestion();
  const total = state.exam.questionIds.length;
  const selected = state.exam.answers[question.id] ?? [];
  $('exam-progress-text').textContent = `第 ${state.exam.index + 1} 题 / 共 ${total} 题`;
  $('exam-progress-bar').style.width = `${((state.exam.index + 1) / total) * 100}%`;
  $('exam-question-card').innerHTML = questionMarkup(question, selected);
  $('exam-prev-button').disabled = state.exam.index === 0;
  const atEnd = state.exam.index === total - 1;
  $('exam-next-button').hidden = atEnd;
  $('submit-exam-button').hidden = !atEnd;
  updateExamAnswered();
  for (const input of $('exam-question-card').querySelectorAll('input')) input.addEventListener('change', saveCurrentExamAnswer);
}

function saveCurrentExamAnswer() {
  const question = currentExamQuestion();
  state.exam.answers[question.id] = selectedLetters($('exam-question-card'));
  persist();
  updateExamAnswered();
}

function updateExamAnswered() {
  const answered = Object.values(state.exam.answers).filter((answer) => answer?.length).length;
  $('exam-answered-text').textContent = `已答 ${answered}/${state.exam.questionIds.length}`;
}

function moveExam(delta) {
  saveCurrentExamAnswer();
  state.exam.index = Math.min(Math.max(state.exam.index + delta, 0), state.exam.questionIds.length - 1);
  persist();
  renderExam();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function submitExam() {
  saveCurrentExamAnswer();
  const questions = state.exam.questionIds.map((id) => questionById.get(id)).filter(Boolean);
  const unanswered = questions.filter((question) => !(state.exam.answers[question.id] ?? []).length).length;
  if (unanswered && !window.confirm(`还有 ${unanswered} 道题未作答，确定交卷吗？`)) return;
  lastReport = gradeExam(questions, state.exam.answers);
  const mistakeIds = new Set(lastReport.mistakes.map((mistake) => mistake.question.id));
  state = recordExamResults(state, questions.map((question) => ({
    questionId: question.id,
    correct: !mistakeIds.has(question.id),
  })));
  state.lastExam = {
    correctCount: lastReport.correctCount,
    totalCount: lastReport.totalCount,
    score: lastReport.score,
    maxScore: lastReport.maxScore,
    accuracy: lastReport.accuracy,
    mistakeIds: lastReport.mistakes.map((mistake) => mistake.question.id),
  };
  state.exam = null;
  persist();
  renderResults(lastReport);
  showView('results-view');
}

function mistakeLabel(kind) {
  return ({
    unanswered: '未作答', wrong: '选择错误', missed: '存在漏选', extra: '存在多选', 'missed-and-extra': '既有漏选，也有错选',
  })[kind] ?? '答案不正确';
}

function renderResults(report) {
  $('result-accuracy').textContent = `${report.accuracy}%`;
  $('result-summary').textContent = `答对 ${report.correctCount}/${report.totalCount} 题，得分 ${report.score}/${report.maxScore}。`;
  $('result-type-grid').innerHTML = types.map((type) => {
    const summary = report.byType[type];
    return `<article><strong>${summary.accuracy}%</strong><span>${typeLabels[type]} · ${summary.correctCount}/${summary.totalCount}</span></article>`;
  }).join('');
  $('result-mistake-count').textContent = `${report.mistakes.length} 道错题`;
  $('review-result-mistakes-button').disabled = report.mistakes.length === 0;
  $('results-container').innerHTML = report.mistakes.length
    ? report.mistakes.map((mistake, index) => mistakeMarkup(mistake, index)).join('')
    : '<div class="empty-state"><strong>全部回答正确</strong><p>本次没有错题，可以重新组卷继续巩固。</p></div>';
}

function mistakeMarkup(mistake, index) {
  const question = mistake.question;
  const options = Object.entries(question.options).map(([letter, text]) => `<li><strong>${letter}.</strong> ${escapeHtml(text)}</li>`).join('');
  return `<article class="mistake-card">
    <span class="type-badge">${typeLabels[question.type]} · ${mistakeLabel(mistake.kind)}</span>
    <h4>${index + 1}. ${escapeHtml(question.stem)}</h4>
    <div class="answer-compare">
      <div class="answer-box wrong"><strong>你的答案</strong><br>${escapeHtml(answerText(question, mistake.selected))}</div>
      <div class="answer-box correct"><strong>正确答案</strong><br>${escapeHtml(answerText(question, mistake.correctAnswer))}</div>
    </div>
    <ul class="mistake-options">${options}</ul>
  </article>`;
}

function clearRecords() {
  if (!window.confirm('确定清空当前浏览器中的学习进度、考试记录和错题吗？')) return;
  state = clearState(storage);
  studySession = null;
  lastReport = null;
  updateHome();
  showToast('本机记录已清空。');
}

$('home-button').addEventListener('click', goHome);
for (const button of document.querySelectorAll('[data-action="exit-home"]')) button.addEventListener('click', goHome);
$('study-mode-button').addEventListener('click', () => startStudy($('study-filter-select').value));
$('continue-study-button').addEventListener('click', () => startStudy(state.study.filter, null, true));
$('wrong-study-button').addEventListener('click', () => startStudy('wrong'));
$('study-check-button').addEventListener('click', checkStudyAnswer);
$('study-prev-button').addEventListener('click', () => moveStudy(-1));
$('study-next-button').addEventListener('click', () => moveStudy(1));
$('exam-mode-button').addEventListener('click', startExam);
$('resume-exam-button').addEventListener('click', resumeExam);
$('exam-prev-button').addEventListener('click', () => moveExam(-1));
$('exam-next-button').addEventListener('click', () => moveExam(1));
$('submit-exam-button').addEventListener('click', submitExam);
$('clear-records-button').addEventListener('click', clearRecords);
$('restart-exam-button').addEventListener('click', goHome);
$('review-result-mistakes-button').addEventListener('click', () => {
  const ids = lastReport?.mistakes.map((mistake) => mistake.question.id) ?? state.lastExam?.mistakeIds ?? [];
  state.study.positions.wrong = 0;
  startStudy('wrong', ids);
});

updateHome();

