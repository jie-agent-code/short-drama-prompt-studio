export type StylePreset = {
  id: string
  name: string
  description: string
  format: string
  visualRules: string[]
  pacingRules: string[]
  dialogueRules: string[]
  recommendedShotSizes: string[]
  recommendedMovements: string[]
  negativeRules: string[]
}

export const STYLE_PRESETS: StylePreset[] = [
  { id: 'hongguo_short_drama', name: '红果竖屏短剧', description: '冲突直接、节奏快、适合连续 10 秒拼接', format: '9:16 竖屏，写实短剧质感', visualRules: ['开头 0.5-1 秒出现明确人物或事件', '人物脸部、手部和脚部清楚', '前景和背景简洁，不抢主体'], pacingRules: ['每 10 秒只推进一个事件', '结尾留下明确动作、视线或悬念'], dialogueRules: ['台词短、口语化、说完留出反应时间'], recommendedShotSizes: ['远景', '中景', '近景'], recommendedMovements: ['跟拍', '手持感', '过肩反打镜头 Over-the-Shoulder / Reverse Shot'], negativeRules: ['无水印', '无文字', '无突然新增人物'] },
  { id: 'ue5_xianxia', name: 'UE5 国风仙侠 CG', description: '大尺度环境、体积光和高密度特效', format: '9:16 竖屏，UE5.4 写实渲染，电影级 CG', visualRules: ['体积光、粒子、烟尘和能量来源必须具体可见', '远景先交代空间，再用低机位突出人物'], pacingRules: ['先建立大场面，再给力量爆点', '特效必须服务于人物动作'], dialogueRules: ['台词威严、短促、带停顿'], recommendedShotSizes: ['远景', '中景', '近景 / 特写'], recommendedMovements: ['升降运镜 Crane Up/Down', '低机位 Dolly In 前推', '后拉揭示 Dolly Out'], negativeRules: ['无塑料感', '无随机光效', '无特效遮挡人物脸部'] },
  { id: 'urban_romance', name: '都市情感短剧', description: '真实生活场景、细腻表情和关系距离', format: '9:16 竖屏，写实都市影视质感', visualRules: ['使用真实室内外生活场景', '用冷暖光和前后景关系表达人物关系'], pacingRules: ['动作克制，重点放在视线、停顿和手部动作'], dialogueRules: ['自然口语，台词后保留表情反应'], recommendedShotSizes: ['中远景', '中景', '近景'], recommendedMovements: ['过肩反打镜头 Over-the-Shoulder / Reverse Shot', '焦点转移', '缓慢推进'], negativeRules: ['无夸张超自然特效', '无无理由的舞蹈动作'] },
  { id: 'high_energy_action', name: '高燃动作打斗', description: '清楚攻防因果、速度变化和受击反馈', format: '9:16 竖屏，电影级动作片质感', visualRules: ['动作起点、方向、命中点和受击反馈都要明确', '运动模糊和拖影不能遮住手脚'], pacingRules: ['一段只完成一轮攻防或一个关键动作', '爆点后保留结果姿态'], dialogueRules: ['台词短促，不能覆盖打击声'], recommendedShotSizes: ['中远景', '中景', '近景 / 特写'], recommendedMovements: ['手持感', '子弹时间运镜 Bullet Time', '慢门镜头 Slow Shutter'], negativeRules: ['无肢体变形', '无倒放', '无没有因果的爆炸'] },
  { id: 'suspense_thriller', name: '悬疑惊悚', description: '信息控制、视线引导和声音先行', format: '9:16 竖屏，低饱和悬疑影视质感', visualRules: ['前景遮挡适度，关键线索必须清楚', '低照度但人物眼睛和关键道具可见'], pacingRules: ['先隐藏信息，再用焦点或声音揭示', '结尾停在未解决的视线或动作'], dialogueRules: ['台词少、压低声音、停顿明显'], recommendedShotSizes: ['远景', '中近景', '特写'], recommendedMovements: ['POV 主观视角', '焦点转移', '后拉揭示 Dolly Out'], negativeRules: ['无无关路人', '无提前泄露关键真相'] },
]

export const DEFAULT_STYLE_PRESET_ID = 'hongguo_short_drama'
export function getStylePreset(id?: string): StylePreset {
  return STYLE_PRESETS.find((preset) => preset.id === id) || STYLE_PRESETS[0]
}
