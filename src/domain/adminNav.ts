import type { AdminProfile } from './adminProfile'

export interface NavLink {
  label: string
  to: string
  icon: 'users' | 'brigades'
}

export interface NavAppliance {
  label: string
  to: string
  inactive: boolean
}

export interface NavBrigade {
  name: string
  overview: string
  appliances: NavAppliance[]
}

export interface AdminNavNodes {
  top: NavLink[]
  brigade: NavBrigade | null
}

const USERS: NavLink = { label: 'Users', to: '/admin/users', icon: 'users' }
const BRIGADES: NavLink = { label: 'Brigades', to: '/admin/brigades', icon: 'brigades' }

function topLinks(profile: AdminProfile | null): NavLink[] {
  if (profile?.kind === 'superadmin') return [USERS, BRIGADES]
  if (profile?.kind === 'admin' && profile.role === 'vso') return [BRIGADES]
  return []
}

export function adminNav(
  profile: AdminProfile | null,
  brigade: { slug: string; name: string } | undefined,
  appliances: { id: string; callsign: string; active: boolean }[] | null,
): AdminNavNodes {
  return {
    top: topLinks(profile),
    brigade: brigade
      ? {
          name: brigade.name,
          overview: `/${brigade.slug}/admin`,
          appliances: [...(appliances ?? [])]
            .sort((a, b) => a.callsign.localeCompare(b.callsign))
            .map((appliance) => ({
              label: appliance.callsign,
              to: `/${brigade.slug}/admin/${appliance.id}`,
              inactive: !appliance.active,
            })),
        }
      : null,
  }
}
