import { describe, expect, it } from 'vitest'
import { LocalVoiceController, type LocalVoiceBridge } from '../lib/localVoice'

function setup(ready = true) {
  const calls: string[] = []
  const bridge: LocalVoiceBridge = {
    localVoiceStatus: () => JSON.stringify({ supported: true, modelReady: ready, downloading: false, progress: 0 }),
    downloadLocalVoiceModel: () => { calls.push('download') },
    cancelLocalVoiceDownload: () => { calls.push('cancelDownload') },
    startLocalVoice: (id) => { calls.push(`start:${id}`) },
    stopLocalVoice: (id) => { calls.push(`stop:${id}`) },
    cancelLocalVoice: (id) => { calls.push(`cancel:${id}`) },
  }
  let n = 0
  return { controller: new LocalVoiceController(bridge, () => `s${++n}`), calls }
}

describe('local dictation lifecycle', () => {
  it('requires an installed model and never starts a network recognizer on unsupported hosts', () => {
    const c = new LocalVoiceController(undefined)
    c.start()
    expect(c.snapshot().error).toBe('unsupported')
    const { controller, calls } = setup(false)
    controller.start()
    expect(controller.snapshot().error).toBe('model_missing')
    expect(calls).toEqual([])
  })
  it('only downloads following an explicit request', () => {
    const { controller, calls } = setup(false)
    expect(calls).toEqual([])
    controller.download()
    expect(calls).toEqual(['download'])
  })
  it('does not deliver a result after cancellation or allow it to affect a new session', () => {
    const { controller, calls } = setup()
    controller.start()
    controller.cancel()
    controller.start()
    expect(controller.receive({ sessionId: 's1', state: 'result', text: 'discard this' })).toBeNull()
    expect(controller.snapshot().phase).toBe('loading')
    expect(controller.receive({ sessionId: 's2', state: 'result', text: 'мой черновик' })).toBe('мой черновик')
    expect(calls).toContain('cancel:s1')
  })
  it('delivers each final transcript once and never persists it', () => {
    const { controller } = setup()
    controller.start()
    const e = { sessionId: 's1', state: 'result' as const, text: 'Сегодня спокойно' }
    expect(controller.receive(e)).toBe('Сегодня спокойно')
    expect(controller.receive(e)).toBeNull()
    expect(controller.snapshot().phase).toBe('idle')
  })
  it('handles denied permissions without retry or fallback', () => {
    const { controller, calls } = setup()
    controller.start()
    controller.receive({ sessionId: 's1', state: 'error', error: 'permission_denied' })
    expect(controller.snapshot().error).toBe('permission_denied')
    expect(controller.snapshot().phase).toBe('idle')
    expect(calls).toEqual(['start:s1'])
  })
  it('only starts once while busy, requests stop once, and permits cancellation during processing', () => {
    const { controller, calls } = setup()
    controller.start(); controller.start()
    controller.receive({ sessionId: 's1', state: 'recording' })
    controller.stop(); controller.stop(); controller.cancel()
    expect(calls).toEqual(['start:s1', 'stop:s1', 'cancel:s1'])
    expect(controller.receive({ sessionId: 's1', state: 'result', text: 'late' })).toBeNull()
  })
  it('disposal cancels recording and suppresses later callbacks', () => {
    const { controller, calls } = setup()
    controller.start(); controller.dispose()
    expect(calls).toEqual(['start:s1', 'cancel:s1'])
    expect(controller.receive({ sessionId: 's1', state: 'recording' })).toBeNull()
    expect(controller.snapshot().phase).toBe('idle')
  })
})

describe('model setup failures', () => {
  it('never marks an unsuccessful download as ready or opens the microphone', () => {
    const { controller, calls } = setup(false)
    controller.download()
    controller.receive({ sessionId: '', state: 'downloading', progress: 0.8 })
    controller.receive({ sessionId: '', state: 'error', error: 'download_failed' })
    controller.start()
    expect(controller.snapshot()).toMatchObject({ modelReady: false, phase: 'idle', error: 'model_missing' })
    expect(calls).toEqual(['download'])
  })
})

describe('download cancellation acknowledgement', () => {
  it('does not lose a retry while native cleanup is still running', () => {
    const { controller, calls } = setup(false)
    controller.download(); controller.cancelDownload(); controller.download()
    expect(calls).toEqual(['download', 'cancelDownload'])
    controller.receive({ sessionId: '', state: 'downloading', progress: 0.4 })
    expect(controller.snapshot().phase).toBe('cancelling')
    controller.receive({ sessionId: '', state: 'cancelled' })
    controller.download()
    expect(calls).toEqual(['download', 'cancelDownload', 'download'])
  })
})

describe('experimental wake sessions', () => {
  function wake(ready = true) {
    const calls: string[] = []
    let n = 0
    const bridge: LocalVoiceBridge = {
      localVoiceStatus: () => JSON.stringify({ supported: true, modelReady: ready, wakeSupported: true }),
      downloadLocalVoiceModel() {}, cancelLocalVoiceDownload() {},
      startLocalVoice: (id) => { calls.push(`start:${id}`) },
      startLocalWake: (id) => { calls.push(`wake:${id}`) },
      stopLocalVoice: (id) => { calls.push(`stop:${id}`) },
      cancelLocalVoice: (id) => { calls.push(`cancel:${id}`) },
    }
    return { calls, controller: new LocalVoiceController(bridge, () => `w${++n}`) }
  }
  it('requires fresh explicit consent and an installed model', () => {
    const { controller, calls } = wake()
    controller.startWake(); expect(calls).toEqual([])
    controller.startWake(true); controller.startWake(true)
    expect(calls).toEqual(['wake:w1'])
    expect(controller.snapshot().phase).toBe('loading')
    const missing = wake(false)
    missing.controller.startWake(true)
    expect(missing.calls).toEqual([])
    expect(missing.controller.snapshot().error).toBe('model_missing')
  })
  it('separates waiting from dictation, completes once, and never rearms automatically', () => {
    const { controller, calls } = wake()
    controller.startWake(true)
    expect(controller.receive({ sessionId: 'w1', state: 'waiting' })).toBeNull()
    expect(controller.snapshot().phase).toBe('waiting')
    controller.stop(); expect(calls).toEqual(['wake:w1'])
    controller.receive({ sessionId: 'w1', state: 'recording' })
    controller.receive({ sessionId: 'w1', state: 'waiting' })
    expect(controller.snapshot().phase).toBe('recording')
    controller.stop()
    const result = { sessionId: 'w1', state: 'result' as const, text: 'Сегодня спокойно' }
    expect(controller.receive(result)).toBe('Сегодня спокойно')
    expect(controller.receive(result)).toBeNull()
    expect(controller.snapshot().phase).toBe('idle')
    expect(calls).toEqual(['wake:w1', 'stop:w1'])
  })
  it('cancels waiting and rejects stale activation or transcript', () => {
    const { controller, calls } = wake()
    controller.startWake(true); controller.receive({ sessionId: 'w1', state: 'waiting' }); controller.cancel()
    controller.startWake(true)
    controller.receive({ sessionId: 'w1', state: 'recording' })
    expect(controller.receive({ sessionId: 'w1', state: 'result', text: 'late' })).toBeNull()
    expect(controller.snapshot().phase).toBe('loading')
    expect(calls).toEqual(['wake:w1', 'cancel:w1', 'wake:w2'])
  })
  it.each(['wake_timeout', 'notification_permission', 'permission_denied'])('terminates %s without fallback or rearm', error => {
    const { controller, calls } = wake()
    controller.startWake(true)
    controller.receive({ sessionId: 'w1', state: 'error', error })
    expect(controller.snapshot()).toMatchObject({ phase: 'idle', error })
    expect(calls).toEqual(['wake:w1'])
  })
  it('late model setup callbacks cannot hide an active microphone', () => {
    const { controller } = wake()
    controller.startWake(true); controller.receive({ sessionId: 'w1', state: 'waiting' })
    controller.receive({ sessionId: '', state: 'ready' })
    controller.receive({ sessionId: '', state: 'cancelled' })
    expect(controller.snapshot().phase).toBe('waiting')
  })
  it('older APKs expose no wake capability even if a status flag claims it', () => {
    const { controller, calls } = setup()
    controller.startWake(true)
    expect(controller.snapshot().error).toBe('wake_unsupported')
    expect(calls).toEqual([])
  })
})

it('background wake result never automatically inserts text into an editor', () => {
  const bridge: LocalVoiceBridge = {
    localVoiceStatus: () => JSON.stringify({ supported: true, modelReady: true, wakeSupported: true, wakeSessionId: 'background-1', wakeState: 'waiting' }),
    downloadLocalVoiceModel() {}, cancelLocalVoiceDownload() {}, startLocalVoice() {}, startLocalWake() {}, stopLocalVoice() {}, cancelLocalVoice() {},
  }
  const controller = new LocalVoiceController(bridge)
  expect(controller.snapshot().phase).toBe('waiting')
  expect(controller.receive({ sessionId: 'background-1', state: 'wake_result', text: 'Private pending text' })).toBeNull()
  expect(controller.snapshot().phase).toBe('idle')
})

it('an editor never adopts or cancels the separate global overlay microphone session', () => {
  const calls: string[] = []
  const bridge: LocalVoiceBridge = {
    localVoiceStatus: () => JSON.stringify({ supported:true, modelReady:true, wakeSupported:true, overlayActive:true, wakeSessionId:'global', wakeState:'waiting' }),
    downloadLocalVoiceModel() {}, cancelLocalVoiceDownload() {}, startLocalVoice() {}, startLocalWake() {}, stopLocalVoice() {},
    cancelLocalVoice: id => { calls.push(id) },
  }
  const editor = new LocalVoiceController(bridge)
  expect(editor.snapshot().phase).toBe('idle')
  editor.cancel(); editor.dispose()
  expect(calls).toEqual([])
})
