/**
 * Module: index.ts
 *
 * Index React component.
 *
 * How it connects:
 * - Re-exports AdminLayout, AppLayout, sidebars, and navbars
 * - Consumed via: import { AdminLayout, TopNavbar } from '@/components/layout'
 * Simple explanation:
 * Central export file for layout components. */

export { default as AdminLayout } from './AdminLayout'
export { default as AdminNavbar } from './AdminNavbar'
export { default as AdminSidebar } from './AdminSidebar'
export { default as AppLayout } from './AppLayout'
export { default as Sidebar } from './Sidebar'
export { default as TopNavbar } from './TopNavbar'
