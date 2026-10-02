export type InputType = 'yn' | 'choice' | 'written'

export type Scope = 'weekly' | 'monthly'

export interface Brigade {
  brigadeId: string
  name: string
  checkDay: number
  active: boolean
}

export interface BrigadeSettings {
  reportEmail?: string
}

export interface Appliance {
  callsign: string
  active: boolean
  currentCheckSheetVersion: number | null
}

export interface Item {
  id: string
  label: string
  qty: string | null
  inputType: InputType
  options?: string[]
  scope: Scope
}

export interface Section {
  id: string
  title: string
  items: Item[]
}

export type CheckSheetOrigin = { type: 'import'; spreadsheetId: string } | { type: 'editor' }

export interface CheckSheetVersion {
  version: number
  createdAt: Date
  origin: CheckSheetOrigin
  sections: Section[]
}

export type ParsedItem = Omit<Item, 'id'>

export interface ParsedSection {
  title: string
  items: ParsedItem[]
}

export interface ParsedCheckSheet {
  sections: ParsedSection[]
}

export interface Check {
  applianceId: string
  scheduledDate: string
  monthly: boolean
  checkSheetVersion: number
  responses: Record<string, string>
}

export type AdminRole = 'brigadeAdmin' | 'vso'

export interface AdminUser {
  email: string
  displayName: string | null
  role: AdminRole
  brigadeIds: string[]
}

export interface CheckSheetDraft {
  baseVersion: number | null
  origin: CheckSheetOrigin
  sections: Section[]
}
