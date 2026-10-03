import { useEffect, useRef, useState } from 'react'
import { localVoiceBridge } from '../lib/localVoice'
interface Status { overlaySupported?: boolean; overlayAllowed?: boolean; overlayActive?: boolean; overlayStarting?: boolean; overlayError?: string; overlayRemaining?: number; modelReady?: boolean; wakeState?: string; wakeSessionId?: string; pendingResult?: boolean }
const errors:Record<string,string> = {
  overlay_permission:'Разрешение «Поверх других приложений» не выдано. Микрофон не запущен.',
  overlay_settings_unavailable:'Android не открыл страницу разрешения. Её можно найти в настройках OpenTweek Preview.',
  overlay_unavailable:'Android не разрешил показать окно. Сеанс остановлен.',
  overlay_timeout:'Часовой сеанс завершён. Можно включить новый вручную.',
  screen_locked:'Экран выключен или заблокирован. Сеанс завершён.',
  permission_denied:'Доступ к микрофону не выдан. Сеанс не запущен.',
  notification_permission:'Для этого режима нужны видимые уведомления с кнопкой остановки.',
  pending_result:'Сначала проверьте прежнюю диктовку в дневнике.',
  microphone_silenced:'Android заглушил микрофон. Он может быть занят звонком или записью экрана. Сеанс остановлен.',
  foreground_service_denied:'Android не разрешил запуск. Включите режим из открытого приложения.',
  foreground_service_unavailable:'Фоновый микрофон не запустился.',
  no_speech:'Речь не распознана. Сеанс остановлен; сохранённые записи не изменились.',
}
export function BackgroundVoiceMode() {
  const bridge = localVoiceBridge()
  const [status,setStatus] = useState<Status>({}), [consent,setConsent] = useState(false), [localError,setError] = useState('')
  const requested = useRef('')
  const [requestedId,setRequestedId] = useState('')
  useEffect(()=> {
    const refresh=()=> {try {
      const next = JSON.parse(bridge?.localVoiceStatus() || '{}') as Status
      setStatus(next)
      if (requested.current && ((next.wakeSessionId === requested.current && (next.overlayActive || next.overlayStarting)) || next.overlayError)) {
        requested.current = ''; setRequestedId('')
      }
    } catch {setError('Не удалось проверить состояние режима.')} }
    refresh(); const timer=setInterval(refresh,500); window.addEventListener('focus',refresh)
    return()=>{clearInterval(timer);window.removeEventListener('focus',refresh)}
  },[bridge])
  if (!status.overlaySupported || !bridge?.startLocalOverlay || !bridge.requestLocalOverlayPermission) return null
  const active=status.overlayActive || status.overlayStarting || !!requestedId
  const phase=status.wakeState==='review'?'Микрофон выключен · проверка записи':status.wakeState==='recording'?'Записываем диктовку':status.wakeState==='processing'?'Обрабатываем диктовку':status.overlayStarting || requestedId?'Ожидаем разрешений Android':status.wakeState==='loading'?'Загружаем модель':'Микрофон включён · ждём «эй, Твик»'
  return <details className="background-voice-mode" open={active || !!status.overlayError || !!localError || undefined}>
    <summary>«Эй, Твик» из других приложений {active?'· включено':''}</summary>
    <p>Явный сеанс до 1 часа: после фразы откроется небольшое окно дневника. Микрофон постоянно слушает и расходует батарею. После сохранения или отмены снова ждём фразу; качество экспериментальное.</p>
    <p>Нужны микрофон, уведомления и разрешение «Поверх других приложений». На заблокированном экране режим завершится. После force-stop или перезагрузки включите его снова вручную. Некоторые приложения могут скрывать сторонние окна.</p>
    {active ? <><p role="status">{phase}{status.overlayActive?` · осталось ${Math.ceil((status.overlayRemaining || 0)/60000)} мин.`:''}</p>
      <button className="btn" onClick={()=> {
        const id = requested.current || status.wakeSessionId || ''
        setConsent(false); requested.current = ''; setRequestedId('')
        if (bridge.stopLocalOverlay) bridge.stopLocalOverlay(id); else bridge.cancelLocalVoice(id)
      }}>Выключить вызов из приложений</button></>
    : <>
      {!status.modelReady && <p>Сначала скачайте локальную модель в разделе диктовки дневника.</p>}
      {status.pendingResult && <p>Сначала проверьте прежнюю диктовку в дневнике: вставьте или удалите её.</p>}
      {!status.overlayAllowed && <button className="btn" onClick={()=>{setError('');bridge.requestLocalOverlayPermission!()}}>Разрешить окно в настройках Android</button>}
      <label className="wake-opt-in"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} /> Разрешить микрофон и окно на этот сеанс</label>
      <button className="btn primary" disabled={!consent || !status.modelReady || !status.overlayAllowed || status.pendingResult} onClick={()=>{
        if (requested.current) return
        const id = crypto.randomUUID(); requested.current = id; setRequestedId(id); setError('')
        try { bridge.startLocalOverlay!(id) } catch { requested.current = ''; setRequestedId(''); setError('Не удалось запустить сеанс.') }
      }}>Включить на 1 час</button>
    </>}
    {(status.overlayError || localError) && <p className="journal-error" role="alert">{localError || errors[status.overlayError!] || 'Сеанс остановлен: микрофон или распознавание недоступны.'}</p>}
  </details>
}
