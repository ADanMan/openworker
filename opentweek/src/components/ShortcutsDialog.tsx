import { Dialog } from './Dialog'

const SHORTCUTS: [string, string][] = [
  ['← / →', 'Previous / next week (or month)'],
  ['T', 'Jump to today'],
  ['W / M', 'Week view / month view'],
  ['N', 'New task today'],
  ['/ or Ctrl+K', 'Search'],
  ['H', 'Hide / show completed tasks'],
  ['S', 'Show / hide Someday lists'],
  ['P', 'Print'],
  [',', 'Settings'],
  ['?', 'This help'],
  ['Tab', 'Move focus between tasks'],
  ['Enter', 'Edit focused task'],
  ['E / O', 'Open focused task details'],
  ['X / D', 'Toggle focused task done'],
  ['Delete', 'Delete focused task (undo available)'],
  ['Space, arrows, Space', 'Pick up, move, drop focused task'],
]

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map(([k, v]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  )
}
