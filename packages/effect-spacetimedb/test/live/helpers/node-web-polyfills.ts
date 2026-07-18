import { File as NodeFile } from "node:buffer"

if (typeof globalThis.File === "undefined") {
  globalThis.File = NodeFile as typeof globalThis.File
}

const stringPrototype = String.prototype as typeof String.prototype & {
  toWellFormed?: () => string
}

if (typeof stringPrototype.toWellFormed !== "function") {
  stringPrototype.toWellFormed = function () {
    return String(this)
  }
}

if (typeof globalThis.WebSocket === "undefined") {
  const { WebSocket: UndiciWebSocket } = await import("undici")
  globalThis.WebSocket = UndiciWebSocket as typeof globalThis.WebSocket
}
