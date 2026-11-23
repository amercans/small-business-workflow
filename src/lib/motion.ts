export const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export type Ease = 'spring' | 'settle'

export function spr(el: Element, keyframes: Keyframe[], duration = 620, ease: Ease = 'spring', extra: KeyframeAnimationOptions = {}) {
  const reduced = prefersReducedMotion()
  return el.animate(keyframes, {
    duration: reduced ? 180 : duration,
    easing: reduced ? 'ease-out' : token(ease === 'spring' ? '--ease-spring' : '--ease-settle'),
    fill: 'forwards',
    ...extra,
    ...(reduced ? { delay: 0 } : {}),
  })
}
