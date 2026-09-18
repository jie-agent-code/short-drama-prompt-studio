export type TemplateKind = 'image_prompt' | 'video_prompt'

export type TemplateRecord = {
  id: string
  name: string
  kind: TemplateKind
  content: string
  createdAt: string
  updatedAt: string
}

export type ProjectRecord = {
  id: string
  name: string
  leadCharacter?: { name?: string; role?: string; gender?: string }
  createdAt: string
  updatedAt: string
}

export type ShotBlockRecord = {
  id: string
  projectId: string
  sequence: number
  /** 本镜秒数，由时长模式决定（10 秒或 6 秒）。 */
  durationSeconds: number
  title: string
  movement: string
  prompt: string
  transition: string
  incomingAnchor?: string
  outgoingAnchor?: string
  audit?: string
}
