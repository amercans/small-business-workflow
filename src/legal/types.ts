export interface LegalSection {
  h: string
  p: string[]
}

export interface LegalText {
  title: string
  intro?: string
  sections: LegalSection[]
}

export interface LegalPack {
  policy: LegalText
  privacy: LegalText
  undertaking: { title: string; items: string[]; signature: { name: string; date: string; sign: string; company: string } }
  labels: {
    policy: { label: string; accusative: string; ack: string }
    privacy: { label: string; accusative: string; ack: string }
  }
}
