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
