import { NavLink } from 'react-router-dom';
import {
  MessageSquare,
  LayoutDashboard,
  User,
  MessageCircle,
  Settings,
  Zap,
  Database,
  Brain,
  Stethoscope,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: MessageSquare, label: 'Sohbet' },
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/assistant', icon: Brain, label: 'Asistan Merkezi' },
  { to: '/profile', icon: User, label: 'Profil' },
  { to: '/feedback', icon: MessageCircle, label: 'Geri Bildirim' },
  { to: '/evolution', icon: Database, label: 'Evrim Motoru' },
  { to: '/surgery', icon: Stethoscope, label: 'Cerrahi Bakım' },
  { to: '/settings', icon: Settings, label: 'Ayarlar' },
];

export default function Sidebar() {
  return (
    <aside className="flex w-16 flex-col items-center border-r border-zinc-800 bg-zinc-950 py-4 gap-1">
      <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
        <Zap className="h-5 w-5 text-amber-500" />
      </div>

      {navItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${isActive
              ? 'bg-amber-500/15 text-amber-500'
              : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
            }`
          }
          title={label}
        >
          <Icon className="h-5 w-5" />
        </NavLink>
      ))}
    </aside>
  );
}
