export const STORAGE_KEY = 'securityQuizStateV1';
const VERSION = 1;

export function createDefaultState() {
  return {
    version: VERSION,
    settings: { single: 20, multi: 20, judge: 20 },
    study: {
      filter: 'all',
      positions: { all: 0, single: 0, multi: 0, judge: 0, wrong: 0 },
      results: {},
      active: null,
    },
    wrongIds: [],
    exam: null,
    lastExam: null,
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isLetterArray(value) {
  return Array.isArray(value) && value.every((letter) => typeof letter === 'string' && /^[A-Z]$/.test(letter));
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isValidExam(exam) {
  if (exam === null) return true;
  if (!isRecord(exam) || !Array.isArray(exam.questionIds) || exam.questionIds.length === 0) return false;
  if (!exam.questionIds.every((id) => typeof id === 'string')) return false;
  if (!isNonNegativeInteger(exam.index) || exam.index >= exam.questionIds.length || !isRecord(exam.answers)) return false;
  return Object.values(exam.answers).every(isLetterArray);
}

function isValidActiveStudy(active) {
  return active === null || (isRecord(active)
    && ['all', 'single', 'multi', 'judge', 'wrong'].includes(active.filter)
    && typeof active.questionId === 'string'
    && isLetterArray(active.selected)
    && typeof active.checked === 'boolean');
}

function isValidState(value) {
  return isRecord(value)
    && value.version === VERSION
    && isRecord(value.settings)
    && ['single', 'multi', 'judge'].every((type) => isNonNegativeInteger(value.settings[type]))
    && isRecord(value.study)
    && ['all', 'single', 'multi', 'judge', 'wrong'].includes(value.study.filter)
    && isRecord(value.study.positions)
    && ['all', 'single', 'multi', 'judge', 'wrong'].every((filter) => isNonNegativeInteger(value.study.positions[filter]))
    && isRecord(value.study.results)
    && Object.values(value.study.results).every((result) => typeof result === 'boolean')
    && isValidActiveStudy(value.study.active)
    && Array.isArray(value.wrongIds) && value.wrongIds.every((id) => typeof id === 'string')
    && isValidExam(value.exam)
    && (value.lastExam === null || isRecord(value.lastExam));
}

export function loadState(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    const parsed = JSON.parse(raw);
    if (parsed?.version === VERSION && isRecord(parsed.study) && !('active' in parsed.study)) {
      parsed.study.active = null;
    }
    return isValidState(parsed) ? parsed : createDefaultState();
  } catch {
    return createDefaultState();
  }
}

export function saveState(storage, state) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function recordStudyResult(state, { questionId, correct }) {
  const next = JSON.parse(JSON.stringify(state));
  next.study.results[questionId] = Boolean(correct);
  const wrongIds = new Set(next.wrongIds);
  if (correct) wrongIds.delete(questionId);
  else wrongIds.add(questionId);
  next.wrongIds = [...wrongIds];
  return next;
}

export function recordExamResults(state, results) {
  const next = JSON.parse(JSON.stringify(state));
  const wrongIds = new Set(next.wrongIds);
  for (const { questionId, correct } of results) {
    if (correct) wrongIds.delete(questionId);
    else wrongIds.add(questionId);
  }
  next.wrongIds = [...wrongIds];
  return next;
}

export function clearState(storage) {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // The in-memory reset still succeeds when browser storage is unavailable.
  }
  return createDefaultState();
}

