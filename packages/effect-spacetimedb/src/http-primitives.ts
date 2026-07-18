import { Headers as PolyfillHeaders } from "headers-polyfill"

export type BodyInit = ArrayBuffer | ArrayBufferView | string
export type Headers = InstanceType<typeof PolyfillHeaders>
export type HeadersInit = ConstructorParameters<typeof PolyfillHeaders>[0]

export type RequestInit = {
  readonly body?: BodyInit | null
  readonly headers?: HeadersInit
  readonly method?: string
  readonly version?: unknown
}

export type ResponseInit = {
  readonly headers?: HeadersInit
  readonly status?: number
  readonly statusText?: string
  readonly version?: unknown
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const bodyToBytes = (body: BodyInit | null | undefined): Uint8Array => {
  if (body === null || body === undefined) {
    return new Uint8Array()
  }
  if (typeof body === "string") {
    return textEncoder.encode(body)
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body)
  }
  return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
}

const bodyToText = (body: BodyInit | null | undefined): string =>
  typeof body === "string" ? body : textDecoder.decode(bodyToBytes(body))

export const Headers = PolyfillHeaders

export class Request {
  readonly #body: BodyInit | null
  readonly #headers: Headers
  readonly #method: string
  readonly #uri: string
  readonly #version: unknown

  constructor(url: URL | string, init: RequestInit = {}) {
    this.#body = init.body ?? null
    this.#headers = new Headers(init.headers)
    this.#method = init.method ?? "GET"
    this.#uri = String(url)
    this.#version = init.version ?? { tag: "Http11" }
  }

  get headers(): Headers {
    return this.#headers
  }

  get method(): string {
    return this.#method
  }

  get uri(): string {
    return this.#uri
  }

  get url(): string {
    return this.#uri
  }

  get version(): unknown {
    return this.#version
  }

  arrayBuffer(): ArrayBuffer {
    const bytes = this.bytes()
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
  }

  bytes(): Uint8Array {
    return bodyToBytes(this.#body)
  }

  json(): unknown {
    return JSON.parse(this.text()) as unknown
  }

  text(): string {
    return bodyToText(this.#body)
  }
}

export class SyncResponse {
  readonly #body: BodyInit | null
  readonly #headers: Headers
  readonly #status: number
  readonly #statusText: string
  readonly #version: unknown

  constructor(body?: BodyInit | null, init: ResponseInit = {}) {
    this.#body = body ?? null
    this.#headers = new Headers(init.headers)
    this.#status = init.status ?? 200
    this.#statusText = init.statusText ?? ""
    this.#version = init.version ?? { tag: "Http11" }
  }

  get headers(): Headers {
    return this.#headers
  }

  get status(): number {
    return this.#status
  }

  get statusText(): string {
    return this.#statusText
  }

  get ok(): boolean {
    return this.#status >= 200 && this.#status < 300
  }

  get url(): string {
    return ""
  }

  get type(): "default" {
    return "default"
  }

  get version(): unknown {
    return this.#version
  }

  arrayBuffer(): ArrayBuffer {
    const bytes = this.bytes()
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
  }

  bytes(): Uint8Array {
    return bodyToBytes(this.#body)
  }

  json(): unknown {
    return JSON.parse(this.text()) as unknown
  }

  text(): string {
    return bodyToText(this.#body)
  }
}

type RouteSpec = {
  readonly method: string
  readonly path: string
  readonly handler: unknown
}

export class Router {
  readonly #routes: ReadonlyArray<RouteSpec>

  constructor(routes: ReadonlyArray<RouteSpec> = []) {
    this.#routes = routes
  }

  get(path: string, handler: unknown): Router {
    return this.addRoute("get", path, handler)
  }

  head(path: string, handler: unknown): Router {
    return this.addRoute("head", path, handler)
  }

  options(path: string, handler: unknown): Router {
    return this.addRoute("options", path, handler)
  }

  put(path: string, handler: unknown): Router {
    return this.addRoute("put", path, handler)
  }

  delete(path: string, handler: unknown): Router {
    return this.addRoute("delete", path, handler)
  }

  post(path: string, handler: unknown): Router {
    return this.addRoute("post", path, handler)
  }

  patch(path: string, handler: unknown): Router {
    return this.addRoute("patch", path, handler)
  }

  any(path: string, handler: unknown): Router {
    return this.addRoute("any", path, handler)
  }

  intoRoutes(): ReadonlyArray<RouteSpec> {
    return [...this.#routes]
  }

  private addRoute(method: string, path: string, handler: unknown): Router {
    return new Router([...this.#routes, { method, path, handler }])
  }
}
