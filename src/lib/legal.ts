import { legalPack, type LegalText } from '#/legal'

export type { LegalSection, LegalText } from '#/legal'

export const LEGAL_VERSION = '1.0'

export type PolicyDoc = 'policy' | 'kvkk'

const key = (d: PolicyDoc) => (d === 'policy' ? 'policy' : 'privacy')

export const POLICY_DOCS: readonly PolicyDoc[] = ['policy', 'kvkk']

export const DOCS: Record<PolicyDoc, LegalText> = {
  get policy() {
    return legalPack().policy
  },
  get kvkk() {
    return legalPack().privacy
  },
}

export const docLabel = (d: PolicyDoc) => legalPack().labels[key(d)].label
export const docAccusative = (d: PolicyDoc) => legalPack().labels[key(d)].accusative
export const docAck = (d: PolicyDoc) => legalPack().labels[key(d)].ack

export const DOC_LABEL: Record<PolicyDoc, string> = {
  get policy() {
    return docLabel('policy')
  },
  get kvkk() {
    return docLabel('kvkk')
  },
}
export const DOC_ACC: Record<PolicyDoc, string> = {
  get policy() {
    return docAccusative('policy')
  },
  get kvkk() {
    return docAccusative('kvkk')
  },
}
export const DOC_ACK: Record<PolicyDoc, string> = {
  get policy() {
    return docAck('policy')
  },
  get kvkk() {
    return docAck('kvkk')
  },
}

export const undertaking = () => legalPack().undertaking
