import type { TemplateKind, TemplateRecord } from '../../domain/types'

export type CreateTemplateInput = { name: string; kind: TemplateKind; content: string }

/**
 * Storage boundary. The UI/API should depend on this contract, not on a database driver.
 * A SQL implementation can replace the local adapter without changing feature code.
 */
export interface TemplateRepository {
  list(kind?: TemplateKind): Promise<TemplateRecord[]>
  getById(id: string): Promise<TemplateRecord | null>
  create(input: CreateTemplateInput): Promise<TemplateRecord>
  update(id: string, input: Partial<CreateTemplateInput>): Promise<TemplateRecord | null>
  delete(id: string): Promise<boolean>
}
