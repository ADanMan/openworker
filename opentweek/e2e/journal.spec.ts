import { expect, test, type Page } from '@playwright/test'

async function native(page: Page, ready = true) {
  await page.addInitScript((modelReady) => {
    const w = window as any
    w.__voiceCalls = []
    w.SpeechRecognition = w.webkitSpeechRecognition = function () { throw new Error('Cloud recognition forbidden') }
    w.OpenTweekNative = {
      platform: () => 'android', notificationsAllowed: () => false, takeIntent: () => { const value = w.__pendingIntent ?? ''; w.__pendingIntent = ''; return value }, setReminders: () => {},
      localVoiceStatus: () => JSON.stringify({ supported: true, modelReady, downloading: false, progress: 0 }),
      downloadLocalVoiceModel: () => w.__voiceCalls.push('download'),
      cancelLocalVoiceDownload: () => w.__voiceCalls.push('cancelDownload'),
      startLocalVoice: (id: string) => { w.__voiceId = id; w.__voiceCalls.push('start'); w.__otLocalVoice({ sessionId: id, state: 'recording' }) },
      stopLocalVoice: () => w.__voiceCalls.push('stop'),
      cancelLocalVoice: () => w.__voiceCalls.push('cancel'),
    }
  }, ready)
}
async function open(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Дневник чувств', exact: true }).click()
  await expect(page.getByRole('main', { name: 'Дневник чувств' })).toBeVisible()
}
async function count(page: Page, table = 'journalEntries') {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('opentweek'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
    })
    return new Promise<number>((resolve, reject) => {
      const r = db.transaction(name).objectStore(name).count()
      r.onsuccess = () => { db.close(); resolve(r.result) }; r.onerror = () => { db.close(); reject(r.error) }
    })
  }, table)
}
async function event(page: Page, state: string, text?: string, error?: string) {
  await page.evaluate((e) => { const w = window as any; w.__otLocalVoice({ sessionId: w.__voiceId, ...e }) }, { state, text, error })
}

test('typed journal saves once, survives reload, and remains separate from tasks', async ({ page }) => {
  await open(page)
  await expect(page.getByText('Локальная диктовка доступна', { exact: false })).toBeVisible()
  await page.getByLabel('Что у вас на душе?').fill('Сегодня спокойно. Хочу прогуляться.')
  await page.getByLabel('Как вы себя чувствуете?').selectOption('4')
  await page.getByRole('button', { name: 'Сохранить запись', exact: true }).dblclick()
  await expect(page.getByText('Запись сохранена', { exact: true })).toBeVisible()
  expect(await count(page)).toBe(1); expect(await count(page, 'tasks')).toBe(0)
  await page.reload()
  await page.getByRole('button', { name: 'Дневник чувств', exact: true }).click()
  await page.locator('.journal-entry').click()
  await expect(page.getByLabel('Что у вас на душе?')).toHaveValue('Сегодня спокойно. Хочу прогуляться.')
  await expect(page.getByLabel('Как вы себя чувствуете?')).toHaveValue('4')
})

test('local transcript is a draft until save and duplicate callbacks do not append twice', async ({ page }) => {
  await native(page); await open(page)
  await page.getByLabel('Что у вас на душе?').fill('Мой текст.')
  await page.getByRole('button', { name: 'Диктовать по-русски' }).click()
  await expect(page.locator('.voice-status')).toContainText('Идёт запись')
  await expect(page.getByRole('button', { name: 'Сохранить запись' })).toBeDisabled()
  await page.getByRole('button', { name: 'Остановить и вставить текст' }).click()
  await event(page, 'result', 'Сегодня я радуюсь')
  await event(page, 'result', 'Сегодня я радуюсь')
  await expect(page.getByLabel('Что у вас на душе?')).toHaveValue('Мой текст.\nСегодня я радуюсь')
  expect(await count(page)).toBe(0)
  await page.getByRole('button', { name: 'Сохранить запись' }).click()
  await expect.poll(() => count(page)).toBe(1)
})

test('cancel rejects a late result and permission refusal has no fallback', async ({ page }) => {
  await native(page); await open(page)
  await page.getByLabel('Что у вас на душе?').fill('Оставить это')
  await page.getByRole('button', { name: 'Диктовать по-русски' }).click()
  await page.getByRole('button', { name: 'Отменить диктовку' }).click()
  await event(page, 'result', 'Не сохранять')
  await expect(page.getByLabel('Что у вас на душе?')).toHaveValue('Оставить это')
  await page.getByRole('button', { name: 'Диктовать по-русски' }).click()
  await event(page, 'error', undefined, 'permission_denied')
  await expect(page.getByRole('alert')).toContainText('Доступ к микрофону не разрешён')
  expect(await count(page)).toBe(0)
  expect(await page.evaluate(() => (window as any).__voiceCalls)).toEqual(['start', 'cancel', 'start'])
})

test('model setup never starts capture and close cancels an active recording', async ({ page }) => {
  await native(page, false); await open(page)
  expect(await page.evaluate(() => (window as any).__voiceCalls)).toEqual([])
  await page.getByRole('button', { name: 'Скачать русскую модель' }).click()
  await expect(page.locator('.voice-status')).toContainText('Загрузка')
  expect(await page.evaluate(() => (window as any).__voiceCalls)).toEqual(['download'])
  await page.evaluate(() => (window as any).__otLocalVoice({ sessionId: '', state: 'ready' }))
  await page.getByRole('button', { name: 'Диктовать по-русски' }).click()
  await page.locator('.mode-bar').getByRole('button', { name: 'Календарь', exact: true }).click()
  await expect(page.getByRole('main', { name: 'Дневник чувств' })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__voiceCalls)).toEqual(['download', 'start', 'cancel'])
})

test('local task voice requires review and never creates a journal entry', async ({ page }) => {
  await native(page); await page.goto('/')
  await page.getByRole('button', { name: 'Голосовая задача', exact: true }).click()
  await page.getByRole('button', { name: 'Диктовать по-русски' }).click()
  await event(page, 'result', 'завтра позвонить другу')
  expect(await count(page, 'tasks')).toBe(0)
  await page.getByRole('button', { name: 'Добавить задачу', exact: true }).click()
  await expect.poll(() => count(page, 'tasks')).toBe(1)
  expect(await count(page)).toBe(0)
})

test('mobile journal has no horizontal overflow and Escape preserves draft', async ({ page }) => {
  await native(page); await open(page)
  await page.getByLabel('Что у вас на душе?').fill('Тестовый черновик, не личные данные.')
  page.on('dialog', async (dialog) => { await dialog.dismiss() })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('main', { name: 'Дневник чувств' })).toBeVisible()
  expect(await page.locator('.journal-page').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/journal-mobile.png', fullPage: true })
})


test('voice launcher intent cannot discard an open journal draft', async ({ page }) => {
  await native(page); await open(page)
  await page.getByLabel('Что у вас на душе?').fill('Сохранить черновик при внешнем запуске')
  await page.evaluate(() => {
    (window as any).__pendingIntent = JSON.stringify({ kind: 'voice' })
    window.dispatchEvent(new Event('ot-intent'))
  })
  await expect(page.getByLabel('Что у вас на душе?')).toHaveValue('Сохранить черновик при внешнем запуске')
  expect(await count(page)).toBe(0)
})

test('model cancellation waits for native cleanup before offering retry', async ({ page }) => {
  await native(page, false); await open(page)
  await page.getByRole('button', { name: 'Скачать русскую модель' }).click()
  await page.getByRole('button', { name: 'Отменить загрузку' }).click()
  await expect(page.locator('.voice-status')).toHaveText('Отменяем загрузку…')
  await expect(page.getByRole('button', { name: 'Скачать русскую модель' })).toHaveCount(0)
  await page.evaluate(() => (window as any).__otLocalVoice({ sessionId: '', state: 'cancelled' }))
  await page.getByRole('button', { name: 'Скачать русскую модель' }).click()
  expect(await page.evaluate(() => (window as any).__voiceCalls)).toEqual(['download', 'cancelDownload', 'download'])
})

async function records(page: Page, table = 'journalEntries') {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('opentweek'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    return new Promise<any[]>((resolve, reject) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => { db.close(); resolve(r.result) }; r.onerror = () => reject(r.error) })
  }, table)
}

test('draft autosave survives reload and cancel restores saved fields', async ({ page }) => {
  await open(page)
  await page.getByLabel('Что у вас на душе?').fill('Незавершённая запись')
  await expect(page.getByText('Черновик сохранён на устройстве', { exact: true })).toBeVisible()
  expect(await count(page)).toBe(0)
  await page.reload()
  await page.getByRole('button', { name: 'Дневник чувств', exact: true }).click()
  await expect(page.getByLabel('Что у вас на душе?')).toHaveValue('Незавершённая запись')
  await page.getByRole('button', { name: 'Сохранить запись', exact: true }).click()
  await expect(page.getByText('Запись сохранена', { exact: true })).toBeVisible()
  await page.getByLabel('Что у вас на душе?').fill('Не сохранять эти изменения')
  await expect(page.getByText('Черновик сохранён на устройстве', { exact: true })).toBeVisible()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Отменить изменения', exact: true }).click()
  await expect(page.getByLabel('Что у вас на душе?')).toHaveValue('Незавершённая запись')
  expect(await count(page, 'journalDrafts')).toBe(0)
})

test('guided fields are optional local choices and survive save', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Помочь заполнить по шагам' }).click()
  await page.getByLabel('О чём ситуация?').selectOption('work')
  await expect(page.getByText('Подсказки по выбранной вами теме', { exact: false })).toContainText('Работа')
  await page.getByRole('button', { name: 'Тревога', exact: true }).click()
  await page.getByRole('button', { name: 'Ясность', exact: true }).click()
  await page.getByRole('textbox', { name: /^Мысли/ }).fill('Хочу уточнить ожидания')
  await page.getByRole('button', { name: 'Сохранить запись', exact: true }).click()
  await expect(page.getByText('Запись сохранена', { exact: true })).toBeVisible()
  const [entry] = await records(page)
  expect(entry).toMatchObject({ text: '', context: 'work', feelings: 'Тревога', needs: 'Ясность', thoughts: 'Хочу уточнить ожидания', perspective: '', action: '', after: '' })
  await page.screenshot({ path: 'test-results/journal-guided-mobile.png', fullPage: true })
})

test('calendar event and journal share date and stable identity through rename move delete', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Общая дата').fill('2026-10-05')
  const add = page.locator('[data-add="day:2026-10-05"]')
  await add.fill('Тестовая встреча'); await add.press('Enter')
  const row = page.locator('.row').filter({ hasText: 'Тестовая встреча' })
  await row.locator('.more').click()
  await page.getByRole('button', { name: 'Открыть дневник события' }).click()
  await expect(page.getByLabel('Общая дата')).toHaveValue('2026-10-05')
  await page.getByLabel('Что у вас на душе?').fill('Приватная заметка о встрече')
  await page.getByRole('button', { name: 'Сохранить запись', exact: true }).click()
  await expect(page.getByText('Запись сохранена', { exact: true })).toBeVisible()
  const [entry] = await records(page); const [task] = await records(page, 'tasks')
  expect(entry.taskId).toBe(task.id)
  await page.getByRole('button', { name: 'Тестовая встреча → календарь' }).click()
  await page.locator('.title-input').fill('Встреча после переноса')
  await page.locator('.task-modal input[type=date]').fill('2026-10-06')
  await page.getByRole('button', { name: 'Открыть дневник события' }).click()
  await expect(page.getByLabel('Общая дата')).toHaveValue('2026-10-06')
  await expect(page.getByLabel('Что у вас на душе?')).toHaveValue('Приватная заметка о встрече')
  await expect(page.getByRole('button', { name: 'Встреча после переноса → календарь' })).toBeVisible()
  expect(await count(page)).toBe(1)
  await page.getByRole('button', { name: 'Встреча после переноса → календарь' }).click()
  await page.locator('.task-modal .btn.danger').click()
  await page.locator('.mode-bar').getByRole('button', { name: 'Дневник', exact: true }).click()
  await page.locator('.journal-entry').first().click()
  await expect(page.getByLabel('Что у вас на душе?')).toHaveValue('Приватная заметка о встрече')
  expect((await records(page))[0]).toMatchObject({ taskId: null, date: '2026-10-06' })
})

test('changing shared date keeps each day draft separate', async ({ page }) => {
  await open(page)
  await page.getByLabel('Общая дата').fill('2026-10-05')
  await page.getByLabel('Что у вас на душе?').fill('Первый день')
  await expect(page.getByText('Черновик сохранён на устройстве', { exact: true })).toBeVisible()
  await page.getByLabel('Общая дата').fill('2026-10-06')
  await expect(page.getByLabel('Что у вас на душе?')).toHaveValue('')
  await page.getByLabel('Что у вас на душе?').fill('Второй день')
  await expect(page.getByText('Черновик сохранён на устройстве', { exact: true })).toBeVisible()
  await page.getByLabel('Общая дата').fill('2026-10-05')
  await expect(page.getByLabel('Что у вас на душе?')).toHaveValue('Первый день')
  expect(await count(page, 'journalDrafts')).toBe(2)
})

test.describe('local calendar date', () => {
  test.use({ timezoneId: 'America/Los_Angeles' })
  test('journal day is local even when UTC has advanced', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-05T02:00:00Z'))
    await open(page)
    await expect(page.getByLabel('Общая дата')).toHaveValue('2026-10-04')
    await page.getByLabel('Что у вас на душе?').fill('Вечер воскресенья')
    await page.getByRole('button', { name: 'Сохранить запись', exact: true }).click()
    await expect(page.getByText('Запись сохранена', { exact: true })).toBeVisible()
    expect((await records(page))[0].date).toBe('2026-10-04')
  })
})

test('feed event opens a private linked entry without copying its title', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Общая дата')).toBeVisible()
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('opentweek'); r.onsuccess = () => resolve(r.result) })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('feeds', 'readwrite')
      tx.objectStore('feeds').put({ id: 'test-feed', name: 'Sample calendar', url: '', enabled: true, color: 'blue', fetchedAt: Date.now(), error: null, events: [{ uid: 'test-event', title: 'Внешнее событие', date: '2026-10-05', time: null, endTime: null, location: null }] })
      tx.oncomplete = () => { db.close(); resolve() }; tx.onerror = () => reject(tx.error)
    })
  })
  await page.reload()
  await page.getByLabel('Общая дата').fill('2026-10-05')
  await page.getByRole('button', { name: 'Внешнее событие', exact: true }).click()
  await page.getByLabel('Что у вас на душе?').fill('Моё впечатление')
  await page.getByRole('button', { name: 'Сохранить запись', exact: true }).click()
  await expect(page.getByText('Запись сохранена', { exact: true })).toBeVisible()
  const [entry] = await records(page)
  expect(entry).toMatchObject({ feedId: 'test-feed', eventUid: 'test-event', occurrenceDate: '2026-10-05', text: 'Моё впечатление', taskId: null })
  expect(JSON.stringify(entry)).not.toContain('Внешнее событие')
  await page.getByRole('button', { name: 'Внешнее событие → календарь' }).click()
  await expect(page.getByRole('button', { name: 'Внешнее событие', exact: true })).toBeVisible()
})

test('desktop guided journal fits the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await open(page)
  await page.getByLabel('Что у вас на душе?').fill('Обсудили план проекта. Хочу обдумать разговор.')
  await page.getByRole('button', { name: 'Помочь заполнить по шагам' }).click()
  await page.getByLabel('О чём ситуация?').selectOption('work')
  await expect(page.getByText('Черновик сохранён на устройстве', { exact: true })).toBeVisible()
  await page.locator('.journal-page').evaluate(el => { el.scrollTop = 0 })
  expect(await page.locator('body').evaluate(el => el.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/journal-desktop.png', fullPage: true })
})

async function wakeNative(page: Page, active = false) {
  await native(page)
  await page.addInitScript((restore) => {
    const w = window as any
    w.__wakePending = null
    w.OpenTweekNative.localVoiceStatus = () => JSON.stringify({ supported: true, modelReady: true, wakeSupported: true, wakeSessionId: restore ? 'existing-wake' : '', wakeState: restore ? 'waiting' : '' })
    w.OpenTweekNative.startLocalWake = (id: string) => { w.__voiceId = id; w.__voiceCalls.push('wake'); w.__otLocalVoice({ sessionId: id, state: 'waiting' }) }
    w.OpenTweekNative.localWakeRecovery = () => JSON.stringify(w.__wakePending)
    w.OpenTweekNative.clearLocalWakeRecovery = (id: string) => { if (w.__wakePending?.sessionId === id) { w.__voiceCalls.push('ackWake'); w.__wakePending = null; return true } return false }
  }, active)
}

test('wake opt-in waits then offers a private transcript for explicit insertion', async ({ page }) => {
  await wakeNative(page); await open(page)
  await page.getByText('Эксперимент: «эй, Твик»', { exact: true }).click()
  const start = page.getByRole('button', { name: 'Ждать фразу «эй, Твик»', exact: true })
  await expect(start).toBeDisabled()
  expect(await page.evaluate(() => (window as any).__voiceCalls)).toEqual([])
  await page.getByRole('checkbox', { name: 'Разрешить экспериментальное распознавание фразы в этом сеансе' }).check()
  await start.click()
  await expect(page.locator('.voice-status')).toContainText('Микрофон включён · ждём')
  await expect(page.getByRole('button', { name: 'Сохранить запись' })).toBeDisabled()
  await event(page, 'recording')
  await expect(page.locator('.voice-status')).toContainText('Идёт запись')
  await page.evaluate(() => { const w = window as any; w.__wakePending = { sessionId: w.__voiceId, text: 'Проверить и сохранить', createdAt: Date.now() }; w.__otLocalVoice({ sessionId: w.__voiceId, state: 'wake_result' }) })
  await expect(page.getByRole('region', { name: 'Проверьте фоновую диктовку' })).toBeVisible()
  await expect(page.getByLabel('Что у вас на душе?')).toHaveValue('')
  expect(await count(page)).toBe(0)
  await page.getByRole('button', { name: 'Вставить в выбранный раздел' }).click()
  await expect(page.getByLabel('Что у вас на душе?')).toHaveValue('Проверить и сохранить')
  await expect.poll(() => count(page, 'journalDrafts')).toBe(1)
  expect(await page.evaluate(() => (window as any).__voiceCalls)).toEqual(['wake', 'ackWake'])
  expect(await count(page)).toBe(0)
})

test('wake cancellation and mode switch reject late activation and never rearm', async ({ page }) => {
  await wakeNative(page); await open(page)
  await page.getByText('Эксперимент: «эй, Твик»', { exact: true }).click()
  await page.getByRole('checkbox', { name: 'Разрешить экспериментальное распознавание фразы в этом сеансе' }).check()
  await page.getByRole('button', { name: 'Ждать фразу «эй, Твик»' }).click()
  await page.getByRole('button', { name: 'Прекратить ожидание' }).click()
  await event(page, 'recording'); await event(page, 'result', 'Late result')
  await expect(page.getByLabel('Что у вас на душе?')).toHaveValue('')
  await page.getByRole('button', { name: 'Ждать фразу «эй, Твик»' }).click()
  await page.locator('.mode-bar').getByRole('button', { name: 'Календарь', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__voiceCalls)).toEqual(['wake', 'cancel', 'wake', 'cancel'])
})

test('recreated editor shows the running wake service and can stop it', async ({ page }) => {
  await wakeNative(page, true); await open(page)
  await expect(page.locator('.voice-status')).toContainText('Микрофон включён · ждём')
  expect(await page.evaluate(() => (window as any).__voiceCalls)).toEqual([])
  await page.getByRole('button', { name: 'Прекратить ожидание' }).click()
  expect(await page.evaluate(() => (window as any).__voiceCalls)).toEqual(['cancel'])
})

test('failed recovery acknowledgement survives editor recreation without duplicate text', async ({ page }) => {
  await wakeNative(page); await open(page)
  await page.evaluate(() => { const w = window as any; w.__wakePending = { sessionId: 'recovery-once', text: 'Один раз', createdAt: Date.now() }; w.OpenTweekNative.clearLocalWakeRecovery = () => false })
  await expect(page.getByRole('region', { name: 'Проверьте фоновую диктовку' })).toBeVisible()
  await page.getByRole('button', { name: 'Вставить в выбранный раздел' }).click()
  await expect(page.getByLabel('Что у вас на душе?')).toHaveValue('Один раз')
  await expect(page.getByRole('region', { name: 'Проверьте фоновую диктовку' }).getByRole('alert')).toBeVisible()
  await page.locator('.mode-bar').getByRole('button', { name: 'Календарь', exact: true }).click()
  await page.locator('.mode-bar').getByRole('button', { name: 'Дневник', exact: true }).click()
  await expect(page.getByLabel('Что у вас на душе?')).toHaveValue('Один раз')
  await page.evaluate(() => { const w = window as any; w.OpenTweekNative.clearLocalWakeRecovery = (id: string) => { if (w.__wakePending?.sessionId === id) { w.__wakePending = null; return true } return false } })
  await page.getByRole('button', { name: 'Вставить в выбранный раздел' }).click()
  await expect(page.getByRole('region', { name: 'Проверьте фоновую диктовку' })).toHaveCount(0)
  await expect(page.getByLabel('Что у вас на душе?')).toHaveValue('Один раз')
  expect(await count(page, 'journalDrafts')).toBe(1)
})
