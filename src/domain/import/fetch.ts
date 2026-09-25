import { ImportError } from './errors'
import type { SheetGrid } from './sheetGrid'

const BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets'

interface GoogleErrorBody {
  error?: { message?: string }
}

interface SpreadsheetTitleResponse {
  sheets?: { properties?: { title?: string } }[]
}

async function getJson(url: URL): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) {
    let message = response.statusText
    try {
      const body = (await response.json()) as GoogleErrorBody
      if (body.error?.message) message = body.error.message
    } catch {
      // response body wasn't JSON; fall back to statusText
    }
    throw new ImportError(`Sheets API request failed (${response.status}): ${message}`)
  }
  return response.json()
}

export async function fetchSheet(spreadsheetId: string, apiKey: string): Promise<SheetGrid> {
  const encodedId = encodeURIComponent(spreadsheetId)

  const titleUrl = new URL(`${BASE_URL}/${encodedId}`)
  titleUrl.searchParams.set('key', apiKey)
  titleUrl.searchParams.set('fields', 'sheets.properties.title')
  const titleResponse = (await getJson(titleUrl)) as SpreadsheetTitleResponse
  const title = titleResponse.sheets?.[0]?.properties?.title
  if (!title) {
    throw new ImportError('Sheets API response had no sheet title.')
  }

  const dataUrl = new URL(`${BASE_URL}/${encodedId}`)
  dataUrl.searchParams.set('key', apiKey)
  dataUrl.searchParams.set('includeGridData', 'true')
  dataUrl.searchParams.set('ranges', `'${title.replace(/'/g, "''")}'`)
  dataUrl.searchParams.set(
    'fields',
    'sheets(data(rowData(values(formattedValue,dataValidation,effectiveFormat(backgroundColor,backgroundColorStyle)))))',
  )
  return (await getJson(dataUrl)) as SheetGrid
}
