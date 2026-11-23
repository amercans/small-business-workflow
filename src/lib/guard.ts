import { redirect } from '@tanstack/react-router'
import { canAccess, type Area } from './permissions'
import type { Session } from '#/data/session'

export const guard =
  (area: Area) =>
  ({ context }: { context: { session: Session } }) => {
    if (!canAccess(context.session.user, area)) throw redirect({ to: '/' })
  }
