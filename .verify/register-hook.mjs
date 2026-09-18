// 通过 module.register 注册 .verify/resolve-hook.mjs，让 Node 能解析无扩展名的相对引用。
import { register } from 'node:module'

register('./resolve-hook.mjs', import.meta.url)
