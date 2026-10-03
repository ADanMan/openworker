import { useRef, useState } from 'react'
import { j } from '../lib/journalCopy'
import { Dialog } from './Dialog'
import { LocalDictation } from './LocalDictation'

export function TaskVoiceDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (text: string) => Promise<void> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const savingRef = useRef(false)
  const submit = async () => {
    if (busy || savingRef.current || !text.trim()) return
    savingRef.current = true; setSaving(true)
    try { await onSubmit(text); onClose() }
    catch { setError(j('saveFailed')) }
    finally { savingRef.current = false; setSaving(false) }
  }
  return <Dialog title={j('taskVoice')} onClose={onClose} canClose={() => !savingRef.current && (!text.trim() || window.confirm(j('discard')))}>
    <label className="field"><span>{j('taskText')}</span><textarea value={text} maxLength={2000} disabled={busy || saving} onChange={(e) => setText(e.target.value)} /></label>
    <LocalDictation onBusy={setBusy} onText={(phrase) => setText((old) => [old, phrase].filter(Boolean).join(' ').slice(0, 2000))} />
    {error && <p role="alert">{error}</p>}
    <button className="btn primary" disabled={busy || saving || !text.trim()} onClick={submit}>{j('addTask')}</button>
  </Dialog>
}
