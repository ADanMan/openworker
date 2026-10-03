/** Local-only bridge. Deliberately has no Web Speech API or network fallback. */
export interface LocalVoiceBridge {
  localVoiceStatus(): string
  downloadLocalVoiceModel(): void
  cancelLocalVoiceDownload(): void
  startLocalVoice(sessionId: string): void
  startLocalWake?(sessionId: string): void
  localWakeRecovery?(): string
  clearLocalWakeRecovery?(sessionId: string): boolean
  stopLocalVoice(sessionId: string): void
  cancelLocalVoice(sessionId: string): void
}

export interface LocalVoiceEvent {
  sessionId: string
  state: 'loading' | 'waiting' | 'recording' | 'processing' | 'result' | 'wake_result' | 'error' | 'cancelled' | 'downloading' | 'ready'
  text?: string
  error?: string
  progress?: number
}

export interface LocalVoiceState {
  supported: boolean
  modelReady: boolean
  wakeSupported: boolean
  phase: 'idle' | 'loading' | 'waiting' | 'recording' | 'processing' | 'downloading' | 'cancelling'
  progress: number
  error: string
}

declare global {
  interface Window { __otLocalVoice?: (event: LocalVoiceEvent) => void }
}

export function localVoiceBridge(): LocalVoiceBridge | undefined {
  if (typeof window === 'undefined') return
  const b = window.OpenTweekNative
  if (b && ['localVoiceStatus', 'downloadLocalVoiceModel', 'cancelLocalVoiceDownload', 'startLocalVoice',
    'stopLocalVoice', 'cancelLocalVoice'].every((key) => typeof (b as unknown as Record<string, unknown>)[key] === 'function')) {
    return b as typeof b & LocalVoiceBridge
  }
}

export class LocalVoiceController {
  private state: LocalVoiceState = { supported: false, modelReady: false, wakeSupported: false, phase: 'idle', progress: 0, error: '' }
  private session = ''
  private disposed = false
  private subscribers = new Set<() => void>()

  private bridge?: LocalVoiceBridge
  private newId: () => string

  constructor(bridge?: LocalVoiceBridge, newId: () => string = () => crypto.randomUUID()) {
    this.bridge = bridge
    this.newId = newId
    if (bridge) {
      try {
        const status = JSON.parse(bridge.localVoiceStatus())
        this.state = { ...this.state, supported: status.supported === true, modelReady: status.modelReady === true,
          wakeSupported: status.wakeSupported === true && typeof bridge.startLocalWake === 'function',
          phase: status.downloading ? 'downloading' : 'idle', progress: Number(status.progress) || 0 }
        if (typeof status.wakeSessionId === 'string' && status.wakeSessionId && status.wakeSessionId.length <= 128
          && ['loading', 'waiting', 'recording', 'processing'].includes(status.wakeState)) {
          this.session = status.wakeSessionId
          this.state.phase = status.wakeState
        }
      } catch { this.state.error = 'unavailable' }
    }
  }

  snapshot = () => this.state
  subscribe = (fn: () => void) => { this.subscribers.add(fn); return () => { this.subscribers.delete(fn) } }
  private update(patch: Partial<LocalVoiceState>) {
    this.state = { ...this.state, ...patch }
    this.subscribers.forEach((fn) => fn())
  }

  start() {
    this.begin(false)
  }

  /** Consent is per activation; callers must obtain it through the visible experimental control. */
  startWake(confirmed = false) {
    if (!confirmed) return
    if (!this.state.wakeSupported) return this.update({ error: 'wake_unsupported' })
    this.begin(true)
  }

  private begin(wake: boolean) {
    if (this.disposed || this.state.phase !== 'idle') return
    if (!this.bridge || !this.state.supported) return this.update({ error: 'unsupported' })
    if (!this.state.modelReady) return this.update({ error: 'model_missing' })
    this.session = this.newId()
    this.update({ phase: 'loading', error: '' })
    try { if (wake) this.bridge.startLocalWake!(this.session); else this.bridge.startLocalVoice(this.session) }
    catch { this.session = ''; this.update({ phase: 'idle', error: 'unavailable' }) }
  }

  stop() {
    if (!this.session || this.state.phase !== 'recording') return
    this.update({ phase: 'processing' })
    try { this.bridge?.stopLocalVoice(this.session) } catch { this.cancel(); this.update({ error: 'unavailable' }) }
  }

  cancel() {
    const id = this.session
    this.session = '' // Reject a callback even if native cancellation synchronously emits one.
    if (id) { try { this.bridge?.cancelLocalVoice(id) } catch { /* Already stopped. */ } }
    if (this.state.phase !== 'downloading' && this.state.phase !== 'cancelling') this.update({ phase: 'idle' })
  }

  download() {
    if (this.disposed || !this.bridge || !this.state.supported || this.state.phase !== 'idle') return
    this.update({ phase: 'downloading', progress: 0, error: '' })
    try { this.bridge.downloadLocalVoiceModel() } catch { this.update({ phase: 'idle', error: 'download_failed' }) }
  }

  cancelDownload() {
    if (this.state.phase !== 'downloading' && this.state.phase !== 'cancelling') return
    this.update({ phase: 'cancelling' })
    try { this.bridge?.cancelLocalVoiceDownload() } catch { this.update({ phase: 'idle', error: 'download_failed' }) }
  }

  /** Returns final text once. Saving belongs exclusively to the editor's explicit Save action. */
  receive(event: LocalVoiceEvent): string | null {
    if (this.disposed || !event || typeof event !== 'object') return null
    if (!event.sessionId) {
      if (this.session) return null // Late model callbacks cannot reset active microphone state.
      if (event.state === 'ready') this.update({ modelReady: true, phase: 'idle', progress: 1, error: '' })
      else if (event.state === 'downloading' && this.state.phase !== 'cancelling') this.update({ phase: 'downloading', progress: Math.max(0, Math.min(1, event.progress ?? 0)) })
      else if (event.state === 'error') this.update({ phase: 'idle', error: event.error || 'download_failed' })
      else if (event.state === 'cancelled') this.update({ phase: 'idle', progress: 0 })
      return null
    }
    if (!this.session || event.sessionId !== this.session) return null
    if (event.state === 'waiting') {
      if (this.state.phase === 'loading' || this.state.phase === 'waiting') this.update({ phase: 'waiting' })
    } else if (event.state === 'loading' || event.state === 'recording' || event.state === 'processing') {
      this.update({ phase: event.state })
    } else if (event.state === 'result' || event.state === 'wake_result' || event.state === 'error' || event.state === 'cancelled') {
      this.session = ''
      const text = typeof event.text === 'string' ? event.text.trim() : ''
      this.update({ phase: 'idle', error: event.state === 'error' ? event.error || 'recognition_failed' : event.state === 'result' && !text ? 'no_speech' : '' })
      if (event.state === 'result' && text) return text
    }
    return null
  }

  dispose() { this.cancel(); this.disposed = true; this.subscribers.clear() }
}
