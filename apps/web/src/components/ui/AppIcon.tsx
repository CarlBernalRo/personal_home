import {
  Banknote, CalendarClock, ClipboardList, Clapperboard, Coins, CreditCard, Gem, GraduationCap, HeartPulse, Home, Landmark,
  Lightbulb, Package, PartyPopper, PawPrint, PiggyBank, Plane, Plus, Receipt, Shirt, ShoppingBag, ShoppingCart, Smartphone,
  Target, TrendingUp, TriangleAlert, UtensilsCrossed, Wallet, Car, User, ShieldCheck, Fuel, Wrench, Wifi, Repeat, Gamepad2,
  Sparkles, Laptop, Sofa, Building2, ArrowLeftRight, type LucideIcon,
} from 'lucide-react'

/**
 * The icons the app draws in place of emojis. Categories, account types and savings goals keep one of
 * these keys (`icon: 'food'`); `AppIcon` turns the key into a line icon in the app's style.
 */
export const APP_ICONS: Record<string, LucideIcon> = {
  food: UtensilsCrossed, market: ShoppingCart, transport: Car, services: Lightbulb, fun: Clapperboard,
  health: HeartPulse, other: Package, housing: Home, savings: PiggyBank, debt: CreditCard, pets: PawPrint,
  clothes: Shirt, bank: Landmark, cash: Banknote, invest: TrendingUp, money: Coins, wallet: Wallet, trip: Plane,
  phone: Smartphone, ring: Gem, edu: GraduationCap, target: Target, bag: ShoppingBag, list: ClipboardList,
  receipt: Receipt, calendar: CalendarClock, plus: Plus, user: User, shield: ShieldCheck, party: PartyPopper, alert: TriangleAlert,
  fuel: Fuel, wrench: Wrench, wifi: Wifi, repeat: Repeat, gamepad: Gamepad2, sparkles: Sparkles, laptop: Laptop, sofa: Sofa,
  building: Building2, swap: ArrowLeftRight,
}

/** Goals and accounts saved before the icons existed carry an emoji: it still maps to the matching icon. */
const LEGACY_EMOJI: Record<string, string> = {
  '🍽️': 'food', '🍽': 'food', '🛒': 'market', '🚗': 'transport', '💡': 'services', '🎬': 'fun', '🏥': 'health', '📦': 'other',
  '🏠': 'housing', '🐷': 'savings', '💳': 'debt', '🐾': 'pets', '👕': 'clothes', '🏦': 'bank', '💵': 'cash', '📈': 'invest',
  '💰': 'money', '✈️': 'trip', '✈': 'trip', '📱': 'phone', '💍': 'ring', '🎓': 'edu', '🎯': 'target', '🛍️': 'bag', '🛍': 'bag',
}

/** The icons a savings goal can choose from. */
export const GOAL_ICON_KEYS = ['housing', 'trip', 'transport', 'phone', 'ring', 'edu', 'pets', 'bag', 'target', 'money'] as const

export function iconOf(name: string | undefined | null): LucideIcon {
  if (!name) return Package
  return APP_ICONS[name] ?? APP_ICONS[LEGACY_EMOJI[name] ?? ''] ?? Package
}

/** A line icon by key (or by legacy emoji). */
export function AppIcon({ name, size = 16, className }: { name: string | undefined | null; size?: number; className?: string }) {
  const Icon = iconOf(name)
  return <Icon size={size} className={className} aria-hidden="true" />
}

/** Icon on a tinted, notched chip: the way list rows show a category, an account or a goal. */
export function IconChip({ name, color = '#6b7280', size = 40, iconSize, className }: { name: string | undefined | null; color?: string; size?: number; iconSize?: number; className?: string }) {
  return (
    <span
      className={`notch-sm flex items-center justify-center flex-shrink-0 ${className ?? ''}`}
      style={{ width: size, height: size, backgroundColor: color + '25', border: `1px solid ${color}40`, color }}
      aria-hidden="true"
    >
      <AppIcon name={name} size={iconSize ?? Math.round(size * 0.45)} />
    </span>
  )
}

/** The mark an empty state shows above its message. */
export function EmptyMark({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={`inline-flex w-14 h-14 notch-sm items-center justify-center mb-3 bg-brand-500/10 border border-brand-500/30 text-brand-300 ${className ?? ''}`}
      aria-hidden="true"
    >
      <AppIcon name={name} size={26} />
    </span>
  )
}
