export type RoleType = 'admin' | 'integrante'

export interface Role {
  id: RoleType
  name: string
  slug: RoleType
  description: string
  permissions: string[]
  createdAt?: Date
}

