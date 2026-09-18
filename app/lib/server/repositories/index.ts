import type { TemplateRepository } from './template-repository'
import { MemoryTemplateRepository } from './memory-template-repository'

// Keep one composition point so a SQL adapter can be injected later.
let repository: TemplateRepository | undefined
export function getTemplateRepository(): TemplateRepository {
  if (!repository) repository = new MemoryTemplateRepository()
  return repository
}
