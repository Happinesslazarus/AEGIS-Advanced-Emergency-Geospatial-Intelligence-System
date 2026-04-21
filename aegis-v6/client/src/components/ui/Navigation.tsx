/**
 * Navigation UI primitive (low-level UI building block).
 *
 * - Uses useResponsive for breakpoint detection
 * - Uses useFocusTrap for mobile drawer accessibility
 */
import React, { memo, useState, useCallback } from 'react'
import { useResponsive } from '../../hooks/useResponsive'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useTranslation } from 'react-i18next'

//NAVBAR

interface NavbarProps {
  /** Logo element or text */
  logo: React.ReactNode
  /** Navigation items */
  items: NavItem[]
  /** Right side content (user menu, etc.) */
  rightContent?: React.ReactNode
  /** Current active path */
  currentPath?: string
  /** Navigation callback */
  onNavigate?: (path: string) => void
  /** Additional CSS classes */
  className?: string
}

export interface NavItem {
  label: string
  path: string
  icon?: React.ReactNode
  children?: NavItem[] // For dropdowns
}

export const Navbar = memo<NavbarProps>(({
  logo,
  items,
  rightContent,
  currentPath,
  onNavigate,
  className = '',
}) => {
  const { t } = useTranslation()
  const { isMobile } = useResponsive()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  
  const toggleMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(prev => !prev)
  }, [])
  
  const closeMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(false)
  }, [])
  
  const handleNavigate = useCallback((path: string) => {
    onNavigate?.(path)
    closeMobileMenu()
  }, [onNavigate, closeMobileMenu])
  
  return (
    <header className={`bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 ${className}`}>
      <nav
        aria-label={'Main'}
        className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8"
      >
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <div className="flex-shrink-0">
            {logo}
          </div>
          
          {/* Desktop navigation */}
          {!isMobile && (
            <div className="hidden md:flex md:items-center md:space-x-1">
              {items.map(item => (
                <NavLink
                  key={item.path}
                  item={item}
                  currentPath={currentPath}
                  onNavigate={handleNavigate}
                />
              ))}
            </div>
          )}
          
          {/* Right content + mobile menu button */}
          <div className="flex items-center gap-4">
            {rightContent}
            
            {/* Mobile menu button */}
            {isMobile && (
              <button
                type="button"
                onClick={toggleMobileMenu}
                className="inline-flex items-center justify-center p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-aegis-500"
                aria-expanded={isMobileMenuOpen}
                aria-controls="mobile-menu"
                aria-label={isMobileMenuOpen ? 'Close Menu' : 'Open Menu'}
              >
                {isMobileMenuOpen ? (
                  <CloseIcon className="h-6 w-6" />
                ) : (
                  <MenuIcon className="h-6 w-6" />
                )}
              </button>
            )}
          </div>
        </div>
        
        {/* Mobile menu */}
        {isMobile && isMobileMenuOpen && (
          <MobileMenu
            items={items}
            currentPath={currentPath}
            onNavigate={handleNavigate}
            onClose={closeMobileMenu}
          />
        )}
      </nav>
    </header>
  )
})

Navbar.displayName = 'Navbar'

//NAV LINK

interface NavLinkProps {
  item: NavItem
  currentPath?: string
  onNavigate: (path: string) => void
}

const NavLink = memo<NavLinkProps>(({
  item,
  currentPath,
  onNavigate,
}) => {
  const isActive = currentPath === item.path
  
  return (
    <button
      type="button"
      onClick={() => onNavigate(item.path)}
      className={`
        flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
        transition-colors duration-150
        focus:outline-none focus:ring-2 focus:ring-aegis-500
        ${isActive 
          ? 'bg-aegis-50 dark:bg-aegis-900/30 text-aegis-700 dark:text-aegis-300' 
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
        }
      `}
      aria-current={isActive ? 'page' : undefined}
    >
      {item.icon && (
        <span className="flex-shrink-0 h-5 w-5" aria-hidden="true">
          {item.icon}
        </span>
      )}
      {item.label}
    </button>
  )
})

NavLink.displayName = 'NavLink'

//MOBILE MENU

interface MobileMenuProps {
  items: NavItem[]
  currentPath?: string
  onNavigate: (path: string) => void
  onClose: () => void
}

const MobileMenu = memo<MobileMenuProps>(({
  items,
  currentPath,
  onNavigate,
  onClose,
}) => {
  const { prefersReduced, getSafeTransition } = useReducedMotion()
  const menuRef = useFocusTrap<HTMLDivElement>({
    enabled: true,
    onEscape: onClose,
  })
  
  return (
    <div
      ref={menuRef}
      id="mobile-menu"
      className={`
        md:hidden py-4 space-y-1
        ${prefersReduced ? '' : 'animate-slide-down'}
      `}
      style={{ transition: getSafeTransition('all 200ms ease-out') }}
    >
      {items.map(item => (
        <button
          key={item.path}
          type="button"
          onClick={() => onNavigate(item.path)}
          className={`
            w-full flex items-center gap-3 px-3 py-2 rounded-lg text-base font-medium
            ${currentPath === item.path 
              ? 'bg-aegis-50 dark:bg-aegis-900/30 text-aegis-700 dark:text-aegis-300' 
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            }
            focus:outline-none focus:ring-2 focus:ring-aegis-500
          `}
          aria-current={currentPath === item.path ? 'page' : undefined}
        >
          {item.icon && (
            <span className="flex-shrink-0 h-5 w-5" aria-hidden="true">
              {item.icon}
            </span>
          )}
          {item.label}
        </button>
      ))}
    </div>
  )
})

MobileMenu.displayName = 'MobileMenu'

//BREADCRUMBS

interface BreadcrumbItem {
  label: string
  path?: string // If undefined, it's the current page
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[]
  onNavigate?: (path: string) => void
  /** Separator character or element */
  separator?: React.ReactNode
  /** Max visible items (rest are collapsed) */
  maxItems?: number
  /** Additional CSS classes */
  className?: string
}

export const Breadcrumbs = memo<BreadcrumbsProps>(({
  items,
  onNavigate,
  separator = <ChevronRightIcon className="h-4 w-4 text-gray-400" />,
  maxItems,
  className = '',
}) => {
  const { t } = useTranslation()
  
  const displayItems = maxItems && items.length > maxItems
    ? [
        items[0],
        { label: '...', path: undefined },
        ...items.slice(-Math.max(1, maxItems - 2)),
      ]
    : items
  
  return (
    <nav aria-label={'Breadcrumb'} className={className}>
      <ol className="flex items-center space-x-2">
        {displayItems.map((item, index) => {
          const isLast = index === displayItems.length - 1
          const isCollapsed = item.label === '...'
          
          return (
            <li key={`${item.path || item.label}-${index}`} className="flex items-center">
              {index > 0 && (
                <span className="mx-2" aria-hidden="true">
                  {separator}
                </span>
              )}
              
              {isCollapsed ? (
                <span className="text-gray-400">...</span>
              ) : item.path && !isLast ? (
                <button
                  type="button"
                  onClick={() => onNavigate?.(item.path!)}
                  className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-aegis-500 rounded"
                >
                  {item.label}
                </button>
              ) : (
                <span
                  className={`text-sm ${isLast ? 'font-medium text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
})

Breadcrumbs.displayName = 'Breadcrumbs'

//SIDEBAR NAV

interface SidebarNavProps {
  items: NavItem[]
  currentPath?: string
  onNavigate?: (path: string) => void
  /** Collapsed state */
  isCollapsed?: boolean
  /** Additional CSS classes */
  className?: string
}

export const SidebarNav = memo<SidebarNavProps>(({
  items,
  currentPath,
  onNavigate,
  isCollapsed = false,
  className = '',
}) => {
  const { t } = useTranslation()
  
  return (
    <nav
      aria-label={'Sidebar'}
      className={`space-y-1 ${className}`}
    >
      {items.map(item => (
        <button
          key={item.path}
          type="button"
          onClick={() => onNavigate?.(item.path)}
          title={isCollapsed ? item.label : undefined}
          className={`
            w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium
            transition-colors duration-150
            focus:outline-none focus:ring-2 focus:ring-aegis-500
            ${currentPath === item.path 
              ? 'bg-aegis-50 dark:bg-aegis-900/30 text-aegis-700 dark:text-aegis-300' 
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            }
            ${isCollapsed ? 'justify-center' : ''}
          `}
          aria-current={currentPath === item.path ? 'page' : undefined}
        >
          {item.icon && (
            <span className={`flex-shrink-0 ${isCollapsed ? 'h-6 w-6' : 'h-5 w-5'}`} aria-hidden="true">
              {item.icon}
            </span>
          )}
          {!isCollapsed && <span>{item.label}</span>}
          {isCollapsed && <span className="sr-only">{item.label}</span>}
        </button>
      ))}
    </nav>
  )
})

SidebarNav.displayName = 'SidebarNav'

//MOBILE DRAWER

interface MobileDrawerProps {
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
  position?: 'left' | 'right'
  /** Width class */
  width?: string
  title?: string
  className?: string
}

export const MobileDrawer = memo<MobileDrawerProps>(({
  isOpen,
  onClose,
  children,
  position = 'left',
  width = 'w-72',
  title,
  className = '',
}) => {
  const { t } = useTranslation()
  const { prefersReduced, getSafeTransition } = useReducedMotion()
  const drawerRef = useFocusTrap<HTMLDivElement>({
    enabled: isOpen,
    onEscape: onClose,
  })
  
  if (!isOpen) return null
  
  return (
    <div className="fixed inset-0 z-50">
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black/50 ${prefersReduced ? '' : 'animate-fade-in'}`}
        aria-hidden="true"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Drawer'}
        className={`
          fixed top-0 bottom-0 ${width}
          bg-white dark:bg-gray-900
          shadow-xl overflow-y-auto
          ${position === 'left' ? 'left-0' : 'right-0'}
          ${prefersReduced ? '' : (position === 'left' ? 'animate-slide-in-right' : 'animate-slide-in-right')}
          ${className}
        `}
        style={{ transition: getSafeTransition('transform 300ms ease-out') }}
      >
        {/* Header with close button */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          {title && (
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {title}
            </h2>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-aegis-500"
            aria-label={'Close'}
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-4">
          {children}
        </div>
      </div>
    </div>
  )
})

MobileDrawer.displayName = 'MobileDrawer'

//ICONS

const MenuIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
  </svg>
)

const CloseIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
)

const ChevronRightIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
)

//EXPORTS

export default {
  Navbar,
  Breadcrumbs,
  SidebarNav,
  MobileDrawer,
}
