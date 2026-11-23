import { getRouteApi } from '@tanstack/react-router'

const rootApi = getRouteApi('__root__')

export const useSession = () => rootApi.useRouteContext().session
