import { DB } from '@sqlite.org/sqlite-wasm'
import * as zipjs from '@zip.js/zip.js'

interface TableColumn {
  key: string
  label?: string
  options: {
    // can be set afterwards before rendering the table
    formatter?: (value: string) => string
    unit?: string
  }
}

export interface TableEntity {
  name?: string
  columns: TableColumn[]
  data: Record<string, string>[]
}

export const getTableEntityCellTable = (db: DB, entityId: number, name?: string): TableEntity => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resultRows: any[] = db.exec({
    sql: `SELECT row, col, value from tableentity_cell where entity_id=${entityId};`,
    returnValue: 'resultRows',
    rowMode: 'array',
  })
  // sort by row/col:
  resultRows.sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]))
  //console.log(`TrfDetailView.useEffect[selected] got ${resultRows.length} sorted entity rows`, resultRows)
  // determine max col:
  const maxCol = resultRows.reduce((prev, cur) => (cur[1] > prev ? cur[1] : prev), -1)
  // determine columns:
  const columns: TableColumn[] = []
  for (const rowCell of resultRows) {
    if (rowCell[0] > 0) {
      break
    }
    const col = rowCell[1]
    while (columns.length < col) {
      columns.push({ key: columns.length.toString(), options: {} })
    }
    columns.push({ key: columns.length.toString(), label: rowCell[2], options: {} })
  }
  // fill missing columns:
  while (columns.length < maxCol + 1) {
    columns.push({ key: columns.length.toString(), options: {} })
  }
  // fill data
  const data: Record<string, string>[] = []
  for (const rowCell of resultRows) {
    if (rowCell[0] <= 0) {
      continue
    }
    const row = rowCell[0] - 1
    const col = rowCell[1]
    const value = rowCell[2]
    // we keep empty rows (this allows some attacks... e.g. with high values in the db (todo add sanity checks!))
    while (data.length <= row) {
      data.push({})
    }
    const dataRow = data[row]
    dataRow[col.toString()] = value
  }
  return { name, columns, data }
}

/**
 * Output a duration in h:mm:ss[.mmm] format
 * @param durationSecs in seconds
 * @param outputMs output ms with 3 digits as well?
 * @returns string
 */
export const timeFormat = (durationSecsNrStr: number | string, outputMs: boolean = false) => {
  let durationSecs = typeof durationSecsNrStr !== 'number' ? Number(durationSecsNrStr) : durationSecsNrStr
  //const days = Math.floor(distance / (3600 * 24))
  //distance -= days * (3600 * 24)
  const hours = Math.floor(durationSecs / 3600)
  durationSecs -= hours * 3600
  const minutes = Math.floor(durationSecs / 60)
  durationSecs -= minutes * 60
  const seconds = Math.floor(durationSecs)
  durationSecs -= seconds
  const ms = durationSecs
  if (outputMs) {
    return `${hours}:${('0' + minutes).slice(-2)}:${('0' + seconds).slice(-2)}.${ms.toFixed(3).slice(2)}`
  } else {
    return `${hours}:${('0' + minutes).slice(-2)}:${('0' + seconds).slice(-2)}`
  }
}

export interface FileData {
  //entryName: string, // or use file.name?
  file: File
  deferredZipFile?: DeferredZipFile
}

/**
 * class that helps keeping zip files opened where we later might want to extract a single file from
 * (e.g. recordings)
 * So the class keeps the orig File and a list of the entries (file names) inside the zip
 */
export class DeferredZipFile {
  private entryNames: string[]

  constructor(
    private rawZipFile: File,
    zipEntries: zipjs.Entry[],
  ) {
    this.entryNames = zipEntries.filter((e) => !e.directory).map((e) => e.filename)
  }

  /**
   * returns whether an entry is available.
   * Take care: case sensitive!
   * @param entryName
   * @returns
   */
  public includes(entryName: string): boolean {
    return this.entryNames.includes(entryName)
  }

  /**
   * extract a set of entries.
   *
   * @remark This is a really slow operation as it opens the zip file
   * extracts the files and closes the zip file.
   * @param entries - array with entryNames to extract
   * @returns
   */
  public async extract(entries: string[]): Promise<File[]> {
    // open the zip file now:
    const zipReader = new zipjs.ZipReader(new zipjs.BlobReader(this.rawZipFile))
    const zipFileEntries = await zipReader.getEntries({ filenameEncoding: 'utf-8' })
    const filesFromZip = zipFileEntries.filter((e) => !e.directory && entries.includes(e.filename))
    const unzippedFromZipAsFiles: File[] = []
    for (const fi of filesFromZip) {
      const bits =
        !fi.directory && 'getData' in fi && typeof fi.getData === 'function' ? await fi.getData(new zipjs.BlobWriter()) : undefined
      if (bits) {
        unzippedFromZipAsFiles.push(new File([bits], fi.filename, { type: 'text/xml', lastModified: fi.lastModDate.valueOf() }))
      }
    }
    return unzippedFromZipAsFiles
  }
}

export enum ItemType {
  Project,
  Package,
  TestSteps,
  Recordings, // virtual item for Recordings, id points to the pkg/parent in the tree
}

export enum ViewType {
  None,
  PrjSummary,
  PkgSummary,
  PkgRecordings,
  TestSteps,
}
