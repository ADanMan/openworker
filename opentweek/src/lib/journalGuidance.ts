/** Static, optional writing aids. No journal text, storage, network or inference. */
export const JOURNAL_FIELDS = [
  { key: 'thoughts', label: 'Мысли', prompt: 'Какие мысли возникли? Можно записать их своими словами. Можно пропустить.', optional: true },
  { key: 'feelings', label: 'Чувства', prompt: 'Какие чувства вы замечаете, если можете их назвать? Смешанные чувства тоже подходят. Можно пропустить.', optional: true },
  { key: 'body', label: 'Ощущения в теле', prompt: 'Что вы замечаете в теле? Можно написать «не замечаю» или «не знаю». Можно пропустить.', optional: true },
  { key: 'perspective', label: 'Другой взгляд', prompt: 'Есть ли ещё способ описать ситуацию, сохраняя то, что для вас важно? Искать положительную сторону необязательно. Можно пропустить.', optional: true },
  { key: 'action', label: 'Действие', prompt: 'Что вы сделали или хотите сделать? Пауза и отсутствие решения тоже возможны. Можно пропустить.', optional: true },
  { key: 'after', label: 'После', prompt: 'Что изменилось после? Если ничего или пока непонятно, это тоже можно записать. Можно пропустить.', optional: true },
  { key: 'needs', label: 'Потребности', prompt: 'Что сейчас важно или чего хотелось бы? Можно выбрать подходящее слово или написать своё. Можно пропустить.', optional: true },
] as const

export const CONTEXTS = [
  { value: 'work', label: 'Работа' },
  { value: 'relationships', label: 'Отношения' },
  { value: 'rest', label: 'Отдых' },
  { value: 'change', label: 'Перемены' },
  { value: 'other', label: 'Другое' },
] as const

export type JournalContext = typeof CONTEXTS[number]['value']
export type JournalFieldKey = typeof JOURNAL_FIELDS[number]['key']
export interface JournalGuidance {
  reason: string
  prompts: string[]
  feelings: string[]
  needs: string[]
}

const feelings = ['Радость', 'Грусть', 'Злость', 'Тревога', 'Растерянность', 'Благодарность', 'Спокойствие', 'Разочарование', 'Интерес']
const needs = ['Отдых', 'Поддержка', 'Ясность', 'Безопасность', 'Самостоятельность', 'Близость', 'Уважение', 'Личное пространство']
const generalPrompts = ['Если хочется, опишите один конкретный момент: что произошло?', 'Можно отделить то, что вы наблюдали, от того, что предположили.']
const contextPrompts: Record<JournalContext, string[]> = {
  work: ['Если подходит, что было важным в задаче или рабочем разговоре?', 'Можно подумать, чего хотелось бы: ясности, времени, поддержки или чего-то другого.'],
  relationships: ['Если хочется, какие слова или действия запомнились в общении?', 'Можно записать, что хотелось бы сказать или сохранить при себе.'],
  rest: ['Если подходит, как вы провели это время и что заметили?', 'Можно описать, какой отдых вам сейчас хотелось бы получить, без оценки его пользы.'],
  change: ['Если хочется, что изменилось и что осталось знакомым?', 'Можно записать, что уже понятно, а что пока остаётся неопределённым.'],
  other: generalPrompts,
}

/** Exact context matching only: arbitrary prose always receives the general fallback. */
export function getGuidance(context?: string): JournalGuidance {
  const selected = CONTEXTS.find(option => option.value === context)
  const reason = selected
    ? `Подсказки по выбранной вами теме «${selected.label}».`
    : 'Общие подсказки: тема не выбрана или не распознана.'
  return {
    reason: `${reason} Это готовые варианты, а не выводы о ваших чувствах. Можно пропустить любые вопросы и слова или написать своё.`,
    prompts: [...(selected ? contextPrompts[selected.value] : generalPrompts)],
    feelings: [...feelings],
    needs: [...needs],
  }
}
