import { appendFileSync, writeFileSync } from "fs"
import stringify from "json-stringify-pretty-compact"
import { BufferedLogger } from "./BufferedLogger"
import chalk from "chalk"
import { Line } from "./Line"

export const debugLog = (...data) => appendFileSync("./debug.txt", `${stringify(data)}\n`)
writeFileSync("./debug.txt", ``)

debugLog(`Hello${chalk.red("World")}!`)

export interface IKey {
  str: string
  sequence: string
  name: "backspace" | "up" | "down" | "left" | "right" | "return" | "pageup" | "pagedown"
  ctrl: boolean
  meta: boolean
  shift: boolean
  isChar: boolean
}

let key = 0
export const getKey = () => key++

export class Cli {
  debug: boolean
  showHidden: boolean
  lines: Line[] = []
  activeLine: Line
  scrollPos = 0
  globalState = {} as any

  constructor({
    debug = false,
    showHidden = false,
    lines = [],
    activeIndex = "start",
    initialState = {}
  }: {
    debug?: boolean
    showHidden?: boolean
    lines?: Line[]
    activeIndex?: "start" | "end" | number
    initialState?: any
  }) {
    lines.forEach(line => this.addLine(line))

    this.debug = debug
    this.showHidden = showHidden
    this.globalState = initialState
    if (activeIndex === "start") {
      this.setActiveLine(this.lines[0])
    } else if (activeIndex === "end") {
      this.setActiveLine(this.visibleLines[this.visibleLines.length - 1])
    } else {
      this.setActiveLine(this.visibleLines[activeIndex])
    }
  }

  get height() {
    return this.debug ? process.stdout.rows - 10 : process.stdout.rows
  }

  registerLines(lines: Line[]) {
    lines.forEach(line => (line.cli = this))
  }

  get activeLineIndex() {
    return this.visibleLines.indexOf(this.activeLine)
  }

  moveActiveLine(delta: number) {
    this.setActiveLine(this.visibleLines[this.activeLineIndex + delta])
  }
  setActiveLine(line: undefined | Line, opts: { scroll?: "middle" | "visible" } = {}) {
    if (!line) {
      return
    }
    this.activeLine = line

    // update which line is active
    this.lines.filter(line => line.setActive).forEach((line, i) => line.setActive(false))
    if (line.setActive) {
      line.setActive(true)
    }

    const scrollTop = this.scrollPos
    const scrollBottom = this.scrollPos + this.height - 1

    debugLog("checking scroll")
    //set scroll position
    if (opts.scroll === "middle") {
      this.scrollPos = this.activeLineIndex - this.height / 2
    } else {
      if (scrollTop > this.activeLineIndex) {
        debugLog("scrolling up")
        this.scrollPos = this.activeLineIndex
      } else if (scrollBottom < this.activeLineIndex) {
        debugLog("scrolling down", this.scrollPos, this.activeLineIndex)
        this.scrollPos = this.activeLineIndex - this.height + 1
      }
    }

    this.clampScrolling()
  }

  clampScrolling() {
    const activePos = this.visibleLines.indexOf(this.activeLine) + 1
    if (activePos > this.scrollPos + this.height) {
      this.scrollPos = activePos
    }

    const maxScrollTop = Math.max(this.visibleLines.length - this.height, 0)
    // clamp scrolling
    if (this.scrollPos > maxScrollTop) {
      this.scrollPos = maxScrollTop
    }
    if (this.scrollPos < 0) {
      this.scrollPos = 0
    }
  }

  addLine(line: Line) {
    if (this.lines.includes(line)) {
      throw "trying to add line that is already mounted"
    }
    this.registerLines([line])
    this.lines.push(line)
    line.children.forEach((line, i) => this.addLine(line))
    line.onAfterMount()
  }

  setState(newState) {
    this.globalState = newState
    this.lines.forEach(line => line.onGlobalStateChange(newState))
    this.reRender()
  }

  handleKeyPress(str, key: IKey) {
    key.isChar = key.sequence.length === 1 && (key.name === undefined || key.name.length === 1)
    key.str = str

    if (key.name === "up") {
      this.moveActiveLine(-1)
    } else if (key.name === "down") {
      this.moveActiveLine(1)
    } else if (key.name === "pageup") {
      this.setActiveLine(this.visibleLines[0])
    } else if (key.name === "pagedown") {
      this.setActiveLine(this.visibleLines[this.visibleLines.length - 1])
    } else {
      const line = this.visibleLines[this.activeLineIndex]
      if (line.handleInput) {
        line.handleInput(key)
      }
    }

    debugLog("want to render")

    this.reRender()
  }

  get visibleLines() {
    if (this.showHidden) {
      return this.lines
    } else {
      const hidden = this.hiddenLines
      return this.lines.filter(line => !hidden.includes(line))
    }
  }

  get hiddenLines() {
    return this.lines.filter(
      line => line !== this.activeLine && line.hidden // &&
      // this.getAllChildren(line).every(child => child.hidden)
      // (line.hidden || this.getParents(line).some(line => line.hidden && line !== this.activeLine))
    )
  }

  getParents(line: Line) {
    const cache = new Map()

    if (!cache.has(line)) {
      debugLog("missed cache for line", line)
      const parents = []
      if (line.parent) {
        parents.push(line.parent, ...this.getParents(line.parent))
      }
      cache.set(line, parents)
    }
    return cache.get(line)!
  }

  allChildrenCache = new Map()
  getAllChildren(line: Line) {
    if (!this.allChildrenCache.has(line)) {
      const children = line.children
      if (line.parent) {
        line.children.forEach(child => {
          children.push(...this.getAllChildren(child))
        })
      }
      this.allChildrenCache.set(line, children)
    }
    return this.allChildrenCache.get(line)!
  }

  logger = new BufferedLogger()
  renderCache = {}

  async reRender() {
    await 1

    const screenBuffer = this.logger.newBuffer()
    const key = Math.random()
    debugLog("rerender")
    time("full render", () => {
      time("  clamp scrolling", () => {
        this.clampScrolling()
      })

      // console.clear()
      // process.stdout.write("\x1b[3J")
      let linesToRender
      time("  visible lines", () => {
        linesToRender = this.visibleLines.slice(this.scrollPos, this.scrollPos + this.height)
      })
      // await 1
      time("  render all", () => {
        const text = linesToRender.map((line, i) => {
          if (line.changed === false && line.key in this.renderCache) {
            // return this.renderCache[line.key]
          }
          let str = ""
          if (i + this.scrollPos === this.activeLineIndex) {
            str += `> `
          } else {
            str += `  `
          }
          if (this.debug) {
            str += `${line.key} | `
          }
          if (line.render) {
            time(`    render ${line.key} ${line.constructor.name}`, () => {
              str += line.render()
              line.changed = false
            })
          } else {
            throw "line must define a render method"
          }
          this.renderCache[line.key] = str

          if (this.showHidden && line.hidden) {
            str = chalk.dim(str)
          }
          return str
        })
        screenBuffer.print(text.join("\n"))
      })

      if (this.debug) {
        screenBuffer.println("")
        screenBuffer.println("")
        screenBuffer.println(
          JSON.stringify({
            active: this.activeLine.key,
            scroll: this.scrollPos,
            height: this.height,
            potentialHeight: this.visibleLines.length,
            activePos: this.visibleLines.indexOf(this.activeLine),
            maxScrollTop: Math.max(this.visibleLines.length - this.height, 0)
          })
        )
      }

      time("  flush", () => {
        screenBuffer.flush()
      })
      debugLog("DONE", key)
    })
  }
}

function time(name, cb) {
  // const start = process.hrtime()
  cb()
  // debugLog(`time ${name}`, prettyTime(process.hrtime(start)))
}
