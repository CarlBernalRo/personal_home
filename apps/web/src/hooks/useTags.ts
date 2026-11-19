import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/auth'
import { updateUserProfile } from '@/lib/firestore'
import { TAG_COLORS, type Tag } from '@/shared'

const NO_TAGS: Tag[] = []

/** The user's tags (kept on their profile) and the ways to create, change and delete them. */
export function useTags() {
  const { user, profile } = useAuth()
  const setProfile = useAuthStore((s) => s.setProfile)
  const tags = ((profile as any)?.tags ?? NO_TAGS) as Tag[]

  async function save(next: Tag[]) {
    if (!user) return
    await updateUserProfile(user.uid, { tags: next })
    setProfile({ ...(profile as any), tags: next } as any)
  }

  return {
    tags,
    async add(name: string, color?: string) {
      const tag: Tag = { id: `tg_${Date.now().toString(36)}`, name: name.trim(), color: color ?? TAG_COLORS[tags.length % TAG_COLORS.length] }
      await save([...tags, tag])
      return tag
    },
    update: (id: string, patch: Partial<Omit<Tag, 'id'>>) => save(tags.map((t) => (t.id === id ? { ...t, ...patch } : t))),
    /** The tag disappears from everything that carried it (records keep the id, but a missing tag is never shown). */
    remove: (id: string) => save(tags.filter((t) => t.id !== id)),
  }
}
