import { t } from './i18n'
import { deleteTask, restoreTask } from './actions'
import { toast } from './hooks/toast'
import type { ContainerId } from './types'

export function focusAddLine(container: ContainerId) {
  requestAnimationFrame(() => {
    document.querySelector<HTMLInputElement>(`[data-add="${CSS.escape(container)}"]`)?.focus()
  })
}

export async function removeWithUndo(id: string) {
  const task = await deleteTask(id)
  if (task) toast(t('taskDeleted'), { label: t('undo'), run: () => restoreTask(task) })
}
