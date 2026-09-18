import type { TemplateKind, TemplateRecord } from '../../domain/types'
import type { CreateTemplateInput, TemplateRepository } from './template-repository'

/** Development adapter only. Replace with SqlTemplateRepository for persistent storage. */
export class MemoryTemplateRepository implements TemplateRepository {
  private records = new Map<string, TemplateRecord>()
  async list(kind?: TemplateKind) { return Array.from(this.records.values()).filter(item => !kind || item.kind === kind) }
  async getById(id: string) { return this.records.get(id) || null }
  async create(input: CreateTemplateInput) {
    const now = new Date().toISOString(); const record: TemplateRecord = { id: crypto.randomUUID(), ...input, createdAt: now, updatedAt: now }
    this.records.set(record.id, record); return record
  }
  async update(id: string, input: Partial<CreateTemplateInput>) {
    const current = this.records.get(id); if (!current) return null
    const record = { ...current, ...input, updatedAt: new Date().toISOString() }; this.records.set(id, record); return record
  }
  async delete(id: string) { return this.records.delete(id) }
}
