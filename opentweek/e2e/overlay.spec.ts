import { expect, test, type Page } from '@playwright/test'
async function mode(page:Page, allowed=false) {
  await page.addInitScript((permission)=> {
    const w=window as any; w.__calls=[]
    w.__status={supported:true,modelReady:true,wakeSupported:true,overlaySupported:true,overlayAllowed:permission,wakeSessionId:'',wakeState:'idle'}
    w.OpenTweekNative={platform:()=> 'android',notificationsAllowed:()=>false,takeIntent:()=>'',setReminders:()=>{},
      localVoiceStatus:()=>JSON.stringify(w.__status),downloadLocalVoiceModel(){},cancelLocalVoiceDownload(){},startLocalVoice(){},startLocalWake(){},stopLocalVoice(){},
      requestLocalOverlayPermission:()=>w.__calls.push('settings'),
      startLocalOverlay:(id:string)=> {w.__calls.push('start');Object.assign(w.__status,{overlayActive:true,wakeSessionId:id,wakeState:'waiting',overlayRemaining:3600000})},
      cancelLocalVoice:()=>{w.__calls.push('stop');w.__status.overlayActive=false},
      stopLocalOverlay:(id:string)=>{w.__calls.push(`overlay-stop:${id}`);w.__status.overlayActive=false;w.__status.overlayStarting=false},
    }
  },allowed)
}
async function popup(page:Page, phase='review') {
  await page.addInitScript((state)=>{
    const w=window as any; w.__calls=[];w.__allowAck=false
    w.__status={sessionId:'owner',state,result:state==='review'?{sessionId:'test-1',date:'2026-10-03',text:'Несекретный тест'}:undefined}
    w.OpenTweekOverlay={status:()=>JSON.stringify(w.__status),finish:()=>{w.__calls.push('finish');w.__status.state='processing'},
      cancel:()=>{w.__calls.push('cancel');w.__status.result=undefined;w.__status.state='waiting'},stop:()=>w.__calls.push('stop'),
      beginSave:()=>true,releaseSave:()=>w.__calls.push('release'),acknowledge:()=>{w.__calls.push('ack');return w.__allowAck},
    }
  },phase)
  await page.goto('/overlay.html')
}
async function count(page:Page) {
  return page.evaluate(()=>new Promise<number>((resolve,reject)=>{
    const r=indexedDB.open('opentweek');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;if(!db.objectStoreNames.contains('journalEntries')){db.close();resolve(0);return}
      const c=db.transaction('journalEntries').objectStore('journalEntries').count();c.onsuccess=()=>{db.close();resolve(c.result)};c.onerror=()=>reject(c.error)}
  }))
}
test('cross-app mode requires consent and user-granted overlay access, never starts while opening settings', async({page})=>{
  await mode(page);await page.goto('/');await page.getByText('«Эй, Твик» из других приложений',{exact:true}).click()
  const start=page.getByRole('button',{name:'Включить на 1 час'})
  await expect(start).toBeDisabled();await page.getByRole('checkbox',{name:'Разрешить микрофон и окно на этот сеанс'}).check()
  await expect(start).toBeDisabled();await page.getByRole('button',{name:'Разрешить окно в настройках Android'}).click()
  expect(await page.evaluate(()=>(window as any).__calls)).toEqual(['settings'])
  await page.evaluate(()=>{const w=window as any;w.__status.overlayError='overlay_permission'})
  await expect(page.getByRole('alert')).toContainText('не выдано')
})
test('global session survives switching modes and stops explicitly', async({page})=>{
  await mode(page,true);await page.goto('/');await page.getByText('«Эй, Твик» из других приложений',{exact:true}).click()
  await page.getByRole('checkbox',{name:'Разрешить микрофон и окно на этот сеанс'}).check();await page.getByRole('button',{name:'Включить на 1 час'}).click()
  await expect(page.getByText('Микрофон включён · ждём «эй, Твик»',{exact:false})).toBeVisible()
  await page.getByRole('button',{name:'Дневник чувств',exact:true}).click()
  await page.getByLabel('Что у вас на душе?').fill('Обычный черновик не теряется')
  await page.getByRole('button',{name:'Календарь',exact:true}).click()
  expect(await page.evaluate(()=>(window as any).__calls)).toEqual(['start'])
  await page.getByRole('button',{name:'Выключить вызов из приложений'}).click()
  const calls=await page.evaluate(()=>(window as any).__calls)
  expect(calls[0]).toBe('start');expect(calls[1]).toMatch(/^overlay-stop:/);expect(calls).toHaveLength(2)
})
test('pending startup is single-shot and can be stopped before the next status poll', async({page})=>{
  await mode(page,true);await page.goto('/');await page.getByText('«Эй, Твик» из других приложений',{exact:true}).click()
  await page.evaluate(()=>{const w=window as any;w.OpenTweekNative.startLocalOverlay=(id:string)=>{w.__calls.push(`start:${id}`)}})
  await page.getByRole('checkbox',{name:'Разрешить микрофон и окно на этот сеанс'}).check()
  await page.getByRole('button',{name:'Включить на 1 час'}).evaluate((button:HTMLButtonElement)=>{button.click();button.click()})
  await page.getByRole('button',{name:'Выключить вызов из приложений'}).click()
  const calls=await page.evaluate(()=>(window as any).__calls)
  expect(calls).toHaveLength(2);expect(calls[0]).toMatch(/^start:/);expect(calls[1]).toBe(`overlay-stop:${calls[0].slice(6)}`)
})
test('popup saves one entry across failed acknowledgement, repeat click and new invocation', async({page})=>{
  await popup(page);await expect(page.getByRole('textbox',{name:'Текст записи'})).toHaveValue('Несекретный тест')
  await page.getByRole('textbox',{name:'Текст записи'}).fill('Проверенная версия')
  await page.getByRole('button',{name:'Сохранить запись'}).click();await expect(page.getByRole('alert')).toContainText('не будет продублирована')
  await expect.poll(()=>count(page)).toBe(1)
  await expect(page.getByRole('textbox',{name:'Текст записи'})).toBeDisabled();await expect(page.getByLabel('Дата записи')).toBeDisabled()
  await page.getByRole('button',{name:'Повторить подтверждение'}).click();await expect.poll(()=>count(page)).toBe(1)
  await page.reload()
  await expect(page.getByRole('textbox',{name:'Текст записи'})).toHaveValue('Проверенная версия')
  await expect(page.getByRole('textbox',{name:'Текст записи'})).toBeDisabled()
  await page.getByRole('button',{name:'Повторить подтверждение'}).click();await expect.poll(()=>count(page)).toBe(1)
  await page.evaluate(()=>{const w=window as any;w.__allowAck=true;w.__status.result={sessionId:'test-2',date:'2026-10-04',text:'Второй вызов'}})
  await expect(page.getByRole('textbox',{name:'Текст записи'})).toHaveValue('Второй вызов')
  await expect(page.getByRole('textbox',{name:'Текст записи'})).toBeEnabled()
  await page.getByRole('button',{name:'Сохранить запись'}).click();await expect.poll(()=>count(page)).toBe(2)
  await page.screenshot({path:'test-results/overlay-review.png'})
})
test('popup cancellation creates no entry and recording Stop only requests completion', async({page})=>{
  await popup(page,'recording');await page.getByRole('button',{name:'Завершить диктовку'}).click()
  expect(await page.evaluate(()=>(window as any).__calls)).toEqual(['finish'])
  await page.getByRole('button',{name:'Отменить диктовку'}).click()
  expect(await page.evaluate(()=>(window as any).__calls)).toEqual(['finish','cancel'])
  expect(await count(page)).toBe(0)
})
