import { t, type Key } from '../i18n'
import { Dialog } from './Dialog'

const SHORTCUTS: [string, Key][] = [
  ['← / →', 'kPrevNext'],
  ['T', 'kToday'],
  ['W / M', 'kView'],
  ['N', 'kNew'],
  ['V', 'kVoice'],
  ['/ · Ctrl+K', 'kSearch'],
  ['H', 'kHide'],
  ['S', 'kSomeday'],
  ['P', 'kPrint'],
  [',', 'kSettings'],
  ['?', 'kHelp'],
  ['Tab', 'kTab'],
  ['Enter', 'kEdit'],
  ['E / O', 'kOpen'],
  ['X / D', 'kDone'],
  ['Delete', 'kDelete'],
  ['Space, ←↑→↓, Space', 'kDrag'],
]

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title={t('shortcuts')} onClose={onClose}>
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map(([k, v]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{t(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  )
}
