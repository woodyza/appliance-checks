export interface SheetColor {
  red?: number
  green?: number
  blue?: number
}

export interface SheetDataValidationCondition {
  type?: string
  values?: { userEnteredValue?: string }[]
}

export interface SheetDataValidation {
  condition?: SheetDataValidationCondition
}

export interface SheetEffectiveFormat {
  backgroundColor?: SheetColor
  backgroundColorStyle?: { rgbColor?: SheetColor }
}

export interface SheetCellData {
  formattedValue?: string
  dataValidation?: SheetDataValidation
  effectiveFormat?: SheetEffectiveFormat
}

export interface SheetRowData {
  values?: SheetCellData[]
}

export interface SheetGrid {
  sheets: {
    data?: {
      rowData?: SheetRowData[]
    }[]
  }[]
}
