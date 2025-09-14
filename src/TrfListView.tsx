import { DetailedHTMLProps, HTMLAttributes, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SvgIcon, { SvgIconProps } from '@mui/material/SvgIcon'

import { Table } from 'rsuite'

import './TrfListView.css'
import { TrfReport, TrfReportItem } from './TrfWorkbenchView'
import { TrfImage } from './TrfImage'
import { useLocalStorage, useMediaQuery } from 'usehooks-ts'
import { RowDataType, TableInstance } from 'rsuite/esm/Table'
import { ViewType } from './utils'

interface TrfListViewProps {
  trf: TrfReport
  items: TrfReportItem[]
  selected: TrfReportItem | undefined
  onSelect: (viewType: ViewType, nodeId?: number) => void
}

type TrfListResultCellProps = { result: string } & DetailedHTMLProps<HTMLAttributes<HTMLSpanElement>, HTMLSpanElement>
const TrfListResultCell = (props: TrfListResultCellProps) => <span {...props} />

/**
 * represent a report item tree from a single database
 * @param props
 * @returns
 */

const { Column, HeaderCell, Cell } = Table

interface ColumnWidths {
  step: number
  action: number
  value: number
  expectedValue: number
  comment: number
  origResult: number
  result: number
  timestampRelative: number
  duration: number
  timestampAbs: number
}

const ColumnWidthsDefault: ColumnWidths = {
  step: 50,
  action: 400,
  value: 150,
  expectedValue: 150,
  comment: 150,
  origResult: 75,
  result: 75,
  timestampRelative: 80,
  duration: 80,
  timestampAbs: 150,
}

const dateTimeOptions: Intl.DateTimeFormatOptions = {
  year: '2-digit',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
}

export const TrfListView = (props: TrfListViewProps) => {
  const { onSelect } = props
  const tableRef = useRef<TableInstance<RowDataType<never>, number>>(null)

  // const dateTimeFormat = new Intl.DateTimeFormat("de-DE", dateTimeOptions)
  const dateTimeFormat = useMemo(() => {
    const timezone = props.trf.dbInfo.timezone || 7200 // / 60 // 7200 = +2h / 60 = 120mins
    console.log(`TrfListView useMemo[dbInfo] timezone(sec diff)=${timezone}`)
    // we could show another column in the time of that timezone by checking the
    // local offset at test start time and then modifying by the delta
    return new Intl.DateTimeFormat(undefined, { ...dateTimeOptions })
  }, [props.trf.dbInfo])

  const [listColumnWidths, setListColumnWidths] = useLocalStorage<ColumnWidths>('listColumnWidths', ColumnWidthsDefault)
  useEffect(() => setListColumnWidths(ColumnWidthsDefault), [setListColumnWidths])

  // for the details list view:
  const selectedItems: MyRowDataType[] = useMemo(() => {
    return props.selected ? [props.selected] : props.items
  }, [props.items, props.selected])

  const [expanded, setExpanded] = useState<number[]>(() => selectedItems.map((item) => item.id))
  const [selectedRow, setSelectedRow] = useState<TrfReportItem | undefined>(props.selected ? props.selected : undefined)

  useEffect(() => {
    setExpanded(selectedItems.map((item) => item.id))
    // setSelected([])// selectedItems.map(item => item.id.toString())) // or only the first?
  }, [selectedItems])

  // the rsuite table is really inefficient on large trees (if isTree is set) as it will internally flatten the whole tree and then filter it
  // for the expanded items. So we do limit the items on our own upfront

  const treeItems: MyRowDataType[] = useMemo(() => {
    const getTotalChildren = (items: TrfReportItem[] | MyRowDataType[]): number => {
      return items.reduce((acc, item) => {
        const childrenCount = item.children ? getTotalChildren(item.children) : 0
        return acc + 1 + childrenCount
      }, 0)
    }
    console.log(
      `TrfListView.treeItems: calculating treeItems. selectedItems.total Nr. of children=${getTotalChildren(selectedItems)} expanded=${
        expanded.length
      }`,
    )
    const getItemWoChildIfNotExpanded = (item: TrfReportItem): TrfReportItem => {
      const itemIsExpanded = expanded.includes(item.id)
      return itemIsExpanded
        ? { ...item, children: item.children ? item.children.map(getItemWoChildIfNotExpanded) : [] }
        : { ...item, children: item.children ? [{ ...item.children[0], children: [] }] : [] } // need to include one child so that the + sign is shown
    }

    // we want to include the item and
    // if the item is expanded: all children
    // if the item is not expanded: no children (or 1 so that the + sign is shown?)
    const toRet = selectedItems.map((item) => ({ ...item, children: item.children ? item.children.map(getItemWoChildIfNotExpanded) : [] }))
    console.log(`TrfListView.treeItems: reduced to ${getTotalChildren(toRet)} items`)
    return toRet
  }, [selectedItems, expanded])

  const onExpandChange = useCallback((isOpen: boolean, rowData: MyRowDataType) => {
    // console.log(`TrfListView.onExpandChange(isOpen=${isOpen}, item.id=${rowData.id})`)
    if (isOpen) {
      setExpanded((expanded) => [...expanded, rowData.id])
    } else {
      setExpanded((expanded) => {
        const newExp = [...expanded]
        newExp.splice(
          newExp.findIndex((i) => i === rowData.id),
          1,
        )
        return newExp
      })
    }
  }, [])

  const timerRef = useRef<number>()
  const timer2Ref = useRef<number>()
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
      if (timer2Ref.current) {
        clearTimeout(timer2Ref.current)
        timer2Ref.current = undefined
      }
    }
  }, [props.selected])

  const selectItem = useCallback(
    (node: TrfReportItem, doDebounce = true) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
      if (doDebounce) {
        timerRef.current = window.setTimeout(() => {
          onSelect(ViewType.TestSteps, node.id)
        }, 500)
      } else {
        onSelect(ViewType.TestSteps, node.id)
      }
      setSelectedRow(node as unknown as TrfReportItem)
      // check whether the newly selected is visible:
      // todo this uses internal assumptions from rsuite-table (like the body-row-wrapper and classnames...)
      if (tableRef.current) {
        if (timer2Ref.current) {
          clearTimeout(timer2Ref.current)
          timer2Ref.current = undefined
        }
        timer2Ref.current = window.setTimeout(() => {
          const table = tableRef.current
          if (table) {
            const divBodyRowWrapper = table.root.querySelector(`.rs-table-body-row-wrapper`)
            const bWRect = divBodyRowWrapper?.getBoundingClientRect()
            //console.log(`got divBodyRowWrapper= ${bWRect?.top}-${bWRect?.bottom}`)

            const divNewSelected = table.root.querySelector(`div .rs-table-row.nodeId_${node.id}`)
            //const divNewSelected = table.root.querySelector(`div .rs-table-row[aria-rowindex="${node["index"]}"]`)
            // todo mapping to aria-rowindex ? would avoid the classname spamming...
            const bRect = divNewSelected?.getBoundingClientRect()
            //console.log(`got divNewSelected ${bRect?.top}-${bRect?.bottom}`, divNewSelected, bRect, table.root)

            if (bWRect && bRect) {
              const clippedTop = bRect.top < bWRect.top
              const clippedBottom = bRect.bottom > bWRect.bottom
              if (clippedTop || clippedBottom) {
                //console.log(`got divNewSelected is clipped ${clippedTop ? 'top' : 'bottom'}`)
                const idx = divNewSelected?.getAttribute('aria-rowindex')
                if (idx !== null) {
                  // the new item is below the table so we want it to become visible at the end:
                  // idx*height -> at the top (hidden by columns still)
                  // + bwRect.height * 80% (for top: 30%)
                  const rowHeight = divNewSelected?.clientHeight || 24
                  const scrollTo = Math.floor(
                    Number(idx) * Number(divNewSelected?.clientHeight) - Math.floor(bWRect.height * (clippedBottom ? 0.8 : 0.3)),
                  )
                  table.scrollTop(scrollTo >= rowHeight ? scrollTo - (scrollTo % rowHeight) : 0)
                }
              }
            }
          }
        }, 100)
      }
    },
    [onSelect, timerRef, timer2Ref, tableRef],
  )

  const onKeyPress = useCallback(
    (keyCode: string) => {
      if (selectedRow) {
        const curIsExpanded = expanded.includes(selectedRow.id)
        switch (keyCode) {
          case 'ArrowLeft':
            if (curIsExpanded) {
              onExpandChange(false, selectedRow)
            }
            break
          case 'ArrowRight':
            if (!curIsExpanded && selectedRow.children.length > 0) {
              onExpandChange(true, selectedRow)
            }
            break
          case 'ArrowDown':
            {
              const selectNextSibling = (cur: TrfReportItem): boolean => {
                //const curIsExpanded = expanded.includes(cur.id)
                const par = cur.parent
                if (par) {
                  const curChildIdx = par.children.findIndex((c) => c.id === cur.id)
                  if (curChildIdx >= 0 && par.children.length > curChildIdx + 1) {
                    selectItem(par.children[curChildIdx + 1])
                    return true
                  } else {
                    if (par !== props.selected) {
                      return selectNextSibling(par)
                    }
                    return false
                  }
                }
                return false
              }
              if (!curIsExpanded) {
                // select from the parent the next child
                selectNextSibling(selectedRow)
              } else {
                // select the first child
                const childs = selectedRow.children
                if (childs.length > 0) {
                  selectItem(selectedRow.children[0])
                }
              }
              // todo and scroll new into view
            }
            break
          case 'ArrowUp':
            {
              const getDeepestExpandedLastChild = (cur: TrfReportItem): TrfReportItem => {
                if (cur.children.length === 0) {
                  return cur
                }
                const lastChild = cur.children[cur.children.length - 1]
                const isChildExpanded = expanded.includes(lastChild.id)
                return isChildExpanded ? getDeepestExpandedLastChild(lastChild) : lastChild
              }
              // if we're on the first one we cannot go any further (even if there is a parent)
              if (selectedRow !== props.selected) {
                const par = selectedRow.parent
                if (par) {
                  const curChildIdx = par.children.findIndex((c) => c.id === selectedRow.id)
                  if (curChildIdx > 0) {
                    const sibling = par.children[curChildIdx - 1]
                    const isSiblingExpanded = expanded.includes(sibling.id)
                    if (isSiblingExpanded) {
                      selectItem(getDeepestExpandedLastChild(sibling))
                    } else {
                      selectItem(sibling)
                    }
                  } else {
                    selectItem(par)
                  }
                }
              }
              // todo and scroll new into view
            }
            break
        }
      }
    },
    [selectedRow, props.selected, expanded, selectItem, onExpandChange],
  )

  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)')

  // Table with
  // step, Action/name, value, expected value, remark, orig result, result, test time, time abs.

  // todo investigate how to properly define/extend the RowDataType<never>...
  // to get rid of the ts-ignore below
  interface MyRowDataType {
    dataKey?: string
    children?: TrfReportItem[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any
  }

  return (
    <div
      data-testid='trfListView'
      className={`trfListView ${prefersDarkMode ? 'rs-theme-dark' : ''}`}
      tabIndex={-1}
      onKeyDown={(ev) => {
        switch (ev.code) {
          case 'ArrowUp':
          case 'ArrowDown':
          case 'ArrowLeft':
          case 'ArrowRight':
            onKeyPress(ev.code)
            break
        }
      }}
    >
      <Table
        ref={tableRef}
        isTree
        defaultExpandAllRows={false}
        bordered
        cellBordered
        rowKey='id'
        rowHeight={24}
        rowClassName={(rowData) =>
          `${rowData && rowData.id === selectedRow?.id ? `selected nodeId_${rowData?.id}` : `nodeId_${rowData?.id}`}`
        }
        fillHeight
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        data={treeItems}
        expandedRowKeys={expanded}
        /** shouldUpdateScroll: whether to update the scroll bar after data update **/
        shouldUpdateScroll={false}
        onRowClick={(node) => {
          selectItem(node as unknown as TrfReportItem, false)
        }}
        onExpandChange={onExpandChange}
        renderTreeToggle={(_icon, rowData) => {
          if (!rowData || (rowData.children && rowData.children.length === 0)) {
            return <div style={{ width: 15 }} /> // <SpinnerIcon spin />;
          }
          return expanded.includes(rowData.id) ? <MinusSquare /> : <PlusSquare />
        }}
      >
        <Column
          width={listColumnWidths.step || ColumnWidthsDefault.step}
          resizable
          onResize={(columnWidth) => {
            if (columnWidth) {
              setListColumnWidths((oldWidths) => {
                return { ...oldWidths, step: columnWidth }
              })
            }
          }}
        >
          <HeaderCell>#</HeaderCell>
          <Cell>
            {(rowData) => {
              return <TrfListResultCell result={rowData.result}>{rowData.srcIndex}</TrfListResultCell>
            }}
          </Cell>
        </Column>
        <Column
          width={listColumnWidths.action || ColumnWidthsDefault.action}
          treeCol
          resizable
          verticalAlign='top'
          onResize={(columnWidth) => {
            if (columnWidth) {
              setListColumnWidths((oldWidths) => {
                return { ...oldWidths, action: columnWidth }
              })
            }
          }}
        >
          <HeaderCell>Action/name</HeaderCell>
          <Cell>
            {(rowData) => {
              return (
                <>
                  {rowData.icon && (
                    <div style={{ display: 'inline', position: 'relative', top: +3 }}>
                      <TrfImage db={rowData.icon.db} id={rowData.icon.id} />
                    </div>
                  )}
                  {rowData.label}
                </>
              )
            }}
          </Cell>
        </Column>
        <Column
          width={listColumnWidths.value || ColumnWidthsDefault.value}
          resizable
          colSpan={3}
          onResize={(columnWidth) => {
            if (columnWidth) {
              setListColumnWidths((oldWidths) => {
                return { ...oldWidths, value: columnWidth }
              })
            }
          }}
        >
          <HeaderCell>value</HeaderCell>
          <Cell>
            {(rowData) => {
              return rowData.srcType === 'PACKAGE' && rowData.elementary_result !== 1 ? '' : rowData.info || ''
            }}
          </Cell>
        </Column>
        <Column
          width={listColumnWidths.expectedValue || ColumnWidthsDefault.expectedValue}
          resizable
          onResize={(columnWidth) => {
            if (columnWidth) {
              setListColumnWidths((oldWidths) => {
                return { ...oldWidths, expectedValue: columnWidth }
              })
            }
          }}
        >
          <HeaderCell>expected value</HeaderCell>
          <Cell dataKey='targetValue' />
        </Column>
        <Column
          width={listColumnWidths.comment || ColumnWidthsDefault.comment}
          resizable
          onResize={(columnWidth) => {
            if (columnWidth) {
              setListColumnWidths((oldWidths) => {
                return { ...oldWidths, comment: columnWidth }
              })
            }
          }}
        >
          <HeaderCell>comment</HeaderCell>
          <Cell dataKey='comment' />
        </Column>
        <Column
          width={listColumnWidths.origResult || ColumnWidthsDefault.origResult}
          resizable
          onResize={(columnWidth) => {
            if (columnWidth) {
              setListColumnWidths((oldWidths) => {
                return { ...oldWidths, origResult: columnWidth }
              })
            }
          }}
        >
          <HeaderCell>orig. result</HeaderCell>
          <Cell>
            {(rowData) => {
              return <TrfListResultCell result={rowData.origResult}>{rowData.origResult}</TrfListResultCell>
            }}
          </Cell>
        </Column>
        <Column
          width={listColumnWidths.result || ColumnWidthsDefault.result}
          resizable
          onResize={(columnWidth) => {
            if (columnWidth) {
              setListColumnWidths((oldWidths) => {
                return { ...oldWidths, result: columnWidth }
              })
            }
          }}
        >
          <HeaderCell>result</HeaderCell>
          <Cell>
            {(rowData) => {
              return <TrfListResultCell result={rowData.result}>{rowData.result}</TrfListResultCell>
            }}
          </Cell>
        </Column>
        <Column
          width={listColumnWidths.timestampRelative || ColumnWidthsDefault.timestampRelative}
          resizable
          align='right'
          onResize={(columnWidth) => {
            if (columnWidth) {
              setListColumnWidths((oldWidths) => {
                return { ...oldWidths, timestampRelative: columnWidth }
              })
            }
          }}
        >
          <HeaderCell>{`timestamp rel[s]`}</HeaderCell>
          <Cell>
            {(rowData) => {
              return rowData.timestampRelative?.toFixed(3) ?? ''
            }}
          </Cell>
        </Column>
        <Column
          width={listColumnWidths.duration || ColumnWidthsDefault.duration}
          resizable
          align='right'
          onResize={(columnWidth) => {
            if (columnWidth) {
              setListColumnWidths((oldWidths) => {
                return { ...oldWidths, duration: columnWidth }
              })
            }
          }}
        >
          <HeaderCell>{`duration[s]`}</HeaderCell>
          <Cell>
            {(rowData) => {
              return rowData.duration?.toFixed(3) ?? ''
            }}
          </Cell>
        </Column>
        <Column
          width={listColumnWidths.timestampAbs || ColumnWidthsDefault.timestampAbs}
          resizable
          align='left'
          onResize={(columnWidth) => {
            if (columnWidth) {
              setListColumnWidths((oldWidths) => {
                return { ...oldWidths, timestampAbs: columnWidth }
              })
            }
          }}
        >
          <HeaderCell>{`time`}</HeaderCell>
          <Cell>
            {(rowData) => {
              return rowData.timestamp ? dateTimeFormat.format(new Date(1000 * rowData.timestamp)) : ''
            }}
          </Cell>
        </Column>
      </Table>
    </div>
  )
}

// todo replace by other icons
function MinusSquare(props: SvgIconProps) {
  return (
    <div style={{ position: 'relative', top: +2, height: 14 }}>
      <SvgIcon fontSize='inherit' style={{ width: 14, height: 14 }} {...props}>
        {/* tslint:disable-next-line: max-line-length */}
        <path d='M22.047 22.074v0 0-20.147 0h-20.12v0 20.147 0h20.12zM22.047 24h-20.12q-.803 0-1.365-.562t-.562-1.365v-20.147q0-.776.562-1.351t1.365-.575h20.147q.776 0 1.351.575t.575 1.351v20.147q0 .803-.575 1.365t-1.378.562v0zM17.873 11.023h-11.826q-.375 0-.669.281t-.294.682v0q0 .401.294 .682t.669.281h11.826q.375 0 .669-.281t.294-.682v0q0-.401-.294-.682t-.669-.281z' />
      </SvgIcon>
    </div>
  )
}

function PlusSquare(props: SvgIconProps) {
  return (
    <div style={{ position: 'relative', top: +2, height: 14 }}>
      <SvgIcon fontSize='inherit' style={{ width: 14, height: 14 }} {...props}>
        {/* tslint:disable-next-line: max-line-length */}
        <path d='M22.047 22.074v0 0-20.147 0h-20.12v0 20.147 0h20.12zM22.047 24h-20.12q-.803 0-1.365-.562t-.562-1.365v-20.147q0-.776.562-1.351t1.365-.575h20.147q.776 0 1.351.575t.575 1.351v20.147q0 .803-.575 1.365t-1.378.562v0zM17.873 12.977h-4.923v4.896q0 .401-.281.682t-.682.281v0q-.375 0-.669-.281t-.294-.682v-4.896h-4.923q-.401 0-.682-.294t-.281-.669v0q0-.401.281-.682t.682-.281h4.923v-4.896q0-.401.294-.682t.669-.281v0q.401 0 .682.281t.281.682v4.896h4.923q.401 0 .682.281t.281.682v0q0 .375-.281.669t-.682.294z' />
      </SvgIcon>
    </div>
  )
}

// function CloseSquare(props: SvgIconProps) {
//     return (
//         <SvgIcon
//             className="close"
//             fontSize="inherit"
//             style={{ width: 14, height: 14 }}
//             {...props}
//         >
//             {/* tslint:disable-next-line: max-line-length */}
//             <path d="M17.485 17.512q-.281.281-.682.281t-.696-.268l-4.12-4.147-4.12 4.147q-.294.268-.696.268t-.682-.281-.281-.682.294-.669l4.12-4.147-4.12-4.147q-.294-.268-.294-.669t.281-.682.682-.281.696 .268l4.12 4.147 4.12-4.147q.294-.268.696-.268t.682.281 .281.669-.294.682l-4.12 4.147 4.12 4.147q.294.268 .294.669t-.281.682zM22.047 22.074v0 0-20.147 0h-20.12v0 20.147 0h20.12zM22.047 24h-20.12q-.803 0-1.365-.562t-.562-1.365v-20.147q0-.776.562-1.351t1.365-.575h20.147q.776 0 1.351.575t.575 1.351v20.147q0 .803-.575 1.365t-1.378.562v0z" />
//         </SvgIcon>
//     );
// }
