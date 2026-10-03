import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { LocalVoiceController, localVoiceBridge } from '../lib/localVoice'
import { j } from '../lib/journalCopy'
import { Icon } from './Icon'

export function LocalDictation({ onText, onBusy }: { onText: (text: string) => void; onBusy: (busy: boolean) => void }) {
  const [controller] = useState(() => new LocalVoiceController(localVoiceBridge()))
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot)
  const handlers = useRef({ onText, onBusy })
  const [seconds, setSeconds] = useState(0)
  const recording = state.phase === 'recording'
  const busy = ['loading', 'recording', 'processing'].includes(state.phase)
  useEffect(() => { handlers.current = { onText, onBusy } }, [onText, onBusy])
  useEffect(() => {
    const previous = window.__otLocalVoice
    const handler: NonNullable<Window['__otLocalVoice']> = (event) => {
      const text = controller.receive(event)
      if (text) handlers.current.onText(text)
    }
    window.__otLocalVoice = handler
    return () => {
      controller.cancel()
      if (window.__otLocalVoice === handler) window.__otLocalVoice = previous
    }
  }, [controller])
  useEffect(() => { handlers.current.onBusy(busy) }, [busy])
  useEffect(() => {
    if (!recording) return
    const start = Date.now()
    const interval = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 250)
    return () => clearInterval(interval)
  }, [recording])

  const error = !state.error ? '' : state.error === 'permission_denied' ? j('permission')
    : state.error === 'unsupported' ? j('unsupported') : state.error === 'model_missing' ? j('modelMissing')
      : state.error === 'no_speech' ? j('noSpeech') : /download|checksum|space|extract|model_install/.test(state.error) ? j('downloadFailed') : j('failed')

  return <section className="local-dictation" aria-label={j('voice')}>
    <h3><Icon name="mic" /> {j('voice')}</h3>
    {!state.supported ? <p>{j('unsupported')}</p> : <>
      <p className="journal-hint">{j('voicePrivacy')}</p>
      {!state.modelReady && <p className="journal-hint">{j('model')}</p>}
      <div className={`voice-status${recording ? ' recording' : ''}`} role="status" aria-live="polite">
        {recording && <span className="recording-dot" aria-hidden="true" />}
        {state.phase === 'cancelling' ? j('cancellingDownload') : state.phase === 'downloading' ? `${j('downloading')} ${Math.round(state.progress * 100)}%`
          : recording ? `${j('recording')} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
            : state.phase === 'loading' ? j('loading') : state.phase === 'processing' ? j('processing')
              : state.modelReady ? j('ready') : j('modelMissing')}
      </div>
      <div className="journal-buttons">
        {state.phase === 'downloading' || state.phase === 'cancelling' ? <button disabled={state.phase === 'cancelling'} className="btn" onClick={() => controller.cancelDownload()}>{j('cancelDownload')}</button>
          : busy ? <>
            {recording && <button className="btn primary" onClick={() => controller.stop()}>{j('stop')}</button>}
            <button className="btn" onClick={() => controller.cancel()}>{j('cancelRecording')}</button>
          </> : state.modelReady ? <button className="btn" onClick={() => { setSeconds(0); controller.start() }}><Icon name="mic" /> {j('record')}</button>
            : <button className="btn" onClick={() => controller.download()}>{j('download')}</button>}
      </div>

    </>}
    {error && <p className="journal-error" role="alert">{error}</p>}
    <details className="journal-hint"><summary>{j('voiceDetails')}</summary>
      {state.supported && <p>{j('foreground')} {j('pause')}</p>}<p>{j('wake')}</p>
    </details>
  </section>
}
