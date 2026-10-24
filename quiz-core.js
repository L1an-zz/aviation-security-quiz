const TYPES = ['single', 'multi', 'judge'];
const TYPE_LABELS = { single: '单选题', multi: '多选题', judge: '判断题' };

export function normalizeAnswer(answer) {
  const source = Array.isArray(answer) ? answer.join('') : (answer ?? '').toString();
  return [...new Set((source.toUpperCase().match(/[A-Z]/g) ?? []))].sort().join('');
}

export function gradeQuestion(question, selected) {
  const normalizedSelected = normalizeAnswer(selected);
  const correctAnswer = normalizeAnswer(question.answer);
  return {
    correct: normalizedSelected === correctAnswer,
    selected: normalizedSelected,
    correctAnswer,
  };
}

export function analyzeMistake(question, selected) {
  const result = gradeQuestion(question, selected);
  if (result.correct) return { ...result, kind: 'correct', missed: [], extra: [] };
  if (!result.selected) return { ...result, kind: 'unanswered', missed: [...result.correctAnswer], extra: [] };
  if (question.type !== 'multi') return { ...result, kind: 'wrong', missed: [], extra: [] };

  const selectedSet = new Set(result.selected);
  const correctSet = new Set(result.correctAnswer);
  const missed = [...correctSet].filter((letter) => !selectedSet.has(letter));
  const extra = [...selectedSet].filter((letter) => !correctSet.has(letter));
  const kind = missed.length && extra.length ? 'missed-and-extra' : missed.length ? 'missed' : 'extra';
  return { ...result, kind, missed, extra };
}

function shuffled(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function sampleExam(bank, counts, random = Math.random) {
  const normalizedCounts = Object.fromEntries(TYPES.map((type) => {
    const count = Number(counts[type] ?? 0);
    if (!Number.isInteger(count) || count < 0) throw new RangeError('题目数量必须是非负整数');
    return [type, count];
  }));
  const total = Object.values(normalizedCounts).reduce((sum, count) => sum + count, 0);
  if (total === 0) throw new RangeError('至少选择 1 道题');

  const chosen = [];
  for (const type of TYPES) {
    const available = bank[type] ?? [];
    const count = normalizedCounts[type];
    if (count > available.length) {
      throw new RangeError(`${TYPE_LABELS[type]}最多可选 ${available.length} 道`);
    }
    chosen.push(...shuffled(available, random).slice(0, count));
  }
  return chosen;
}

function accuracy(correctCount, totalCount) {
  return totalCount ? Math.round((correctCount / totalCount) * 1000) / 10 : 0;
}

export function gradeExam(questions, answers) {
  const byType = Object.fromEntries(TYPES.map((type) => [type, { correctCount: 0, totalCount: 0, accuracy: 0 }]));
  const mistakes = [];
  let correctCount = 0;
  let score = 0;
  let maxScore = 0;

  for (const question of questions) {
    const result = gradeQuestion(question, answers[question.id] ?? []);
    const points = Number(question.score) || 0;
    maxScore += points;
    byType[question.type].totalCount += 1;
    if (result.correct) {
      correctCount += 1;
      score += points;
      byType[question.type].correctCount += 1;
    } else {
      mistakes.push({ question, ...analyzeMistake(question, answers[question.id] ?? []) });
    }
  }

  for (const type of TYPES) {
    byType[type].accuracy = accuracy(byType[type].correctCount, byType[type].totalCount);
  }
  return {
    correctCount,
    totalCount: questions.length,
    score,
    maxScore,
    accuracy: accuracy(correctCount, questions.length),
    byType,
    mistakes,
  };
}

