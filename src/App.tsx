// the full screen editor alike layout is similar to https://jsfiddle.net/ysw37gmu/1/
// minor details like overflow-y:hidden, ... are important!

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'

import { Chart as ChartJS, ArcElement, BarController, Title, Tooltip, Legend, registerables } from 'chart.js'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import { fromEvent } from 'file-selector'

ChartJS.register(ArcElement, BarController, Tooltip, Legend, Title, ChartDataLabels, ...registerables) // todo optimize/get rid of registerables

import { ThemeProvider, createTheme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'

import { ConfirmProvider } from 'material-ui-confirm'
import { SnackbarProvider, enqueueSnackbar } from 'notistack'

import ResponsiveNav from '@rsuite/responsive-nav'
import MoreIcon from '@rsuite/icons/More'

import './App.css'
import Dropzone, { FileRejection } from 'react-dropzone'
import * as zipjs from '@zip.js/zip.js'
import {
  AppBar,
  Box,
  CssBaseline,
  IconButton,
  Menu,
  Toolbar,
  Tooltip as MuiTooltip,
  Typography,
  alpha,
  styled,
  Divider,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import AddIcon from '@mui/icons-material/Add'
import DifferenceIcon from '@mui/icons-material/Difference'
import DeleteForeverIcon from '@mui/icons-material/DeleteForever'
import FilterAltIcon from '@mui/icons-material/FilterAlt'
import { DB, Sqlite3 } from '@sqlite.org/sqlite-wasm'

import { Sqlite3Context, useSqliteInitEffect } from './sqlite3'
import { TrfWorkbenchView, TrfReport } from './TrfWorkbenchView'
import { DeferredZipFile, FileData } from './utils'

// supported (as known) db_version:
const DB_VERSION_MIN = 64
const DB_VERSION_MAX = 64

const isSameFile = (a: File, b: File): boolean => {
  return a.name === b.name && a.type === b.type && a.lastModified === b.lastModified
}

const includesFile = (a: FileData[], b: FileData): boolean => {
  return a.find((f) => isSameFile(f.file, b.file)) !== undefined
}

/*
const useLocalStorage = <T,>(storageKey: string, initialState: T): [T, React.Dispatch<React.SetStateAction<T>>] => {
  const [value, setVal] = useState<T>(() => {
    const storedItem = window.localStorage.getItem(storageKey)
    if (storedItem !== null) {
      return JSON.parse(storedItem) as T
    } else {
      return initialState
    }
  })

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(value))
  }, [value, storageKey])

  return [value, setVal]
}*/

function App() {
  // const [referenceIdToCompare, setReferenceIdToCompare] = useLocalStorage<number>('referenceIdToCompare', 0) // the db.Reference.id to compare with (seems like 0 is not used...)
  const [files, setFiles] = useState<FileData[]>([])
  const [testReports, setTestReports] = useState<TrfReport[]>([])
  //  const [showDetailTCs, setShowDetailTCs] = useState<AtxTestCase[]>([])
  const [loading, setLoading] = useState<boolean>(false)

  const onDrop = useCallback(async (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
    let didSetFiles = false
    setLoading(true)
    try {
      //const length = event.dataTransfer.files.length;
      console.log(`onDrop acceptedFile length=${acceptedFiles.length} rejectedFiles: ${rejectedFiles.length}`)
      const posTrfFiles: FileData[] = acceptedFiles
        .filter((f) => {
          const lowName = f.name.toLowerCase()
          return lowName.endsWith('.trf')
        })
        .map((f) => {
          return { file: f }
        })
      // we do only check for zip files if no trf file was dropped already
      const zipFiles =
        posTrfFiles.length === 0
          ? acceptedFiles.filter((f) => {
              const lowName = f.name.toLowerCase()
              return lowName.endsWith('.zip') || lowName.endsWith('.7z')
            })
          : []
      for (const file of zipFiles) {
        try {
          console.log(` dropped zip file:${file.name} ${file.type} size=${file.size}`, file)
          const zipReader = new zipjs.ZipReader(new zipjs.BlobReader(file))
          const zipFileEntries = await zipReader.getEntries({ filenameEncoding: 'utf-8' })
          console.log(` dropped zip file:${file.name} has ${zipFileEntries.length} zipjs entries.`)
          const trfFilesFromZipJs = zipFileEntries.filter((e) => {
            const lowName = e.filename.toLowerCase()
            return lowName.endsWith('.trf')
          })
          // unzip those:
          for (const fi of trfFilesFromZipJs) {
            if (!fi.directory && 'getData' in fi && typeof fi.getData === 'function') {
              const bits = await fi.getData(new zipjs.BlobWriter())
              const trfFile = new File([bits], fi.filename, { type: 'text/xml', lastModified: fi.lastModDate.valueOf() })
              posTrfFiles.push({ file: trfFile, deferredZipFile: new DeferredZipFile(file, zipFileEntries) })
            }
          }
          console.log(` dropped zip file:${file.name} extracted ${trfFilesFromZipJs.length} trf entries`)
        } catch (err) {
          console.warn(`onDrop processing file '${file.name}' got err=${err}`)
        }
      } // end for zipfiles

      if (posTrfFiles.length > 0) {
        setFiles((d) => {
          const nonDuplFiles = posTrfFiles.filter((f) => !includesFile(d, f))
          return d.concat(nonDuplFiles)
        })
        didSetFiles = true
      }
    } catch (err) {
      console.error(`onDrop got err=${err}`)
    }
    if (!didSetFiles) {
      setLoading(false)
    }
  }, [])

  const [sqlite3, setSqlite3] = useState<Sqlite3 | undefined>(undefined)
  useSqliteInitEffect(setSqlite3)

  // load/open the files as sqlite databases
  useEffect(() => {
    // console.log(`App.useEffect[sqlite3, files, setLoading, setTestReports]...`)
    if (sqlite3 !== undefined) {
      console.log(`App.useEffect[files]... files=${files.map((f) => f.file.name).join(',')}`)
      Promise.all(
        files.map((fileData) => {
          const arrayBuffer = fileData.file.arrayBuffer()
          return arrayBuffer.then((a) => [a, fileData] as [ArrayBuffer, FileData])
        }),
      )
        .then((arrayBuffers) => {
          const uint8Arrays = arrayBuffers.map(
            ([arrayBuffer, fileData]) => [new Uint8Array(arrayBuffer), fileData] as [Uint8Array, FileData],
          )
          const dbs = uint8Arrays.map(([bytes, fileData]) => {
            const p = sqlite3.wasm.allocFromTypedArray(bytes)
            const db = new sqlite3.oo1.DB()
            const rc = sqlite3.capi.sqlite3_deserialize(db.pointer, 'main', p, bytes.length, bytes.length, 0)
            console.log(`sqlite3_deserialize got rc=${rc}`)
            return [db, fileData] as [DB, FileData] // todo only if rc===0?
          })
          const reports: (TrfReport | undefined)[] = dbs.map(([db, fileData]) => {
            console.log(`db(${fileData}).dbName=`, db.dbName())
            const info: Record<string, string | number | null | Uint8Array>[] = db.exec({
              sql: 'SELECT * from info limit 1; ',
              returnValue: 'resultRows',
              rowMode: 'object',
            })
            if (info.length > 0) {
              console.log(`db.info[0]=`, info[0])
              if ((info[0].db_version as number) < DB_VERSION_MIN) {
                enqueueSnackbar(
                  `Un-known/-tested (too old) db version ${info[0].db_version} < ${DB_VERSION_MIN}. App name :'${
                    info[0].app_name || ''
                  } (version: ${info[0].app_version || ''}})'. Please report any issues.`,
                  { preventDuplicate: true, variant: 'warning', autoHideDuration: 9000 },
                )
              } else if ((info[0].db_version as number) > DB_VERSION_MAX) {
                enqueueSnackbar(
                  `Un-known/-tested (newer) db version ${info[0].db_version} > ${DB_VERSION_MAX}. App name :'${
                    info[0].app_name || ''
                  } (version: ${info[0].app_version || ''}})'. Please report any issues.`,
                  { preventDuplicate: true, variant: 'warning', autoHideDuration: 9000 },
                )
              }
              return {
                fileData: fileData,
                db: db,
                dbInfo: info[0],
              }
            } else return undefined
          })
          // todo remove duplicates by uuid (or uuid/execution_time?)
          // todo sort by execution date
          return reports.filter((r) => r !== undefined) as TrfReport[]
        })
        .then((reports) => {
          setLoading(false)
          if (reports) setTestReports(reports)
        })
        .catch((e) => {
          console.error(`App.useEffect[files]... got error '${e}'`)
          setLoading(false)
        })
    } else {
      if (files.length > 0) {
        console.warn(`App.useEffect[files] got no sqlite3!  files=${files.map((f) => f.file.name).join(',')}`)
      }
    }
  }, [sqlite3, files, setLoading, setTestReports])

  const Drop = useMemo(
    () =>
      styled('div')(({ theme }) => ({
        position: 'relative',
        borderRadius: theme.shape.borderRadius,
        backgroundColor: alpha(theme.palette.common.white, 0.15),
        '&:hover': {
          backgroundColor: alpha(theme.palette.common.white, 0.25),
        },
        marginRight: theme.spacing(2),
        marginLeft: 0,
        width: '100%',
        [theme.breakpoints.up('sm')]: {
          marginLeft: theme.spacing(3),
          width: 'auto',
        },
      })),
    [],
  )

  const [compareMenuAnchorEl, setCompareMenuAnchorEl] = useState<null | HTMLElement>(null)
  const handleCompareMenu = (event: React.MouseEvent<HTMLElement>) => {
    setCompareMenuAnchorEl(event.currentTarget)
  }
  const handleCompareMenuClose = () => {
    setCompareMenuAnchorEl(null)
  }

  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)')

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: prefersDarkMode ? 'dark' : 'light',
        },
      }),
    [prefersDarkMode],
  )

  // we cache all TrfWorkbenches here...
  const renderedReports = useRef<Map<TrfReport, JSX.Element>>(new Map())

  const [activeTrf, setActiveTrf] = useState<string | undefined>('')
  useEffect(() => {
    console.log(`App.useEffect[testReports]...`)
    if (!activeTrf && testReports.length > 0) {
      setActiveTrf(testReports[0].fileData.file.name)
    }
  }, [testReports, activeTrf])

  const getRenderedReport = (trf: TrfReport, createIfEmpty: boolean): JSX.Element => {
    const reportMap = renderedReports.current
    let jsx = reportMap.get(trf)
    if (jsx) {
      return jsx
    } else {
      if (createIfEmpty) {
        jsx = <TrfWorkbenchView key={`rep_${trf.fileData.file.name}`} trf={trf} />
        reportMap.set(trf, jsx)
        return jsx
      } else {
        return <></>
      }
    }
  }

  return (
    <SnackbarProvider>
      <Sqlite3Context.Provider value={sqlite3}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <ConfirmProvider>
            <Box sx={{ flexGrow: 0 }}>
              <AppBar position='static' color='primary'>
                <Toolbar variant='dense'>
                  <IconButton size='small' edge='start' color='inherit' aria-label='open drawer' sx={{ mr: 2 }}>
                    <MenuIcon />
                  </IconButton>
                  <Typography variant='h6' component='div' sx={{ display: { xs: 'none', sm: 'block' } }}>
                    trf viewer
                  </Typography>
                  <Drop>
                    <Dropzone onDrop={onDrop} getFilesFromEvent={fromEvent}>
                      {({ getRootProps, getInputProps }) => (
                        <section>
                          <div {...getRootProps({ className: 'dropZone' })}>
                            {false && (
                              <IconButton size='small' edge='start' color='inherit' aria-label='add files' sx={{ mr: 2 }}>
                                <AddIcon />
                              </IconButton>
                            )}
                            <input {...getInputProps()} />
                            <p>Drag 'n' drop files here, or click to select files</p>
                          </div>
                        </section>
                      )}
                    </Dropzone>
                  </Drop>
                  <IconButton
                    aria-label='clear reports'
                    size='small'
                    color='inherit'
                    disabled={!(files.length > 0 || testReports.length > 0)}
                    onClick={() => {
                      setFiles([])
                      setTestReports([]) /*setReferenceIdToCompare(0)*/
                    }}
                  >
                    <MuiTooltip title='Clear reports'>
                      <DeleteForeverIcon />
                    </MuiTooltip>
                  </IconButton>
                  <div>
                    <IconButton size='small' aria-controls='menu-compare' aria-haspopup='true' onClick={handleCompareMenu} color='inherit'>
                      <MuiTooltip title='Compare report'>
                        <DifferenceIcon />
                      </MuiTooltip>
                    </IconButton>
                    <Menu
                      id='menu-compare'
                      anchorEl={compareMenuAnchorEl}
                      keepMounted
                      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                      open={!!compareMenuAnchorEl}
                      onClose={handleCompareMenuClose}
                      PaperProps={{
                        style: {
                          height: 300,
                        },
                      }}
                    ></Menu>
                  </div>
                  <div>
                    <IconButton disabled={true} size='small' color='inherit'>
                      <MuiTooltip title='Filter test cases...'>
                        <FilterAltIcon />
                      </MuiTooltip>
                    </IconButton>
                  </div>
                </Toolbar>
              </AppBar>
            </Box>
            {loading && (
              <>
                <div id='progress' className='indeterminateProgressBar'>
                  <div className='indeterminateProgressBarProgress' />
                </div>
              </>
            )}
            <div style={{ display: 'contents' }}>
              {testReports.length === 0 /*&& compareView === undefined */ && (
                <div style={{ flex: '1 1 auto' }}>
                  <p>Open a trf test report file...</p>
                  <Divider />
                  <Typography variant='body1' sx={{ border: '2px dotted green', padding: '6px', margin: '6px', width: '50%' }}>
                    Hint: Use/drag'n'drop a zip file including the .trf and all recordings. That allows you to download the recordings
                    automatically on the Recordings page.
                  </Typography>
                </div>
              )}
              {testReports.length === 1 && testReports.map((report) => getRenderedReport(report, true))}
              {testReports.length > 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', overflowY: 'hidden' }}>
                  <div style={{ width: '100%', textAlign: 'left' }}>
                    <ResponsiveNav
                      removable
                      appearance='tabs'
                      moreText={<MoreIcon />}
                      moreProps={{ noCaret: true }}
                      activeKey={activeTrf}
                      onSelect={(active) => setActiveTrf(active as string | undefined)}
                      onItemRemove={(eventKey) => {
                        console.log(`ResponsiveNav.onItemRemove(${eventKey})`)
                        const newReports = [...testReports]
                        newReports.splice(
                          newReports.findIndex((e) => e.fileData.file.name === eventKey),
                          1,
                        )
                        setTestReports(newReports)
                        setActiveTrf(newReports.length > 0 ? newReports[0].fileData.file.name : undefined)
                      }}
                    >
                      {testReports.map((report) => (
                        <ResponsiveNav.Item key={report.fileData.file.name} eventKey={report.fileData.file.name}>
                          {report.fileData.file.name}
                        </ResponsiveNav.Item>
                      ))}
                    </ResponsiveNav>
                  </div>
                  {testReports.map((report, idx) => (
                    <div
                      key={`report_${idx}_${report.fileData.file.name}`}
                      style={{
                        flexDirection: 'column',
                        flex: report.fileData.file.name === activeTrf ? '1 1 auto' : '0 0 0px',
                        overflowY: 'hidden',
                        transform: report.fileData.file.name === activeTrf ? '' : 'scale(0)',
                        display: 'flex',
                      }}
                    >
                      {getRenderedReport(report, report.fileData.file.name === activeTrf)}
                    </div>
                  ))}
                </div>
              )}
              <div className='gitSha' style={{ flex: '0 1 auto' }}>
                <div style={{ marginRight: '100px' }}>
                  {'build from '}
                  <a href='https://github.com/mbehr1/trf-viewer' target='_blank'>
                    github/mbehr1/trf-viewer
                  </a>
                  {` commit #${__COMMIT_HASH__}`}
                </div>
              </div>
            </div>
          </ConfirmProvider>
        </ThemeProvider>
      </Sqlite3Context.Provider>
    </SnackbarProvider>
  )
}

export default App
