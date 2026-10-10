// Small motion primitives ported from the Sonder iOS app (Components/*.swift):
//   BreathingOrb  <- DriftOrbView: organic blob that slowly breathes, with a soft halo
//   CloseButton   <- AnimatedCloseButton: spins 90deg, shrinks and fades, then acts
//   FlipText      <- FlipText: cycles words with a rolling transition
//   haptic        <- HapticPressFeedback: a soft tick on press (where the device supports it)
// The CSS lives in motion.css; all of it respects prefers-reduced-motion.
import { useEffect, useState, type CSSProperties } from 'react'
import './motion.css'

export const haptic = () => { try { navigator.vibrate?.(8) } catch { /* not supported */ } }

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function BreathingOrb({ color, size = 92, children }: { color: string; size?: number; children?: React.ReactNode }) {
  return (
    <div className="sx-orb" style={{ '--c': color, width: size, height: size } as CSSProperties}>
      <i className="sx-orb-halo" />
      <i className="sx-orb-body" />
      {children && <span className="sx-orb-core">{children}</span>}
    </div>
  )
}

export function CloseButton({ onClose, label = 'close', className = '' }: { onClose: () => void; label?: string; className?: string }) {
  const [closing, setClosing] = useState(false)
  const go = () => {
    if (closing) return
    haptic()
    setClosing(true)
    window.setTimeout(onClose, reduced() ? 80 : 190)
  }
  return (
    <button className={`cx-circle sm sx-close ${closing ? 'closing' : ''} ${className}`} onClick={go} aria-label={label}>✕</button>
  )
}

export function FlipText({ words, interval = 2400 }: { words: string[]; interval?: number }) {
  const [i, setI] = useState(0)
  const key = words.join('|')
  useEffect(() => {
    setI(0)
    if (words.length < 2) return
    const id = window.setInterval(() => setI(n => (n + 1) % words.length), interval)
    return () => clearInterval(id)
  }, [key, interval]) // eslint-disable-line react-hooks/exhaustive-deps
  return <span className="sx-flip"><span key={`${key}-${i}`}>{words[i % words.length]}</span></span>
}
