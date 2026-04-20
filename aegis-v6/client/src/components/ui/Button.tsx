/**
 * Button UI primitive (low-level UI building block).
 *
 * - Uses Spinner from LoadingStates for the loading state
 * - Uses useReducedMotion for animation preferences
 */
import React, { forwardRef, memo } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { Spinner } from './LoadingStates'

// TYPES

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning' | 'link'
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant */
  variant?: ButtonVariant
  /** Size variant */
  size?: ButtonSize
  /** Loading state */
  isLoading?: boolean
  /** Loading text (replaces children while loading) */
  loadingText?: string
  /** Left icon */
  leftIcon?: React.ReactNode
  /** Right icon */
  rightIcon?: React.ReactNode
  /** Full width */
  fullWidth?: boolean
  /** Icon-only button (for accessibility) */
  iconOnly?: boolean
  /** As anchor element */
  as?: 'button' | 'a'
  /** Href (when as="a") */
  href?: string
}

// STYLES

const baseClasses = `
  inline-flex items-center justify-center font-medium
  rounded-lg transition-all duration-150
  focus:outline-none focus:ring-2 focus:ring-offset-2
  disabled:cursor-not-allowed disabled:opacity-60
  select-none
`

const variantClasses: Record<ButtonVariant, string> = {
  primary: `
    bg-aegis-600 text-white
    hover:bg-aegis-700 active:bg-aegis-800
    focus:ring-aegis-500
    dark:bg-aegis-500 dark:hover:bg-aegis-600
  `,
  secondary: `
    bg-white text-gray-700 border border-gray-300
    hover:bg-gray-50 active:bg-gray-100
    focus:ring-aegis-500
    dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600
    dark:hover:bg-gray-700 dark:active:bg-gray-600
  `,
  ghost: `
    bg-transparent text-gray-700
    hover:bg-gray-100 active:bg-gray-200
    focus:ring-aegis-500
    dark:text-gray-200 dark:hover:bg-gray-800 dark:active:bg-gray-700
  `,
  danger: `
    bg-red-600 text-white
    hover:bg-red-700 active:bg-red-800
    focus:ring-red-500
    dark:bg-red-500 dark:hover:bg-red-600
  `,
  success: `
    bg-green-600 text-white
    hover:bg-green-700 active:bg-green-800
    focus:ring-green-500
    dark:bg-green-500 dark:hover:bg-green-600
  `,
  warning: `
    bg-amber-500 text-white
    hover:bg-amber-600 active:bg-amber-700
    focus:ring-amber-500
    dark:bg-amber-400 dark:hover:bg-amber-500
  `,
  link: `
    bg-transparent text-aegis-600 underline-offset-2
    hover:underline hover:text-aegis-700
    focus:ring-aegis-500
    dark:text-aegis-400 dark:hover:text-aegis-300
  `,
}

const sizeClasses: Record<ButtonSize, { button: string; icon: string }> = {
  xs: {
    button: 'px-2 py-1 text-xs gap-1',
    icon: 'h-3 w-3',
  },
  sm: {
    button: 'px-3 py-1.5 text-sm gap-1.5',
    icon: 'h-4 w-4',
  },
  md: {
    button: 'px-4 py-2 text-sm gap-2',
    icon: 'h-4 w-4',
  },
  lg: {
    button: 'px-5 py-2.5 text-base gap-2',
    icon: 'h-5 w-5',
  },
  xl: {
    button: 'px-6 py-3 text-lg gap-2.5',
    icon: 'h-6 w-6',
  },
}

const iconOnlySizeClasses: Record<ButtonSize, string> = {
  xs: 'p-1',
  sm: 'p-1.5',
  md: 'p-2',
  lg: 'p-2.5',
  xl: 'p-3',
}

// BUTTON COMPONENT

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  loadingText,
  leftIcon,
  rightIcon,
  fullWidth = false,
  iconOnly = false,
  as = 'button',
  href,
  disabled,
  children,
  className = '',
  type = 'button',
  'aria-label': ariaLabel,
  ...props
}, ref) => {
  const { prefersReduced } = useReducedMotion()
  
  const isDisabled = disabled || isLoading
  const sizeConfig = sizeClasses[size]
  
  const buttonClasses = `
    ${baseClasses}
    ${variantClasses[variant]}
    ${iconOnly ? iconOnlySizeClasses[size] : sizeConfig.button}
    ${fullWidth ? 'w-full' : ''}
    ${prefersReduced ? '' : ''}
    ${className}
  `.trim()
  
  const content = (
    <>
      {/* Loading spinner */}
      {isLoading && (
        <Spinner
          size={size === 'xs' || size === 'sm' ? 'xs' : 'sm'}
          variant={variant === 'primary' || variant === 'danger' || variant === 'success' || variant === 'warning' ? 'white' : 'current'}
          label=""
        />
      )}
      
      {/* Left icon (hidden when loading) */}
      {!isLoading && leftIcon && (
        <span className={`flex-shrink-0 ${sizeConfig.icon}`} aria-hidden="true">
          {leftIcon}
        </span>
      )}
      
      {/* Text content */}
      {!iconOnly && (
        <span className={isLoading && !loadingText ? 'opacity-0' : ''}>
          {isLoading && loadingText ? loadingText : children}
        </span>
      )}
      
      {/* Right icon (hidden when loading) */}
      {!isLoading && rightIcon && (
        <span className={`flex-shrink-0 ${sizeConfig.icon}`} aria-hidden="true">
          {rightIcon}
        </span>
      )}
      
      {/* Icon only - render icon in center */}
      {iconOnly && !isLoading && leftIcon && (
        <span className={sizeConfig.icon} aria-hidden="true">
          {leftIcon}
        </span>
      )}
    </>
  )
  
  // Accessibility: icon-only buttons must have aria-label
  const computedAriaLabel = iconOnly && !ariaLabel 
    ? (typeof children === 'string' ? children : undefined)
    : ariaLabel
  
  if (as === 'a' && href) {
    return (
      <a
        href={href}
        className={buttonClasses}
        aria-label={computedAriaLabel}
        aria-disabled={isDisabled}
        {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {content}
      </a>
    )
  }
  
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-label={computedAriaLabel}
      aria-busy={isLoading}
      className={buttonClasses}
      {...props}
    >
      {content}
    </button>
  )
})

Button.displayName = 'Button'

// BUTTON GROUP

interface ButtonGroupProps {
  /** Attached buttons (connected borders) */
  attached?: boolean
  /** Orientation */
  orientation?: 'horizontal' | 'vertical'
  /** Size for all buttons */
  size?: ButtonSize
  /** Children (Button components) */
  children: React.ReactNode
  /** Additional CSS classes */
  className?: string
}

export const ButtonGroup = memo<ButtonGroupProps>(({
  attached = false,
  orientation = 'horizontal',
  size,
  children,
  className = '',
}) => {
  const containerClasses = `
    inline-flex
    ${orientation === 'vertical' ? 'flex-col' : 'flex-row'}
    ${attached ? '' : orientation === 'vertical' ? 'space-y-2' : 'space-x-2'}
    ${className}
  `
  
  if (!attached) {
    return (
      <div className={containerClasses} role="group">
        {React.Children.map(children, child => {
          if (React.isValidElement(child) && size) {
            return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, { size })
          }
          return child
        })}
      </div>
    )
  }
  
  // Attached styling
  const childCount = React.Children.count(children)
  
  return (
    <div className={containerClasses} role="group">
      {React.Children.map(children, (child, index) => {
        if (!React.isValidElement(child)) return child
        
        const isFirst = index === 0
        const isLast = index === childCount - 1
        
        let roundedClasses = ''
        if (orientation === 'horizontal') {
          roundedClasses = `
            ${isFirst ? 'rounded-r-none' : ''}
            ${isLast ? 'rounded-l-none' : ''}
            ${!isFirst && !isLast ? 'rounded-none' : ''}
            ${!isFirst ? '-ml-px' : ''}
          `
        } else {
          roundedClasses = `
            ${isFirst ? 'rounded-b-none' : ''}
            ${isLast ? 'rounded-t-none' : ''}
            ${!isFirst && !isLast ? 'rounded-none' : ''}
            ${!isFirst ? '-mt-px' : ''}
          `
        }
        
        return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
          className: `${(child.props as Record<string, unknown>).className || ''} ${roundedClasses}`,
          ...(size ? { size } : {}),
        })
      })}
    </div>
  )
})

ButtonGroup.displayName = 'ButtonGroup'

// ICON BUTTON (alias for iconOnly)

interface IconButtonProps extends Omit<ButtonProps, 'iconOnly' | 'leftIcon' | 'rightIcon' | 'children'> {
  /** Icon element */
  icon: React.ReactNode
  /** Required label for accessibility */
  'aria-label': string
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(({
  icon,
  ...props
}, ref) => {
  return (
    <Button
      ref={ref}
      iconOnly
      leftIcon={icon}
      {...props}
    />
  )
})

IconButton.displayName = 'IconButton'

// CLOSE BUTTON

interface CloseButtonProps extends Omit<ButtonProps, 'iconOnly' | 'leftIcon' | 'rightIcon' | 'children' | 'variant'> {
  /** Label for accessibility */
  label?: string
}

export const CloseButton = forwardRef<HTMLButtonElement, CloseButtonProps>(({
  label = 'Close',
  size = 'sm',
  ...props
}, ref) => {
  return (
    <IconButton
      ref={ref}
      icon={<CloseIcon />}
      aria-label={label}
      variant="ghost"
      size={size}
      {...props}
    />
  )
})

CloseButton.displayName = 'CloseButton'

// ICONS

const CloseIcon: React.FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
)

// EXPORTS

export default {
  Button,
  ButtonGroup,
  IconButton,
  CloseButton,
}
