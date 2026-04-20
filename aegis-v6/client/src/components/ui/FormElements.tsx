/**
 * Form elements UI primitive (low-level UI building block).
 *
 * - Used by any form across the app
 * - Wired to InlineError from ErrorStates for validation messages
 */
import React, { forwardRef, memo, useState, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { InlineError } from './ErrorStates'

//FORM FIELD

interface FormFieldProps {
  /** Label text */
  label: string
  /** Field ID (auto-generated if not provided) */
  htmlFor?: string
  /** Error message */
  error?: string
  /** Helper/hint text */
  hint?: string
  /** Required indicator */
  required?: boolean
  /** Disabled state */
  disabled?: boolean
  /** Character count for textarea/input */
  characterCount?: { current: number; max: number }
  /** Additional CSS classes */
  className?: string
  /** Children (form control) */
  children: React.ReactNode
}

export const FormField = memo<FormFieldProps>(({
  label,
  htmlFor,
  error,
  hint,
  required = false,
  disabled = false,
  characterCount,
  className = '',
  children,
}) => {
  const generatedId = useId()
  const fieldId = htmlFor || generatedId
  const errorId = `${fieldId}-error`
  const hintId = `${fieldId}-hint`
  
  return (
    <div className={`${className}`}>
      <label
        htmlFor={fieldId}
        className={`
          block text-sm font-medium mb-1.5
          ${disabled ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}
        `}
      >
        {label}
        {required && (
          <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>
        )}
        {required && <span className="sr-only">(required)</span>}
      </label>
      
      {/* Inject aria props into child */}
      {React.Children.map(children, child => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
            id: fieldId,
            'aria-invalid': error ? 'true' : undefined,
            'aria-describedby': [
              error ? errorId : null,
              hint ? hintId : null,
            ].filter(Boolean).join(' ') || undefined,
            'aria-required': required || undefined,
            disabled: disabled || (child.props as Record<string, unknown>).disabled,
          })
        }
        return child
      })}
      
      {/* Hint */}
      {hint && !error && (
        <p
          id={hintId}
          className="mt-1.5 text-sm text-gray-500 dark:text-gray-400"
        >
          {hint}
        </p>
      )}
      
      {/* Error */}
      {error && (
        <InlineError message={error} fieldId={fieldId} className="mt-1.5" />
      )}
      
      {/* Character count */}
      {characterCount && (
        <CharacterCounter
          current={characterCount.current}
          max={characterCount.max}
          className="mt-1"
        />
      )}
    </div>
  )
})

FormField.displayName = 'FormField'

//INPUT

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Show error state (usually handled by FormField) */
  hasError?: boolean
  /** Left addon/icon */
  leftIcon?: React.ReactNode
  /** Right addon/icon */
  rightIcon?: React.ReactNode
  /** Full width */
  fullWidth?: boolean
}

const inputSizeClasses = {
  sm: 'px-2.5 py-1.5 text-sm',
  md: 'px-3 py-2 text-base',
  lg: 'px-4 py-2.5 text-lg',
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
  size = 'md',
  hasError = false,
  leftIcon,
  rightIcon,
  fullWidth = true,
  className = '',
  disabled,
  'aria-invalid': ariaInvalid,
  ...props
}, ref) => {
  const isInvalid = hasError || ariaInvalid === 'true'
  
  const inputClasses = `
    block rounded-lg border transition-colors appearance-none
    bg-white dark:bg-gray-800
    text-gray-900 dark:text-gray-100
    placeholder:text-gray-400 dark:placeholder:text-gray-500
    ${inputSizeClasses[size]}
    ${fullWidth ? 'w-full' : ''}
    ${leftIcon ? 'pl-10' : ''}
    ${rightIcon ? 'pr-10' : ''}
    ${isInvalid 
      ? 'border-red-500 focus:border-red-500 focus:ring-red-500' 
      : 'border-gray-300 dark:border-gray-600 focus:border-aegis-500 focus:ring-aegis-500'
    }
    ${disabled ? 'bg-gray-100 dark:bg-gray-700 cursor-not-allowed opacity-60' : ''}
    focus:outline-none focus:ring-2 focus:ring-opacity-50
    ${className}
  `
  
  if (leftIcon || rightIcon) {
    return (
      <div className={`relative ${fullWidth ? 'w-full' : 'inline-block'}`}>
        {leftIcon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none">
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          className={inputClasses}
          disabled={disabled}
          aria-invalid={isInvalid || undefined}
          {...props}
        />
        {rightIcon && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none">
            {rightIcon}
          </div>
        )}
      </div>
    )
  }
  
  return (
    <input
      ref={ref}
      className={inputClasses}
      disabled={disabled}
      aria-invalid={isInvalid || undefined}
      {...props}
    />
  )
})

Input.displayName = 'Input'

//TEXTAREA

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Show error state */
  hasError?: boolean
  /** Auto-resize based on content */
  autoResize?: boolean
  /** Full width */
  fullWidth?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({
  size = 'md',
  hasError = false,
  autoResize = false,
  fullWidth = true,
  className = '',
  disabled,
  'aria-invalid': ariaInvalid,
  onInput,
  ...props
}, ref) => {
  const isInvalid = hasError || ariaInvalid === 'true'
  
  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    if (autoResize) {
      const target = e.currentTarget
      target.style.height = 'auto'
      target.style.height = `${target.scrollHeight}px`
    }
    onInput?.(e)
  }
  
  return (
    <textarea
      ref={ref}
      className={`
        block rounded-lg border transition-colors resize-y
        bg-white dark:bg-gray-800
        text-gray-900 dark:text-gray-100
        placeholder:text-gray-400 dark:placeholder:text-gray-500
        ${inputSizeClasses[size]}
        ${fullWidth ? 'w-full' : ''}
        ${isInvalid 
          ? 'border-red-500 focus:border-red-500 focus:ring-red-500' 
          : 'border-gray-300 dark:border-gray-600 focus:border-aegis-500 focus:ring-aegis-500'
        }
        ${disabled ? 'bg-gray-100 dark:bg-gray-700 cursor-not-allowed opacity-60' : ''}
        ${autoResize ? 'resize-none overflow-hidden' : ''}
        focus:outline-none focus:ring-2 focus:ring-opacity-50
        ${className}
      `}
      disabled={disabled}
      aria-invalid={isInvalid || undefined}
      onInput={handleInput}
      {...props}
    />
  )
})

Textarea.displayName = 'Textarea'

//SELECT

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Show error state */
  hasError?: boolean
  /** Placeholder option */
  placeholder?: string
  /** Full width */
  fullWidth?: boolean
  /** Options */
  options: Array<{ value: string; label: string; disabled?: boolean }>
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({
  size = 'md',
  hasError = false,
  placeholder,
  fullWidth = true,
  options,
  className = '',
  disabled,
  'aria-invalid': ariaInvalid,
  ...props
}, ref) => {
  const isInvalid = hasError || ariaInvalid === 'true'
  
  return (
    <div className={`relative ${fullWidth ? 'w-full' : 'inline-block'}`}>
      <select
        ref={ref}
        className={`
          block rounded-lg border transition-colors appearance-none
          bg-white dark:bg-gray-800
          text-gray-900 dark:text-gray-100
          ${inputSizeClasses[size]}
          ${fullWidth ? 'w-full' : ''}
          pr-10
          ${isInvalid 
            ? 'border-red-500 focus:border-red-500 focus:ring-red-500' 
            : 'border-gray-300 dark:border-gray-600 focus:border-aegis-500 focus:ring-aegis-500'
          }
          ${disabled ? 'bg-gray-100 dark:bg-gray-700 cursor-not-allowed opacity-60' : ''}
          focus:outline-none focus:ring-2 focus:ring-opacity-50
          ${className}
        `}
        disabled={disabled}
        aria-invalid={isInvalid || undefined}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map(opt => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 dark:text-gray-500">
        <ChevronDownIcon className="h-4 w-4" />
      </div>
    </div>
  )
})

Select.displayName = 'Select'

//CHECKBOX

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Label text */
  label: string
  /** Description below label */
  description?: string
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Error state */
  hasError?: boolean
}

const checkboxSizeClasses = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(({
  label,
  description,
  size = 'md',
  hasError = false,
  className = '',
  disabled,
  id,
  ...props
}, ref) => {
  const generatedId = useId()
  const checkboxId = id || generatedId
  
  return (
    <div className={`flex items-start ${className}`}>
      <input
        ref={ref}
        type="checkbox"
        id={checkboxId}
        disabled={disabled}
        className={`
          ${checkboxSizeClasses[size]} mt-0.5 rounded border
          bg-white dark:bg-gray-800
          text-aegis-600 focus:ring-aegis-500 focus:ring-offset-0
          ${hasError 
            ? 'border-red-500' 
            : 'border-gray-300 dark:border-gray-600'
          }
          ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}
          transition-colors
        `}
        {...props}
      />
      <div className="ml-2">
        <label
          htmlFor={checkboxId}
          className={`
            text-sm font-medium
            ${disabled ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed' : 'text-gray-700 dark:text-gray-300 cursor-pointer'}
          `}
        >
          {label}
        </label>
        {description && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {description}
          </p>
        )}
      </div>
    </div>
  )
})

Checkbox.displayName = 'Checkbox'

//RADIO GROUP

interface RadioOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

interface RadioGroupProps {
  /** Group name */
  name: string
  /** Options */
  options: RadioOption[]
  /** Current value */
  value?: string
  /** Change handler */
  onChange?: (value: string) => void
  /** Layout direction */
  direction?: 'vertical' | 'horizontal'
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Disabled state */
  disabled?: boolean
  /** Error state */
  hasError?: boolean
  /** Additional CSS classes */
  className?: string
}

export const RadioGroup = memo<RadioGroupProps>(({
  name,
  options,
  value,
  onChange,
  direction = 'vertical',
  size = 'md',
  disabled = false,
  hasError = false,
  className = '',
}) => {
  return (
    <div
      role="radiogroup"
      className={`
        ${direction === 'horizontal' ? 'flex flex-wrap gap-4' : 'space-y-2'}
        ${className}
      `}
    >
      {options.map(option => (
        <div key={option.value} className="flex items-start">
          <input
            type="radio"
            id={`${name}-${option.value}`}
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={e => onChange?.(e.target.value)}
            disabled={disabled || option.disabled}
            className={`
              ${checkboxSizeClasses[size]} mt-0.5 border
              bg-white dark:bg-gray-800
              text-aegis-600 focus:ring-aegis-500 focus:ring-offset-0
              ${hasError 
                ? 'border-red-500' 
                : 'border-gray-300 dark:border-gray-600'
              }
              ${disabled || option.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}
              transition-colors
            `}
          />
          <div className="ml-2">
            <label
              htmlFor={`${name}-${option.value}`}
              className={`
                text-sm font-medium
                ${disabled || option.disabled 
                  ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed' 
                  : 'text-gray-700 dark:text-gray-300 cursor-pointer'
                }
              `}
            >
              {option.label}
            </label>
            {option.description && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {option.description}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
})

RadioGroup.displayName = 'RadioGroup'

//CHARACTER COUNTER

interface CharacterCounterProps {
  current: number
  max: number
  className?: string
}

export const CharacterCounter = memo<CharacterCounterProps>(({
  current,
  max,
  className = '',
}) => {
  const percentage = (current / max) * 100
  const isWarning = percentage >= 80 && percentage < 100
  const isError = percentage >= 100
  
  return (
    <div
      className={`text-xs text-right ${className}`}
      aria-live="polite"
      aria-atomic="true"
    >
      <span
        className={`
          ${isError ? 'text-red-600 dark:text-red-400 font-medium' : ''}
          ${isWarning ? 'text-amber-600 dark:text-amber-400' : ''}
          ${!isWarning && !isError ? 'text-gray-500 dark:text-gray-400' : ''}
        `}
      >
        {current}/{max}
      </span>
      {isError && <span className="sr-only"> - character limit exceeded</span>}
    </div>
  )
})

CharacterCounter.displayName = 'CharacterCounter'

//PASSWORD STRENGTH

interface PasswordStrengthProps {
  password: string
  className?: string
}

type StrengthLevel = 'weak' | 'fair' | 'good' | 'strong'

const calculateStrength = (password: string): { level: StrengthLevel; score: number } => {
  let score = 0
  
  if (password.length >= 8) score += 1
  if (password.length >= 12) score += 1
  if (/[a-z]/.test(password)) score += 1
  if (/[A-Z]/.test(password)) score += 1
  if (/[0-9]/.test(password)) score += 1
  if (/[^a-zA-Z0-9]/.test(password)) score += 1
  
  if (score <= 2) return { level: 'weak', score }
  if (score <= 3) return { level: 'fair', score }
  if (score <= 4) return { level: 'good', score }
  return { level: 'strong', score }
}

const strengthConfig: Record<StrengthLevel, { color: string; label: string; width: string }> = {
  weak: { color: 'bg-red-500', label: 'Weak', width: 'w-1/4' },
  fair: { color: 'bg-amber-500', label: 'Fair', width: 'w-2/4' },
  good: { color: 'bg-blue-500', label: 'Good', width: 'w-3/4' },
  strong: { color: 'bg-green-500', label: 'Strong', width: 'w-full' },
}

export const PasswordStrength = memo<PasswordStrengthProps>(({
  password,
  className = '',
}) => {
  const { t } = useTranslation()
  
  if (!password) return null
  
  const { level } = calculateStrength(password)
  const config = strengthConfig[level]
  
  return (
    <div className={`space-y-1 ${className}`} aria-live="polite">
      <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${config.color} ${config.width} transition-all duration-300`}
        />
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-400">
        {t('password.strength', 'Password strength')}: {' '}
        <span className={`font-medium ${level === 'weak' ? 'text-red-600' : ''} ${level === 'fair' ? 'text-amber-600' : ''} ${level === 'good' ? 'text-blue-600' : ''} ${level === 'strong' ? 'text-green-600' : ''}`}>
          {t(`password.${level}`, config.label)}
        </span>
      </p>
    </div>
  )
})

PasswordStrength.displayName = 'PasswordStrength'

//PASSWORD INPUT (with toggle)

interface PasswordInputProps extends Omit<InputProps, 'type' | 'rightIcon'> {
  /** Show strength indicator */
  showStrength?: boolean
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(({
  showStrength = false,
  value,
  ...props
}, ref) => {
  const [showPassword, setShowPassword] = useState(false)
  const { t } = useTranslation()
  
  return (
    <div>
      <Input
        ref={ref}
        type={showPassword ? 'text' : 'password'}
        value={value}
        rightIcon={
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors pointer-events-auto"
            aria-label={showPassword ? t('password.hide', 'Hide password') : t('password.show', 'Show password')}
          >
            {showPassword ? (
              <EyeOffIcon className="h-4 w-4" />
            ) : (
              <EyeIcon className="h-4 w-4" />
            )}
          </button>
        }
        {...props}
      />
      {showStrength && typeof value === 'string' && (
        <PasswordStrength password={value} className="mt-2" />
      )}
    </div>
  )
})

PasswordInput.displayName = 'PasswordInput'

//FIELDSET

interface FieldsetProps {
  /** Legend text */
  legend: string
  /** Description */
  description?: string
  /** Children */
  children: React.ReactNode
  /** Additional CSS classes */
  className?: string
}

export const Fieldset = memo<FieldsetProps>(({
  legend,
  description,
  children,
  className = '',
}) => {
  return (
    <fieldset className={`border-0 p-0 m-0 ${className}`}>
      <legend className="text-base font-medium text-gray-900 dark:text-gray-100 mb-1">
        {legend}
      </legend>
      {description && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          {description}
        </p>
      )}
      {children}
    </fieldset>
  )
})

Fieldset.displayName = 'Fieldset'

//ICONS

const ChevronDownIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
)

const EyeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
)

const EyeOffIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
  </svg>
)

//EXPORTS

export default {
  FormField,
  Input,
  Textarea,
  Select,
  Checkbox,
  RadioGroup,
  CharacterCounter,
  PasswordStrength,
  PasswordInput,
  Fieldset,
}
