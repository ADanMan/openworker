import { expect, test, type Page } from '@playwright/test'

async function noOverflow(page:Page) {
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.locator('.app').evaluate(el=>el.scrollWidth <= el.clientWidth)).toBe(true)
}
async function target(page:Page, selector:string, min=48) {
  for (const el of await page.locator(selector).all()) {
    if (!await el.isVisible()) continue
    const box=await el.boundingBox();expect(box?.height).toBeGreaterThanOrEqual(min);expect(box?.width).toBeGreaterThanOrEqual(min)
  }
}
async function appearance(page:Page, theme='dark', scale=1.4) {
  await page.evaluate(async ({theme,scale})=>{
    const modulePath='/src/db.ts';const {updateSettings}=await import(modulePath)
    await updateSettings({theme,fontScale:scale})
  },{theme,scale})
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme)
}
test('phone quick add, completion and month overview keep the same task and date', async({page})=>{
  await page.setViewportSize({width:375,height:812});await page.goto('/')
  await page.getByLabel('Общая дата').fill('2026-10-05')
  const day=page.locator('.day').filter({has:page.locator('[data-add="day:2026-10-05"]')})
  await day.getByPlaceholder('+ Добавить задачу').fill('Синтетическая проверка расписания')
  await day.getByPlaceholder('+ Добавить задачу').press('Enter')
  await expect(day.locator('.row .title')).toHaveText('Синтетическая проверка расписания')
  await target(page,'.nav button, .mode-bar button, .topbar .tools button, .day-journal, .row .check, .row .more')
  await day.getByRole('button',{name:'Отметить выполненной',exact:true}).click()
  await expect(day.locator('.row')).toHaveClass(/done/)
  await page.getByRole('tab',{name:'Месяц',exact:true}).click()
  await expect(page.locator('.month')).toBeVisible()
  await page.getByRole('button',{name:/^5 октября 2026.*Открыть неделю/}).click()
  await expect(page.getByRole('tab',{name:'Неделя'})).toHaveAttribute('aria-selected','true')
  await expect(page.getByLabel('Общая дата')).toHaveValue('2026-10-05')
  await expect(page.getByText('Синтетическая проверка расписания',{exact:true})).toBeVisible()
  await noOverflow(page)
})
for (const viewport of [{width:320,height:640},{width:375,height:812},{width:812,height:375},{width:768,height:1024},{width:1440,height:900}]) {
  test(`navigation and editor fit ${viewport.width}x${viewport.height} with dark, large text and reduced motion`,async({page})=>{
    await page.setViewportSize(viewport);await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await page.goto('/')
    await page.getByLabel('Общая дата').waitFor();await appearance(page)
    await noOverflow(page)
    await page.getByRole('tab',{name:'Месяц',exact:true}).click();await noOverflow(page)
    await page.getByRole('tab',{name:'Неделя',exact:true}).click()
    await page.getByRole('button',{name:'Дневник чувств',exact:true}).click()
    const text=page.getByLabel('Что у вас на душе?');await text.fill('Несекретный тест: длинный текст остаётся в своей дате.')
    expect(await page.locator('.journal-layout').evaluate(el=>el.firstElementChild?.classList.contains('journal-editor'))).toBe(true)
    await expect(page.getByLabel('Выбранная дата')).toHaveCount(0)
    await page.getByRole('button',{name:'Сохранить запись',exact:true}).click()
    await expect(page.getByText('Запись сохранена',{exact:true})).toBeVisible()
    await noOverflow(page)
    await text.focus();await expect(text).toBeInViewport()
    await page.screenshot({path:`test-results/uiux-${viewport.width}x${viewport.height}.png`})
  })
}
test('small offline popup keeps completion and cancellation visible above the keyboard',async({page})=>{
  await page.setViewportSize({width:320,height:220});await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'})
  await page.addInitScript(()=>{
    const w=window as any;w.__calls=[]
    w.OpenTweekOverlay={status:()=>JSON.stringify({sessionId:'synthetic-owner',state:'recording'}),finish:()=>w.__calls.push('finish'),cancel:()=>w.__calls.push('cancel'),stop(){},beginSave:()=>true,releaseSave(){},acknowledge:()=>false}
  })
  await page.goto('/overlay.html')
  const finish=page.getByRole('button',{name:'Завершить диктовку'}),cancel=page.getByRole('button',{name:'Отменить диктовку'})
  await expect(finish).toBeInViewport();await expect(cancel).toBeInViewport();await target(page,'button')
  await finish.focus();await expect(finish).toBeFocused();await expect(finish).toBeInViewport()
  await finish.click();await cancel.click();expect(await page.evaluate(()=>(window as any).__calls)).toEqual(['finish','cancel'])
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:'test-results/uiux-popup-recording-dark.png'})
})
test('popup shares local appearance and preserves edited review text in a short window',async({page})=>{
  await page.goto('/');await page.getByLabel('Общая дата').waitFor();await appearance(page,'dark',1.4)
  await page.addInitScript(()=>{
    const w=window as any;w.OpenTweekOverlay={status:()=>JSON.stringify({sessionId:'owner',state:'review',result:{sessionId:'synthetic-uiux',date:'2026-10-05',text:'Проверочный текст'}}),finish(){},cancel(){},stop(){},beginSave:()=>true,releaseSave(){},acknowledge:()=>false}
  })
  await page.setViewportSize({width:350,height:300});await page.goto('/overlay.html')
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark')
  const text=page.getByRole('textbox',{name:'Текст записи'});await text.fill('Отредактированный проверочный текст')
  await text.focus();await expect(text).toBeInViewport()
  await expect(page.getByRole('button',{name:'Сохранить запись'})).toBeInViewport()
  await target(page,'button')
  await page.getByRole('button',{name:'Сохранить запись'}).click()
  await expect(page.getByRole('alert')).toContainText('Запись уже сохранена')
  await expect(text).toBeDisabled();await expect(text).toHaveValue('Отредактированный проверочный текст')
  await expect(page.getByRole('button',{name:'Повторить подтверждение'})).toBeInViewport()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:'test-results/uiux-popup-review-dark.png'})
})
test('save and delete text retain AA contrast across all existing accents and themes',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.goto('/');await page.getByRole('button',{name:'Дневник чувств',exact:true}).click()
  await page.getByLabel('Что у вас на душе?').fill('Несекретная проверка контраста')
  await page.getByRole('button',{name:'Сохранить запись',exact:true}).click()
  for (const theme of ['light','dark']) for (const accent of ['red','orange','yellow','green','teal','blue','purple','pink','gray']) {
    await page.evaluate(async ({theme,accent})=>{const path='/src/db.ts';const {updateSettings}=await import(path);await updateSettings({theme,accent})},{theme,accent})
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);await expect(page.locator('html')).toHaveAttribute('data-accent',accent)
    const ratios=await page.locator('.journal-save-actions button.primary, .journal-save-actions button.danger').evaluateAll(buttons=>{
      const luminance=(rgb:string)=>{
        const values=rgb.match(/[\d.]+/g)!.slice(0,3).map(Number).map(n=>{const c=n/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4})
        return values[0]*.2126+values[1]*.7152+values[2]*.0722
      }
      return buttons.map(el=>{const css=getComputedStyle(el),fg=luminance(css.color),bg=luminance(css.backgroundColor);return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)})
    })
    expect(ratios).toHaveLength(2);for (const ratio of ratios) expect(ratio,`${theme} ${accent}`).toBeGreaterThanOrEqual(4.5)
  }
})
test('printing retains calendar period context while removing navigation controls',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await page.goto('/');await page.getByLabel('Общая дата').fill('2026-10-05')
  await page.emulateMedia({media:'print'})
  await expect(page.locator('.planner-toolbar h1')).toBeVisible();await expect(page.locator('.planner-toolbar h1')).toContainText('2026')
  await expect(page.locator('.planner-toolbar .nav')).toBeHidden()
})
