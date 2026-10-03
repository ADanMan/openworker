import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

export function Dialog({
  title,
  onClose,
  children,
  className = '',
  canClose = () => true,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
  canClose?: () => boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      onClose={onClose}
      onCancel={(e) => { if (!canClose()) e.preventDefault() }}
      onClick={(e) => e.target === ref.current && canClose() && ref.current?.close()}
    >
      <div className="modal-body">
        <div className="modal-top">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={() => { if (canClose()) ref.current?.close() }}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
