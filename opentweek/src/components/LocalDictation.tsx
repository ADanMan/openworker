import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { LocalVoiceController, localVoiceBridge } from '../lib/localVoice'
import { j } from '../lib/journalCopy'
import { Icon } from './Icon'

export function LocalDictation({ onText, onBusy, onRecoveredText, allowWake = false }: { onText: (text: string) => void | Promise<boolean | void>; onBusy: (busy: boolean) => void; onRecoveredText?: (text: string, sessionId: string) => Promise<void>; allowWake?: boolean }) {
  const [controller] = useState(() => new LocalVoiceController(localVoiceBridge()))
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot)
  const handlers = useRef({ onText, onBusy, onRecoveredText })
  const [seconds, setSeconds] = useState(0)
  const [wakeConsent, setWakeConsent] = useState(false)
  const [recovery, setRecovery] = useState<{ sessionId: string; text: string } | null>(null)
  const [inserting, setInserting] = useState(false)
  const [recoveryError, setRecoveryError] = useState('')
  const attachment = useRef({ generation: 0 })
  const recording = state.phase === 'recording'
  const waiting = state.phase === 'waiting'
  const busy = ['loading', 'waiting', 'recording', 'processing'].includes(state.phase)
  useEffect(() => { handlers.current = { onText, onBusy, onRecoveredText } }, [onText, onBusy, onRecoveredText])
  useEffect(() => {
    const lifecycle = attachment.current
    lifecycle.generation++
    const previous = window.__otLocalVoice
    const handler: NonNullable<Window['__otLocalVoice']> = (event) => {
      const text = controller.receive(event)
      if (text) void handlers.current.onText(text)
    }
    window.__otLocalVoice = handler
    return () => {
      const departing = ++lifecycle.generation
      // StrictMode rehearses effects; only an actual departure cancels the native session.
      queueMicrotask(() => { if (lifecycle.generation === departing) controller.cancel() })
      if (window.__otLocalVoice === handler) window.__otLocalVoice = previous
    }
  }, [controller])
  useEffect(() => { handlers.current.onBusy(busy || inserting) }, [busy, inserting])
  useEffect(() => {
    if (!allowWake) return
    const refresh = () => {
      try {
        const pending = JSON.parse(localVoiceBridge()?.localWakeRecovery?.() || 'null')
        if (pending && typeof pending.sessionId === 'string' && typeof pending.text === 'string') {
          setRecovery(current => current && current.sessionId === pending.sessionId && current.text === pending.text ? current : { sessionId: pending.sessionId, text: pending.text })
          controller.receive({ sessionId: pending.sessionId, state: 'wake_result' })
        } else setRecovery(null)
      } catch { /* Leave any displayed recovery intact if bridge is temporarily unavailable. */ }
    }
    refresh()
    const timer = setInterval(refresh, 1000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [allowWake, controller])
  const acceptRecovery = async () => {
    if (!recovery || inserting || busy) return
    setInserting(true); setRecoveryError('')
    try {
      if (!handlers.current.onRecoveredText) throw new Error('recovery_destination_unavailable')
      await handlers.current.onRecoveredText(recovery.text, recovery.sessionId)
      if (localVoiceBridge()?.clearLocalWakeRecovery?.(recovery.sessionId) !== true) throw new Error('ack_failed')
      setRecovery(null)
    } catch { setRecoveryError(j('saveFailed')) }
    finally { setInserting(false) }
  }
  useEffect(() => {
    if (!recording && !waiting) return
    const start = Date.now()
    const interval = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 250)
    return () => clearInterval(interval)
  }, [recording, waiting])

  const diagnosticErrors: Record<string, string> = {
    microphone_silenced: 'Android заглушил микрофон приложения. Он может быть занят записью экрана или звонком. Остановите другую запись и запустите диктовку снова.',
    microphone_unavailable: 'Микрофон недоступен. Проверьте доступ к микрофону и попробуйте снова.',
    microphone_read_failed: 'Не удалось получить звук с микрофона. Сеанс остановлен; черновик сохранён.',
    microphone_disconnected: 'Подключение к микрофону прервалось. Запустите диктовку снова.',
    foreground_service_denied: 'Android не разрешил запустить фоновый микрофон. Откройте приложение и включите ожидание из дневника.',
    foreground_service_unavailable: 'Фоновый микрофон не запустился. Можно использовать кнопку диктовки в открытом приложении.',
  }
  const error = diagnosticErrors[state.error] || (!state.error ? '' : state.error === 'permission_denied' ? j('permission')
    : state.error === 'unsupported' ? j('unsupported') : state.error === 'model_missing' ? j('modelMissing')
      : state.error === 'no_speech' ? j('noSpeech') : state.error === 'wake_timeout' ? j('wakeTimeout')
        : state.error === 'notification_permission' ? j('wakeNotifications') : state.error === 'wake_unsupported' ? j('wakeUnavailable')
          : /download|checksum|space|extract|model_install/.test(state.error) ? j('downloadFailed') : j('failed'))

  return <section className="local-dictation" aria-label={j('voice')}>
    <h3><Icon name="mic" /> {j('voice')}</h3>
    {!state.supported ? <p>{j('unsupported')}</p> : <>
      <p className="journal-hint">Звук обрабатывается на телефоне. Текст добавляется в черновик.</p>
      {!state.modelReady && <p className="journal-hint">{j('model')}</p>}
      <div className={`voice-status${recording || waiting ? ' recording' : ''}`} role="status" aria-live="polite">
        {(recording || waiting) && <span className="recording-dot" aria-hidden="true" />}
        {state.phase === 'cancelling' ? j('cancellingDownload') : state.phase === 'downloading' ? `${j('downloading')} ${Math.round(state.progress * 100)}%`
          : waiting ? `${j('wakeWaiting')} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
            : recording ? `${j('recording')} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
            : state.phase === 'loading' ? j('loading') : state.phase === 'processing' ? j('processing')
              : state.modelReady ? j('ready') : j('modelMissing')}
      </div>
      <div className="journal-buttons">
        {state.phase === 'downloading' || state.phase === 'cancelling' ? <button disabled={state.phase === 'cancelling'} className="btn" onClick={() => controller.cancelDownload()}>{j('cancelDownload')}</button>
          : busy ? <>
            {recording && <button className="btn primary" onClick={() => controller.stop()}>{j('stop')}</button>}
            <button className="btn" onClick={() => controller.cancel()}>{waiting ? j('stopWaiting') : j('cancelRecording')}</button>
          </> : state.modelReady ? <button className="btn" disabled={inserting} onClick={() => { setSeconds(0); controller.start() }}><Icon name="mic" /> {j('record')}</button>
            : <button className="btn" onClick={() => controller.download()}>{j('download')}</button>}
      </div>
      {waiting && <p className="journal-hint">Скажите «эй, Твик» и сделайте паузу. Начинайте диктовку после смены состояния на «Идёт запись». Если фраза не сработала, прекратите ожидание и используйте кнопку диктовки.</p>}
      {allowWake && state.wakeSupported && <details className="wake-experiment">
        <summary>{j('wakeExperiment')}</summary>
        <p className="journal-hint">Микрофон слушает до 5 минут, в том числе в других приложениях. Фраза может не сработать. Включите режим ниже; остановить его можно здесь или в уведомлении.</p>
        <label className="wake-opt-in"><input type="checkbox" checked={wakeConsent} disabled={busy || inserting} onChange={(e) => setWakeConsent(e.target.checked)} /> {j('wakeOptIn')}</label>
        <button className="btn" disabled={!wakeConsent || !state.modelReady || state.phase !== 'idle' || !!recovery || inserting} onClick={() => { setSeconds(0); controller.startWake(wakeConsent) }}>{j('startWaiting')}</button>
      </details>}
    </>}
    {error && <p className="journal-error" role="alert">{error}</p>}
    {allowWake && recovery && <section className="wake-recovery" aria-label={j('wakeReview')}>
      <h4>{j('wakeReview')}</h4><p className="journal-hint">{j('wakeRecoveryHint')}</p>
      <blockquote>{recovery.text}</blockquote>
      <div className="journal-buttons"><button className="btn primary" disabled={busy || inserting} onClick={() => void acceptRecovery()}>{j('wakeInsert')}</button>
        <button className="btn" disabled={busy || inserting} onClick={() => {
          if (localVoiceBridge()?.clearLocalWakeRecovery?.(recovery.sessionId) === true) setRecovery(null)
          else setRecoveryError(j('saveFailed'))
        }}>{j('wakeDiscard')}</button></div>
      {recoveryError && <p role="alert">{recoveryError}</p>}
    </section>}
    <details className="journal-hint"><summary>{j('voiceDetails')}</summary>
      <p>{j('voicePrivacy')}</p>{state.supported && <p>{j('foreground')} {j('pause')}</p>}<p>{j('wake')}</p><p>{j('wakeConsent')}</p>
    </details>
  </section>
}
