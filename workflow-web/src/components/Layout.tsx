import { NavLink, Outlet } from 'react-router-dom';
import StatusBar from './StatusBar';

const tabs = [
  { to: '/', label: 'Home', end: true },
  { to: '/instances', label: 'Instances' },
  { to: '/tasks', label: 'Tasklist' },
  { to: '/forms', label: 'Forms' },
  { to: '/incidents', label: 'Incidents' },
];

export default function Layout() {
  return (
    <div id="app">
      <div id="header">
        <span className="header-title">Workflow Engine</span>
        <nav id="tabs">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) => `tab${isActive ? ' active' : ''}`}
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
      <StatusBar />
    </div>
  );
}
