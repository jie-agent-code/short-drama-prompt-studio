/**
 * 模板库的导出 / 导入 —— 唯一实现处。
 *
 * 为什么需要它：图片/视频提示词模板只存在浏览器 localStorage，
 * 既不进代码仓库、也不进 `.env.local`。换电脑、换浏览器、甚至换端口都会静默清空。
 * 导出/导入是唯一不丢模板的通道，所以校验规则必须集中在这里，不能散在组件里。
 *
 * 校验原则：字段不合法就整条剔除，不做猜测性修补。
 * 宁可少导入一条，也不塞一个半对的模板进去。
 */

export type TemplateItem = { id: string; name: string; content: string }

export type TemplateFile = {
  version: number
  exportedAt: string
  image: TemplateItem[]
  video: TemplateItem[]
}

export const TEMPLATE_FILE_VERSION = 1

/** localStorage 的两个 key。改动这里会切断用户既有数据，不要随手改。 */
export const IMAGE_TEMPLATE_KEY = 'short-drama-image-prompt-templates'
export const VIDEO_TEMPLATE_KEY = 'short-drama-video-templates'

export type TemplateParseResult =
  | { ok: true; image: TemplateItem[]; video: TemplateItem[] }
  | { ok: false; reason: 'invalid-json' | 'no-templates' }

/**
 * 校验并归一化模板数组。
 * 要求 id / name / content 三者都是 string，否则整条剔除。
 */
export function parseTemplateList(value: unknown): TemplateItem[] {
  if (!Array.isArray(value)) return []
  return (value as Array<Record<string, unknown>>)
    .filter((item) => typeof item?.id === 'string' && typeof item?.name === 'string' && typeof item?.content === 'string')
    .map((item) => ({ id: String(item.id), name: String(item.name), content: String(item.content) }))
}

/**
 * 按 id 合并两份模板。同 id 以 incoming 为准。
 * 这样重复导入同一份文件不会产生副本，导入到已有模板的机器上也不会出现重复项。
 */
export function mergeTemplates(current: TemplateItem[], incoming: TemplateItem[]): TemplateItem[] {
  return Array.from(new Map([...current, ...incoming].map((item) => [item.id, item])).values())
}

/**
 * 解析导出文件文本。
 * - JSON 非法 -> `{ ok:false, reason:'invalid-json' }`
 * - JSON 合法但没有任何可用模板 -> `{ ok:false, reason:'no-templates' }`
 *
 * 用可判别的返回值而不是抛异常：调用方要区分这两种失败并给出不同提示。
 */
export function parseTemplateFile(text: string): TemplateParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }
  const source = (data ?? {}) as { image?: unknown; video?: unknown }
  const image = parseTemplateList(source.image)
  const video = parseTemplateList(source.video)
  if (!image.length && !video.length) return { ok: false, reason: 'no-templates' }
  return { ok: true, image, video }
}

export function buildTemplateFile(image: TemplateItem[], video: TemplateItem[]): TemplateFile {
  return { version: TEMPLATE_FILE_VERSION, exportedAt: new Date().toISOString(), image, video }
}

/** 导出用的文本。缩进 2 空格：用户可能手改这个文件，要可读。 */
export function serializeTemplateFile(image: TemplateItem[], video: TemplateItem[]): string {
  return JSON.stringify(buildTemplateFile(image, video), null, 2)
}

/** 导出文件名，形如 `短剧模板库-2026-09-18.json`。 */
export function templateFileName(now: Date = new Date()): string {
  return `短剧模板库-${now.toISOString().slice(0, 10)}.json`
}
