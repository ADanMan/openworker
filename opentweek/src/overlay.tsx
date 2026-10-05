import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { overlayReceipt, saveOverlayEntry } from './lib/journalWake'
import { JOURNAL_TEXT_MAX_LENGTH } from './lib/journal'
import { useSettings } from './hooks/data'
import { useTheme } from './hooks/theme'
import { Icon } from './components/Icon'
import './fonts.css'
import './overlay.css'
interface Pending { sessionId: string; text: string; date: string }
interface Status { sessionId: string; state: string; result?: Pending }
interface Bridge {
  status(): string; finish(): void; cancel(): void; stop(): void
  beginSave(id: string): boolean; releaseSave(): void; acknowledge(id: string): boolean
}
declare global { interface Window { OpenTweekOverlay?: Bridge } }
export function Overlay() {
  useTheme(useSettings())
  const bridge = window.OpenTweekOverlay
  const [status, setStatus] = useState<Status>({sessionId:'',state:'loading'})
  const [text, setText] = useState(''), [date, setDate] = useState(''), [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(true), [committed, setCommitted] = useState(false)
  const seen = useRef(''), operation = useRef(false)
  const feedback = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (error) feedback.current?.scrollIntoView({block:'start'}) }, [error])
  useEffect(() => {
    let attached = true
    const refresh = () => {
      try {
        const next = JSON.parse(bridge?.status() || '{}') as Status
        setStatus(next)
        const result = next.result
        if (result && typeof result.sessionId === 'string' && typeof result.text === 'string' && typeof result.date === 'string' && result.sessionId !== seen.current) {
          seen.current = result.sessionId; setText(result.text); setDate(result.date); setError(''); setChecking(true); setCommitted(false)
          void overlayReceipt(result.sessionId).then(receipt => {
            if (!attached || seen.current !== result.sessionId) return
            if (receipt) { setCommitted(true); setText(receipt.text ?? result.text); setDate(receipt.date ?? result.date) }
            setChecking(false)
          }).catch(() => {
            if (!attached || seen.current !== result.sessionId) return
            setError('Не удалось проверить сохранение. Повторяем проверку; диктовка остаётся на телефоне.'); seen.current = ''
          })
        }
      } catch { setError('Окно временно недоступно. Можно выключить режим кнопкой сверху.') }
    }
    refresh(); const timer = setInterval(refresh, 300); return () => { attached = false; clearInterval(timer) }
  }, [bridge])
  const save = async () => {
    if (operation.current || checking || !status.result || !text.trim() || !date || !bridge) return
    if (!bridge.beginSave(status.result.sessionId)) { setError('Не удалось начать сохранение. Диктовка осталась для проверки в приложении.'); return }
    operation.current = true; setSaving(true); setError('')
    try {
      if (!committed) {
        await saveOverlayEntry({sessionId:status.result.sessionId,text,date})
        setCommitted(true)
      }
      if (!bridge.acknowledge(status.result.sessionId)) setError('Запись уже сохранена. Повторите подтверждение: она не будет продублирована.')
    } catch { setError('Не удалось завершить сохранение. Диктовка осталась для проверки; повторите действие.') }
    finally { bridge.releaseSave(); operation.current = false; setSaving(false) }
  }
  if (!bridge) return <main><p>Это окно доступно в Android Preview после явного включения режима.</p></main>
  return <main aria-label="Окно диктовки дневника">
    {status.state === 'review' && status.result ? <>
      <header className="popup-heading"><h1>{committed?'Запись сохранена':'Проверьте запись'}</h1><span className="popup-state"><Icon name="check" size={14} /> Микрофон выключен</span></header>
      <div className="popup-fields">
      <label>Дата <input aria-label="Дата записи" type="date" value={date} disabled={saving || checking || committed} onChange={e=>setDate(e.target.value)} /></label>
      <label>Текст <textarea aria-label="Текст записи" rows={3} maxLength={JOURNAL_TEXT_MAX_LENGTH} value={text} disabled={saving || checking || committed} onChange={e=>setText(e.target.value)} /></label>
      <p>{committed?'Изменить запись можно в дневнике.':'После сохранения или отмены снова ждём фразу.'}</p>
      {error && <p ref={feedback} className="error" role="alert">{error}</p>}
      </div><footer className="popup-actions">
      <button disabled={saving || checking || !text.trim() || !date} onClick={()=>void save()}>{saving?'Сохраняем…':committed?'Повторить подтверждение':'Сохранить запись'}</button>
      <button className="secondary" disabled={saving} onClick={()=>bridge.cancel()}>{committed?'Закрыть сохранённую запись':'Отменить диктовку'}</button>
      </footer>
    </> : <>
      <header className="popup-heading"><h1 role="status">{status.state==='recording'?'Микрофон включён · говорите':status.state==='processing'?'Обрабатываем на телефоне…':status.state==='stopped'?'Сеанс завершён':'Готовим диктовку…'}</h1><span className={`popup-state${status.state==='recording'?' recording':''}`}><Icon name="mic" size={14} /> На этом телефоне</span></header>
      <div className="popup-fields"><p>Опишите ситуацию и чувства. Завершите диктовку, затем проверьте текст перед сохранением.</p>
      {error && <p ref={feedback} className="error" role="alert">{error}</p>}
      </div><footer className="popup-actions">
      {status.state==='recording' && <button onClick={()=>bridge.finish()}>Завершить диктовку</button>}
      <button className="secondary" onClick={()=>bridge.cancel()}>Отменить диктовку</button>
      </footer>
    </>}
  </main>
}
createRoot(document.getElementById('root')!).render(<Overlay />)
