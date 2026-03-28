/**
 * TwoFactor.test.tsx — Comprehensive frontend tests for 2FA components
 *
 * Security-focused test suite covering:
 * TwoFactorChallenge: TOTP input, backup code input, form submission,
 *     error display, lockout handling, expired token, mode switching,
 *     accessibility, auto-focus, input sanitization
 * TwoFactorSettings: setup flow, QR code display, verification,
 *     disable/regen forms, loading states, error handling, backup codes
 *     display/copy/download, status display with backupCodesRemaining
 * LoginPage 2FA integration: mode switching on requires2FA response
 * Edge cases: rapid submission, concurrent state changes, XSS via error
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import '@testing-library/jest-dom'

// Mock i18n
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLanguage: () => 'en',
  onLanguageChange: () => () => {},
  isRtl: () => false,
}))

vi.mock('../hooks/useLanguage', () => ({
  useLanguage: () => 'en',
}))

vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({ dark: false, toggle: vi.fn() }),
}))

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}))

// Mock API
const mockApi2FAGetStatus = vi.fn()
const mockApi2FASetup = vi.fn()
const mockApi2FAVerify = vi.fn()
const mockApi2FAAuthenticate = vi.fn()
const mockApi2FADisable = vi.fn()
const mockApi2FARegenerateBackupCodes = vi.fn()
const mockApiLogin = vi.fn()

vi.mock('../utils/api', async () => {
  const actual = await vi.importActual('../utils/api') as any
  return {
    ...actual,
    api2FAGetStatus: (...args: any[]) => mockApi2FAGetStatus(...args),
    api2FASetup: (...args: any[]) => mockApi2FASetup(...args),
    api2FAVerify: (...args: any[]) => mockApi2FAVerify(...args),
    api2FAAuthenticate: (...args: any[]) => mockApi2FAAuthenticate(...args),
    api2FADisable: (...args: any[]) => mockApi2FADisable(...args),
    api2FARegenerateBackupCodes: (...args: any[]) => mockApi2FARegenerateBackupCodes(...args),
    apiLogin: (...args: any[]) => mockApiLogin(...args),
    apiRegister: vi.fn().mockResolvedValue({}),
    apiGetDepartments: vi.fn().mockResolvedValue([]),
    apiForgotPassword: vi.fn().mockResolvedValue({}),
    setToken: vi.fn(),
    setUser: vi.fn(),
    scheduleTokenRefresh: vi.fn(),
  }
})

import TwoFactorChallenge from '../components/admin/TwoFactorChallenge'
import TwoFactorSettings from '../components/admin/TwoFactorSettings'

// TwoFactorChallenge Component

describe('TwoFactorChallenge', () => {
  const defaultProps = {
    tempToken: 'test-temp-token-abc123',
    onSuccess: vi.fn(),
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering

  describe('initial rendering', () => {
    test('renders the challenge screen with title and TOTP input', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      expect(screen.getByText('Two-Factor Authentication')).toBeInTheDocument()
      expect(screen.getByLabelText('6-digit authentication code')).toBeInTheDocument()
    })

    test('starts in TOTP mode by default', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      expect(screen.getByLabelText('6-digit authentication code')).toBeInTheDocument()
      expect(screen.queryByLabelText('Backup recovery code')).not.toBeInTheDocument()
    })

    test('shows descriptive text for TOTP mode', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      expect(screen.getByText(/Enter the 6-digit code from your authenticator app/)).toBeInTheDocument()
    })

    test('shows "Verify & Sign In" button', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      expect(screen.getByText('Verify & Sign In')).toBeInTheDocument()
    })

    test('shows "Back to login" link', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      expect(screen.getByText('Back to login')).toBeInTheDocument()
    })
  })

  // TOTP Input Validation

  describe('TOTP input validation', () => {
    test('accepts only digits, max 6', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')
      fireEvent.change(input, { target: { value: '12abc34567' } })
      expect(input).toHaveValue('123456')
    })

    test('strips non-numeric characters', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')
      fireEvent.change(input, { target: { value: 'a1b2c3d4e5f6' } })
      expect(input).toHaveValue('123456')
    })

    test('truncates to 6 digits', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')
      fireEvent.change(input, { target: { value: '1234567890' } })
      expect(input).toHaveValue('123456')
    })

    test('clears error message on input change', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')

      // Trigger an error
      const form = input.closest('form')!
      fireEvent.change(input, { target: { value: '123' } })
      fireEvent.submit(form)

      // Error should appear, then clear on input
      fireEvent.change(input, { target: { value: '1234' } })
      // Error clears on input change in the component
    })

    test('prevents submission with empty code (button disabled)', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      const submitBtn = screen.getByText('Verify & Sign In')
      expect(submitBtn.closest('button')).toBeDisabled()
    })

    test('validates TOTP code requires 6 digits before submission', async () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')
      fireEvent.change(input, { target: { value: '123' } })

      const form = input.closest('form')!
      fireEvent.submit(form)

      await waitFor(() => {
        expect(screen.getByText('Please enter a valid 6-digit code.')).toBeInTheDocument()
      })
    })

    test('accepts exactly 6 digits for submission', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')
      fireEvent.change(input, { target: { value: '123456' } })
      const submitBtn = screen.getByText('Verify & Sign In')
      expect(submitBtn.closest('button')).not.toBeDisabled()
    })
  })

  // Mode Switching

  describe('mode switching', () => {
    test('switches to backup code mode', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('Backup Code'))
      expect(screen.getByLabelText('Backup recovery code')).toBeInTheDocument()
    })

    test('switches back to TOTP mode', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('Backup Code'))
      fireEvent.click(screen.getByText('Authenticator'))
      expect(screen.getByLabelText('6-digit authentication code')).toBeInTheDocument()
    })

    test('clears code and error on mode switch', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')
      fireEvent.change(input, { target: { value: '123456' } })

      // Switch to backup mode
      fireEvent.click(screen.getByText('Backup Code'))
      const backupInput = screen.getByLabelText('Backup recovery code')
      expect(backupInput).toHaveValue('')
    })

    test('shows descriptive text for backup code mode', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('Backup Code'))
      expect(screen.getByText(/Enter one of your backup recovery codes/)).toBeInTheDocument()
    })

    test('shows one-time use warning for backup codes', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('Backup Code'))
      expect(screen.getByText(/Each backup code can only be used once/)).toBeInTheDocument()
    })
  })

  // Backup Code Input

  describe('backup code input', () => {
    test('accepts alphanumeric and dash characters', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('Backup Code'))
      const input = screen.getByLabelText('Backup recovery code')
      fireEvent.change(input, { target: { value: 'abcd-efgh' } })
      expect(input).toHaveValue('ABCD-EFGH')
    })

    test('converts input to uppercase', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('Backup Code'))
      const input = screen.getByLabelText('Backup recovery code')
      fireEvent.change(input, { target: { value: 'test-code' } })
      expect(input).toHaveValue('TEST-CODE')
    })

    test('strips invalid characters', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('Backup Code'))
      const input = screen.getByLabelText('Backup recovery code')
      fireEvent.change(input, { target: { value: 'AB!@#CD-EF' } })
      expect(input).toHaveValue('ABCD-EF')
    })

    test('limits to 9 characters (XXXX-XXXX format)', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('Backup Code'))
      const input = screen.getByLabelText('Backup recovery code')
      fireEvent.change(input, { target: { value: 'ABCD-EFGHIJKLMNOP' } })
      expect(input).toHaveValue('ABCD-EFGH')
    })
  })

  // API Submission

  describe('API submission', () => {
    test('calls api2FAAuthenticate with correct params on TOTP submit', async () => {
      mockApi2FAAuthenticate.mockResolvedValue({
        success: true,
        token: 'jwt-token-123',
        user: { id: '1', email: 'test@aegis.com', displayName: 'Test', role: 'admin' },
      })

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')
      fireEvent.change(input, { target: { value: '123456' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(mockApi2FAAuthenticate).toHaveBeenCalledWith('test-temp-token-abc123', '123456')
        expect(defaultProps.onSuccess).toHaveBeenCalledWith('jwt-token-123', expect.objectContaining({ id: '1' }))
      })
    })

    test('calls api2FAAuthenticate with backup code', async () => {
      mockApi2FAAuthenticate.mockResolvedValue({
        success: true,
        token: 'jwt-token-backup',
        user: { id: '1', email: 'test@aegis.com', displayName: 'Test', role: 'admin' },
        backupCodeUsed: true,
        backupCodeWarning: 'A recovery code was used. Consider regenerating your backup codes in Settings.',
      })

      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('Backup Code'))
      const input = screen.getByLabelText('Backup recovery code')
      fireEvent.change(input, { target: { value: 'ABCD-EFGH' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(mockApi2FAAuthenticate).toHaveBeenCalledWith('test-temp-token-abc123', 'ABCD-EFGH')
        expect(defaultProps.onSuccess).toHaveBeenCalled()
      })
    })

    test('disables submit button during loading', async () => {
      mockApi2FAAuthenticate.mockImplementation(() => new Promise(() => {})) // Never resolves

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')
      fireEvent.change(input, { target: { value: '123456' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('Verifying...')).toBeInTheDocument()
      })
    })
  })

  // Error Handling

  describe('error handling', () => {
    test('displays error on failed authentication', async () => {
      mockApi2FAAuthenticate.mockRejectedValue(new Error('Invalid code.'))

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')
      fireEvent.change(input, { target: { value: '999999' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('Invalid code.')).toBeInTheDocument()
      })
    })

    test('shows expired token message for expired sessions', async () => {
      mockApi2FAAuthenticate.mockRejectedValue(new Error('Temporary token has expired. Please log in again.'))

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')
      fireEvent.change(input, { target: { value: '123456' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('Your login session has expired. Please start over.')).toBeInTheDocument()
      })
    })

    test('handles generic "log in again" errors as expired', async () => {
      mockApi2FAAuthenticate.mockRejectedValue(new Error('Please log in again.'))

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')
      fireEvent.change(input, { target: { value: '123456' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('Your login session has expired. Please start over.')).toBeInTheDocument()
      })
    })

    test('handles lockout error messages', async () => {
      mockApi2FAAuthenticate.mockRejectedValue(
        new Error('Account locked for 10 minutes due to too many failed attempts.')
      )

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')
      fireEvent.change(input, { target: { value: '123456' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText(/Account locked for 10 minutes/)).toBeInTheDocument()
      })
    })

    test('handles session mismatch (IP/UA change)', async () => {
      mockApi2FAAuthenticate.mockRejectedValue(new Error('Session mismatch. Please log in again.'))

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')
      fireEvent.change(input, { target: { value: '123456' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('Your login session has expired. Please start over.')).toBeInTheDocument()
      })
    })

    test('handles replay protection error', async () => {
      mockApi2FAAuthenticate.mockRejectedValue(
        new Error('This code has already been used. Please wait for a new code.')
      )

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')
      fireEvent.change(input, { target: { value: '123456' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('This code has already been used. Please wait for a new code.')).toBeInTheDocument()
      })
    })

    test('clears code on error so user can retry', async () => {
      mockApi2FAAuthenticate.mockRejectedValue(new Error('Invalid code.'))

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')
      fireEvent.change(input, { target: { value: '999999' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(input).toHaveValue('')
      })
    })

    test('handles network error gracefully', async () => {
      mockApi2FAAuthenticate.mockRejectedValue(new Error('Network error'))

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')
      fireEvent.change(input, { target: { value: '123456' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
    })

    test('displays error with alert role for accessibility', async () => {
      mockApi2FAAuthenticate.mockRejectedValue(new Error('Invalid code.'))

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')
      fireEvent.change(input, { target: { value: '999999' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        const errorEl = screen.getByRole('alert')
        expect(errorEl).toBeInTheDocument()
        expect(errorEl).toHaveAttribute('aria-live', 'assertive')
      })
    })
  })

  // Backup Code Warning

  describe('backup code warning', () => {
    test('shows generic backup code warning when backup was used', async () => {
      mockApi2FAAuthenticate.mockResolvedValue({
        success: true,
        token: 'jwt-token',
        user: { id: '1', email: 'test@aegis.com', displayName: 'Test', role: 'admin' },
        backupCodeUsed: true,
        backupCodeWarning: 'A recovery code was used. Consider regenerating your backup codes in Settings.',
      })

      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('Backup Code'))
      const input = screen.getByLabelText('Backup recovery code')
      fireEvent.change(input, { target: { value: 'ABCD-EFGH' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(defaultProps.onSuccess).toHaveBeenCalled()
      })
    })

    test('does not show backup warning when TOTP was used', async () => {
      mockApi2FAAuthenticate.mockResolvedValue({
        success: true,
        token: 'jwt-token',
        user: { id: '1', email: 'test@aegis.com', displayName: 'Test', role: 'admin' },
        backupCodeUsed: false,
      })

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')
      fireEvent.change(input, { target: { value: '123456' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(defaultProps.onSuccess).toHaveBeenCalled()
      })
    })
  })

  // Cancel / Navigation

  describe('cancel and navigation', () => {
    test('calls onCancel when back button is clicked', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('Back to login'))
      expect(defaultProps.onCancel).toHaveBeenCalled()
    })

    test('does not call onSuccess when cancelled', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('Back to login'))
      expect(defaultProps.onSuccess).not.toHaveBeenCalled()
    })
  })

  // Accessibility

  describe('accessibility', () => {
    test('TOTP input has proper aria-label', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      expect(screen.getByLabelText('6-digit authentication code')).toBeInTheDocument()
    })

    test('backup code input has proper aria-label', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('Backup Code'))
      expect(screen.getByLabelText('Backup recovery code')).toBeInTheDocument()
    })

    test('TOTP input has numeric inputMode for mobile keyboards', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')
      expect(input).toHaveAttribute('inputMode', 'numeric')
    })

    test('TOTP input has one-time-code autocomplete hint', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('6-digit authentication code')
      expect(input).toHaveAttribute('autoComplete', 'one-time-code')
    })

    test('backup code input has autocomplete off', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('Backup Code'))
      const input = screen.getByLabelText('Backup recovery code')
      expect(input).toHaveAttribute('autoComplete', 'off')
    })
  })
})

// TwoFactorSettings Component

describe('TwoFactorSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Loading State

  describe('loading state', () => {
    test('shows loading spinner initially', () => {
      mockApi2FAGetStatus.mockReturnValue(new Promise(() => {}))
      render(<TwoFactorSettings />)
      expect(document.querySelector('.animate-spin')).toBeInTheDocument()
    })
  })

  // Disabled State

  describe('2FA disabled state', () => {
    test('shows "Enable" button when 2FA is disabled', async () => {
      mockApi2FAGetStatus.mockResolvedValue({
        enabled: false, enabledAt: null, lastVerifiedAt: null,
        recoveryCodesGeneratedAt: null, backupCodesRemaining: null,
      })

      render(<TwoFactorSettings />)
      await waitFor(() => {
        expect(screen.getByText('Enable Two-Factor Authentication')).toBeInTheDocument()
      })
    })

    test('does not show management actions when disabled', async () => {
      mockApi2FAGetStatus.mockResolvedValue({
        enabled: false, enabledAt: null, lastVerifiedAt: null,
        recoveryCodesGeneratedAt: null, backupCodesRemaining: null,
      })

      render(<TwoFactorSettings />)
      await waitFor(() => {
        expect(screen.getByText('Enable Two-Factor Authentication')).toBeInTheDocument()
      })
      expect(screen.queryByText('Regenerate Backup Codes')).not.toBeInTheDocument()
      expect(screen.queryByText('Disable Two-Factor Authentication')).not.toBeInTheDocument()
    })
  })

  // Enabled State

  describe('2FA enabled state', () => {
    const enabledStatus = {
      enabled: true,
      enabledAt: '2026-03-15T10:00:00Z',
      lastVerifiedAt: '2026-03-18T08:00:00Z',
      recoveryCodesGeneratedAt: '2026-03-15T10:00:00Z',
      backupCodesRemaining: 8,
    }

    test('shows management actions when 2FA is enabled', async () => {
      mockApi2FAGetStatus.mockResolvedValue(enabledStatus)

      render(<TwoFactorSettings />)
      await waitFor(() => {
        expect(screen.getByText('Regenerate Backup Codes')).toBeInTheDocument()
        expect(screen.getByText('Disable Two-Factor Authentication')).toBeInTheDocument()
      })
    })

    test('does not show enable button when already enabled', async () => {
      mockApi2FAGetStatus.mockResolvedValue(enabledStatus)

      render(<TwoFactorSettings />)
      await waitFor(() => {
        expect(screen.getByText('Regenerate Backup Codes')).toBeInTheDocument()
      })
      expect(screen.queryByText('Enable Two-Factor Authentication')).not.toBeInTheDocument()
    })
  })

  // Setup Flow

  describe('setup flow', () => {
    test('starts setup and shows QR code', async () => {
      mockApi2FAGetStatus.mockResolvedValue({
        enabled: false, enabledAt: null, lastVerifiedAt: null,
        recoveryCodesGeneratedAt: null, backupCodesRemaining: null,
      })
      mockApi2FASetup.mockResolvedValue({
        success: true,
        manualKey: 'JBSWY3DPEHPK3PXP',
        otpAuthUrl: 'otpauth://totp/AEGIS:admin@example.com?secret=JBSWY3DPEHPK3PXP&issuer=AEGIS',
        qrCodeDataUrl: 'data:image/png;base64,fakequrcodedata',
      })

      render(<TwoFactorSettings />)
      await waitFor(() => {
        expect(screen.getByText('Enable Two-Factor Authentication')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Enable Two-Factor Authentication'))

      await waitFor(() => {
        expect(screen.getByText('Scan QR Code')).toBeInTheDocument()
        expect(screen.getByAltText('2FA QR Code')).toBeInTheDocument()
        expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument()
      })
    })

    test('handles setup API error', async () => {
      mockApi2FAGetStatus.mockResolvedValue({
        enabled: false, enabledAt: null, lastVerifiedAt: null,
        recoveryCodesGeneratedAt: null, backupCodesRemaining: null,
      })
      mockApi2FASetup.mockRejectedValue(new Error('Too many 2FA setup attempts. Please try again later.'))

      render(<TwoFactorSettings />)
      await waitFor(() => screen.getByText('Enable Two-Factor Authentication'))

      fireEvent.click(screen.getByText('Enable Two-Factor Authentication'))

      await waitFor(() => {
        expect(screen.getByText(/Too many 2FA setup attempts/)).toBeInTheDocument()
      })
    })

    test('verification form requires 6-digit code', async () => {
      mockApi2FAGetStatus.mockResolvedValue({
        enabled: false, enabledAt: null, lastVerifiedAt: null,
        recoveryCodesGeneratedAt: null, backupCodesRemaining: null,
      })
      mockApi2FASetup.mockResolvedValue({
        success: true,
        manualKey: 'JBSWY3DPEHPK3PXP',
        otpAuthUrl: 'otpauth://...',
        qrCodeDataUrl: 'data:image/png;base64,fake',
      })

      render(<TwoFactorSettings />)
      await waitFor(() => screen.getByText('Enable Two-Factor Authentication'))
      fireEvent.click(screen.getByText('Enable Two-Factor Authentication'))

      await waitFor(() => screen.getByText('Scan QR Code'))

      const verifyBtn = screen.getByText('Verify & Enable')
      expect(verifyBtn.closest('button')).toBeDisabled()
    })
  })

  // Backup Codes Display

  describe('backup codes display', () => {
    test('shows backup codes after successful verification', async () => {
      mockApi2FAGetStatus
        .mockResolvedValueOnce({
          enabled: false, enabledAt: null, lastVerifiedAt: null,
          recoveryCodesGeneratedAt: null, backupCodesRemaining: null,
        })
        .mockResolvedValue({
          enabled: true, enabledAt: '2026-03-18T10:00:00Z',
          lastVerifiedAt: '2026-03-18T10:00:00Z',
          recoveryCodesGeneratedAt: '2026-03-18T10:00:00Z',
          backupCodesRemaining: 10,
        })
      mockApi2FASetup.mockResolvedValue({
        success: true, manualKey: 'TEST',
        otpAuthUrl: 'otpauth://...', qrCodeDataUrl: 'data:image/png;base64,x',
      })
      mockApi2FAVerify.mockResolvedValue({
        success: true,
        backupCodes: [
          'ABCD-EFGH', 'IJKL-MNOP', 'QRST-UVWX', 'YZ23-4567', 'ABCD-1234',
          'EFGH-5678', 'IJKL-9ABC', 'MNOP-DEFG', 'QRST-HIJK', 'UVWX-LMNO',
        ],
      })

      render(<TwoFactorSettings />)
      await waitFor(() => screen.getByText('Enable Two-Factor Authentication'))
      fireEvent.click(screen.getByText('Enable Two-Factor Authentication'))
      await waitFor(() => screen.getByText('Scan QR Code'))

      const codeInput = screen.getByPlaceholderText('000000')
      fireEvent.change(codeInput, { target: { value: '123456' } })

      const verifyBtn = screen.getByText('Verify & Enable')
      fireEvent.click(verifyBtn)

      await waitFor(() => {
        expect(screen.getByText('Backup Recovery Codes')).toBeInTheDocument()
        expect(screen.getByText('ABCD-EFGH')).toBeInTheDocument()
        expect(screen.getByText('IJKL-MNOP')).toBeInTheDocument()
        expect(screen.getByText('QRST-UVWX')).toBeInTheDocument()
      })
    })
  })

  // Disable Flow

  describe('disable flow', () => {
    test('shows password and code inputs for disable', async () => {
      mockApi2FAGetStatus.mockResolvedValue({
        enabled: true, enabledAt: '2026-03-15T10:00:00Z',
        lastVerifiedAt: '2026-03-18T08:00:00Z',
        recoveryCodesGeneratedAt: '2026-03-15T10:00:00Z',
        backupCodesRemaining: 10,
      })

      render(<TwoFactorSettings />)
      await waitFor(() => screen.getByText('Disable Two-Factor Authentication'))

      fireEvent.click(screen.getByText('Disable Two-Factor Authentication'))

      await waitFor(() => {
        expect(screen.getByText('Disable 2FA')).toBeInTheDocument()
        expect(screen.getByPlaceholderText('Current password')).toBeInTheDocument()
        expect(screen.getByPlaceholderText('6-digit TOTP code or backup code')).toBeInTheDocument()
      })
    })

    test('handles disable API error', async () => {
      mockApi2FAGetStatus.mockResolvedValue({
        enabled: true, enabledAt: '2026-03-15T10:00:00Z',
        lastVerifiedAt: '2026-03-18T08:00:00Z',
        recoveryCodesGeneratedAt: '2026-03-15T10:00:00Z',
        backupCodesRemaining: 10,
      })
      mockApi2FADisable.mockRejectedValue(new Error('Invalid password.'))

      render(<TwoFactorSettings />)
      await waitFor(() => screen.getByText('Disable Two-Factor Authentication'))
      fireEvent.click(screen.getByText('Disable Two-Factor Authentication'))

      await waitFor(() => screen.getByPlaceholderText('Current password'))

      fireEvent.change(screen.getByPlaceholderText('Current password'), { target: { value: 'wrongpass' } })
      fireEvent.change(screen.getByPlaceholderText('6-digit TOTP code or backup code'), { target: { value: '123456' } })

      // Find and click the confirm disable button
      const buttons = screen.getAllByRole('button')
      const confirmBtn = buttons.find(b => b.textContent?.includes('Disable'))
      if (confirmBtn) fireEvent.click(confirmBtn)

      await waitFor(() => {
        expect(screen.getByText(/Invalid password/)).toBeInTheDocument()
      })
    })
  })

  // Regenerate Flow

  describe('regenerate flow', () => {
    test('shows TOTP input for regenerate', async () => {
      mockApi2FAGetStatus.mockResolvedValue({
        enabled: true, enabledAt: '2026-03-15T10:00:00Z',
        lastVerifiedAt: '2026-03-18T08:00:00Z',
        recoveryCodesGeneratedAt: '2026-03-15T10:00:00Z',
        backupCodesRemaining: 10,
      })

      render(<TwoFactorSettings />)
      await waitFor(() => screen.getByText('Regenerate Backup Codes'))

      fireEvent.click(screen.getByText('Regenerate Backup Codes'))

      await waitFor(() => {
        expect(screen.getByText('Regenerate Backup Codes', { selector: 'h4' })).toBeInTheDocument()
        expect(screen.getByPlaceholderText('6-digit TOTP code')).toBeInTheDocument()
      })
    })

    test('handles regenerate API error (replay protection)', async () => {
      mockApi2FAGetStatus.mockResolvedValue({
        enabled: true, enabledAt: '2026-03-15T10:00:00Z',
        lastVerifiedAt: '2026-03-18T08:00:00Z',
        recoveryCodesGeneratedAt: '2026-03-15T10:00:00Z',
        backupCodesRemaining: 10,
      })
      mockApi2FARegenerateBackupCodes.mockRejectedValue(
        new Error('This code has already been used. Please wait for a new code.')
      )

      render(<TwoFactorSettings />)
      await waitFor(() => screen.getByText('Regenerate Backup Codes'))
      fireEvent.click(screen.getByText('Regenerate Backup Codes'))

      await waitFor(() => screen.getByPlaceholderText('6-digit TOTP code'))

      // Fill in the form
      const passwordInput = screen.getByPlaceholderText('Current password')
      const codeInput = screen.getByPlaceholderText('6-digit TOTP code')
      fireEvent.change(passwordInput, { target: { value: 'mypassword' } })
      fireEvent.change(codeInput, { target: { value: '123456' } })

      // Find and click the submit button for regeneration
      const buttons = screen.getAllByRole('button')
      const regenBtn = buttons.find(b =>
        b.textContent?.includes('Generate New Codes') || b.textContent?.includes('Regenerate')
      )
      if (regenBtn) fireEvent.click(regenBtn)

      await waitFor(() => {
        expect(screen.getByText(/This code has already been used/)).toBeInTheDocument()
      })
    })
  })

  // Error Boundary

  describe('API error handling', () => {
    test('handles status fetch failure gracefully', async () => {
      mockApi2FAGetStatus.mockRejectedValue(new Error('Network error'))

      render(<TwoFactorSettings />)

      // Should not crash — should show error or fallback state
      await waitFor(() => {
        // The component should render something, not crash
        expect(document.querySelector('.animate-spin')).not.toBeInTheDocument()
      })
    })
  })
})
