export interface Child {
  el: HTMLElement
  scrollable: boolean
  continuous: boolean
  sticky: boolean
  setProgress: boolean
  setPosition: boolean
  fixedFrom: number | undefined
  fixedTo: number | undefined
  // Inside another moved child, so its transform is relative to that one.
  nested: boolean
  ownsWillChange: boolean
  top: number
  height: number
  inView: boolean
  stickyLimitTop: number
  stickyLimitBottom: number
  stickyState: boolean | undefined
  y: number
  progress: string
  scrollCurrent: string
}
