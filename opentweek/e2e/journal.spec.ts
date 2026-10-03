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
  await expect(page.getByRole('dialog')).toBeVisible()
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
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
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

test('mobile journal has no horizontal overflow and preserves dirty draft on dismissed close', async ({ page }) => {
  await native(page); await open(page)
  await page.getByLabel('Что у вас на душе?').fill('Тестовый черновик, не личные данные.')
  page.on('dialog', async (dialog) => { await dialog.dismiss() })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await page.locator('.journal-modal').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
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
