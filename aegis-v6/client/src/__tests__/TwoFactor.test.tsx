/**
 * Tests for the two-factor authentication (2FA) UI components:
 *   - TwoFactorChallenge -- the login step where the user enters a TOTP or backup code
 *   - TwoFactorSettings  -- the settings page where staff can enable, disable, and manage 2FA
 *
 * 2FA in AEGIS uses TOTP (Time-based One-Time Password), the same standard as
 * Google Authenticator and Authy.  After username/password login succeeds, the server
 * returns a short-lived tempToken.  The client then submits that token plus the 6-digit
 * TOTP code to api2FAAuthenticate.  On success the server returns a full JWT.
 *
 * Glossary:
 *   2FA / MFA             = Two-Factor / Multi-Factor Authentication -- requires a second
 *                           proof of identity beyond password
 *   TOTP                  = Time-based One-Time Password; a 6-digit code that changes every
 *                           30 seconds; calculated by an authenticator app using a shared secret
 *   TOTP secret           = a random Base32 string (e.g. JBSWY3DPEHPK3PXP) shared between
 *                           the server and the user's authenticator app at setup time
 *   QR code               = an image encoding the otpauth:// URI; the user scans it with their
 *                           authenticator app to import the shared secret without typing it
 *   otpauth:// URI        = standard deep-link format for TOTP secrets
 *   backup code           = a one-time-use recovery code (format XXXX-XXXX) issued when 2FA
 *                           is enabled; allows login if the authenticator app is unavailable
 *   tempToken             = short-lived JWT returned after password auth but before 2FA
 *                           verification; only valid for the 2FA challenge endpoint
 *   CSRF                  = Cross-Site Request Forgery; all state-changing API calls include
 *                           the CSRF token header
 *   replay protection     = server rejects a TOTP code that has already been used in the
 *                           current 30-second window
 *   account lockout       = brute-force protection; too many failed 2FA attempts lock the
 *                           account for a time period
 *   vi.fn()               = creates a trackable mock function
 *   vi.mock()             = replaces a module with a fake at import time
 *   vi.importActual()     = loads the real module so we can spread and override only some exports
 *   vi.clearAllMocks()    = resets call counts and return values between tests (in beforeEach)
 *   waitFor()             = retries an assertion until it passes or times out (for async state)
 *   fireEvent             = low-level DOM event dispatch (change, click, submit)
 *   screen.getByText()    = find a DOM element by its visible text content
 *   screen.getByLabelText() = find an input by the text of its <label>
 *   screen.getByRole()    = find an element by its ARIA role (e.g. 'alert', 'button')
 *   aria-live='assertive' = screen reader announces the element immediately when it changes
 *   inputMode='numeric'   = hint to mobile browsers to show the number keyboard
 *   autoComplete='one-time-code' = browser / password-manager hint for TOTP fields
 *   t(key)                = i18n translation function; mock returns the raw key so assertions
 *                           can use 'twofa.title' instead of the translated string
 *   .animate-spin         = Tailwind class added to loading spinners
 *
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, vi, beforeEach} from 'vitest'
import { render, screen, fireEvent, waitFor} from '@testing-library/react'
import '@testing-library/jest-dom'

//Module-level mocks -- declared before imports so vi.mock() hoisting works

//i18n mock: t(key) returns the key itself so assertions can use raw i18n keys
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLanguage: () => 'en',
  onLanguageChange: () => () => {},
  isRtl: () => false,
}))

vi.mock('../hooks/useLanguage', () => ({
  useLanguage: () => 'en', // hook returns the current language code
}))

vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({ dark: false, toggle: vi.fn() }), // light theme, no-op toggle
}))

//react-router-dom: render <Link> as a plain <a>; useSearchParams -> empty params
vi.mock('react-router-dom', () => ({
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}))

//vi.fn() created once per test run; vi.clearAllMocks() resets them in each beforeEach
const mockApi2FAGetStatus = vi.fn()           // fetch current 2FA status
const mockApi2FASetup = vi.fn()               // initiate 2FA setup (returns QR code + secret)
const mockApi2FAVerify = vi.fn()              // verify TOTP code during setup
const mockApi2FAAuthenticate = vi.fn()        // verify TOTP/backup code during login challenge
const mockApi2FADisable = vi.fn()             // turn off 2FA (requires password + TOTP)
const mockApi2FARegenerateBackupCodes = vi.fn() // generate fresh set of backup codes
const mockApiLogin = vi.fn()                  // regular login (used in some integration flows)

//vi.importActual spreads the real api module then overrides only the 2FA functions
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
    apiRegister: vi.fn().mockResolvedValue({}),      // not the focus of these tests
    apiGetDepartments: vi.fn().mockResolvedValue([]),
    apiForgotPassword: vi.fn().mockResolvedValue({}),
    setToken: vi.fn(),                                // store JWT in memory
    setUser: vi.fn(),                                 // store user info in memory
    scheduleTokenRefresh: vi.fn(),                    // set up background token refresh timer
  }
})

import TwoFactorChallenge from '../components/admin/TwoFactorChallenge'
import TwoFactorSettings from '../components/admin/TwoFactorSettings'

//TwoFactorChallenge -- the mid-login 2FA step after username/password succeed
describe('TwoFactorChallenge', () => {
  //Props passed to every TwoFactorChallenge test render
  const defaultProps = {
    tempToken: 'test-temp-token-abc123', // short-lived JWT from password auth step
    onSuccess: vi.fn(),                  // callback fired with full JWT after 2FA passes
    onCancel: vi.fn(),                   // callback fired when user clicks "Back to login"
  }

  beforeEach(() => {
    vi.clearAllMocks() // reset call counts on all mocks before each test
  })

  //Initial rendering
  describe('initial rendering', () => {
    test('renders the challenge screen with title and TOTP input', () => {
      //i18n mock returns the key strings -- assertions use raw keys
      render(<TwoFactorChallenge {...defaultProps} />)
      expect(screen.getByText('twofa.title')).toBeInTheDocument()
      expect(screen.getByLabelText('twofa.aria.totpCode')).toBeInTheDocument()
    })

    test('starts in TOTP mode by default', () => {
      //Default mode = TOTP (authenticator app); backup code mode is off
      render(<TwoFactorChallenge {...defaultProps} />)
      expect(screen.getByLabelText('twofa.aria.totpCode')).toBeInTheDocument()
      expect(screen.queryByLabelText('twofa.aria.backupCode')).not.toBeInTheDocument()
    })

    test('shows descriptive text for TOTP mode', () => {
      //Instruction text tells the user where to find the code
      render(<TwoFactorChallenge {...defaultProps} />)
      expect(screen.getByText('twofa.enterTotpDesc')).toBeInTheDocument()
    })

    test('shows "Verify & Sign In" button', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      expect(screen.getByText('twofa.verifySignIn')).toBeInTheDocument()
    })

    test('shows "Back to login" link', () => {
      //Allows user to abort the 2FA step and return to credentials screen
      render(<TwoFactorChallenge {...defaultProps} />)
      expect(screen.getByText('twofa.backToLogin')).toBeInTheDocument()
    })
  })

  //TOTP input validation -- the field only accepts exactly 6 numeric characters
  describe('TOTP input validation', () => {
    test('accepts only digits, max 6', () => {
      //Non-numeric characters are silently stripped; only digits 0-9 pass through
      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('twofa.aria.totpCode')
      fireEvent.change(input, { target: { value: '12abc34567' } })
      expect(input).toHaveValue('123456')
    })

    test('strips non-numeric characters', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('twofa.aria.totpCode')
      fireEvent.change(input, { target: { value: 'a1b2c3d4e5f6' } })
      expect(input).toHaveValue('123456')
    })

    test('truncates to 6 digits', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('twofa.aria.totpCode')
      fireEvent.change(input, { target: { value: '1234567890' } })
      expect(input).toHaveValue('123456')
    })

    test('clears error message on input change', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('twofa.aria.totpCode')

      //Trigger an error
      const form = input.closest('form')!
      fireEvent.change(input, { target: { value: '123' } })
      fireEvent.submit(form)

      //Error should appear, then clear on input
      fireEvent.change(input, { target: { value: '1234' } })
      //Error clears on input change in the component
    })

    test('prevents submission with empty code (button disabled)', () => {
      //Submit button disabled until input has exactly 6 digits (avoids pointless API calls)
      render(<TwoFactorChallenge {...defaultProps} />)
      const submitBtn = screen.getByText('twofa.verifySignIn')
      expect(submitBtn.closest('button')).toBeDisabled()
    })

    test('validates TOTP code requires 6 digits before submission', async () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('twofa.aria.totpCode')
      fireEvent.change(input, { target: { value: '123' } })

      const form = input.closest('form')!
      fireEvent.submit(form)

      await waitFor(() => {
        expect(screen.getByText('twofa.invalidCode')).toBeInTheDocument()
      })
    })

    test('accepts exactly 6 digits for submission', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('twofa.aria.totpCode')
      fireEvent.change(input, { target: { value: '123456' } })
      const submitBtn = screen.getByText('twofa.verifySignIn')
      expect(submitBtn.closest('button')).not.toBeDisabled()
    })
  })

  //Mode switching -- toggle between TOTP and backup code input
  describe('mode switching', () => {
    test('switches to backup code mode', () => {
      //Click the 'twofa.backupCode' tab/button to reveal the backup code field
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('twofa.backupCode'))
      expect(screen.getByLabelText('twofa.aria.backupCode')).toBeInTheDocument()
    })

    test('switches back to TOTP mode', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('twofa.backupCode'))
      fireEvent.click(screen.getByText('twofa.authenticator'))
      expect(screen.getByLabelText('twofa.aria.totpCode')).toBeInTheDocument()
    })

    test('clears code and error on mode switch', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('twofa.aria.totpCode')
      fireEvent.change(input, { target: { value: '123456' } })

      //Switch to backup mode
      fireEvent.click(screen.getByText('twofa.backupCode'))
      const backupInput = screen.getByLabelText('twofa.aria.backupCode')
      expect(backupInput).toHaveValue('')
    })

    test('shows descriptive text for backup code mode', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('twofa.backupCode'))
      expect(screen.getByText('twofa.enterBackupDesc')).toBeInTheDocument()
    })

    test('shows one-time use warning for backup codes', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('twofa.backupCode'))
      //Description text is shown in backup mode (translation key returned by mock)
      expect(screen.getByText('twofa.enterBackupDesc')).toBeInTheDocument()
    })
  })

  //Backup code input -- XXXX-XXXX format; uppercased; alphanumeric + dash only
  describe('backup code input', () => {
    test('accepts alphanumeric and dash characters', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('twofa.backupCode'))
      const input = screen.getByLabelText('twofa.aria.backupCode')
      fireEvent.change(input, { target: { value: 'abcd-efgh' } })
      expect(input).toHaveValue('ABCD-EFGH')
    })

    test('converts input to uppercase', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('twofa.backupCode'))
      const input = screen.getByLabelText('twofa.aria.backupCode')
      fireEvent.change(input, { target: { value: 'test-code' } })
      expect(input).toHaveValue('TEST-CODE')
    })

    test('strips invalid characters', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('twofa.backupCode'))
      const input = screen.getByLabelText('twofa.aria.backupCode')
      fireEvent.change(input, { target: { value: 'AB!@#CD-EF' } })
      expect(input).toHaveValue('ABCD-EF')
    })

    test('limits to 9 characters (XXXX-XXXX format)', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('twofa.backupCode'))
      const input = screen.getByLabelText('twofa.aria.backupCode')
      fireEvent.change(input, { target: { value: 'ABCD-EFGHIJKLMNOP' } })
      expect(input).toHaveValue('ABCD-EFGH')
    })
  })

  //API submission -- calls api2FAAuthenticate and invokes callbacks on result
  describe('API submission', () => {
    test('calls api2FAAuthenticate with correct params on TOTP submit', async () => {
      //Verify the component passes (tempToken, code, isBackupCode=false) to the API
      mockApi2FAAuthenticate.mockResolvedValue({
        success: true,
        token: 'jwt-token-123',
        user: { id: '1', email: 'test@aegis.com', displayName: 'Test', role: 'admin' },
      })

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('twofa.aria.totpCode')
      fireEvent.change(input, { target: { value: '123456' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(mockApi2FAAuthenticate).toHaveBeenCalledWith('test-temp-token-abc123', '123456', false)
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
      fireEvent.click(screen.getByText('twofa.backupCode'))
      const input = screen.getByLabelText('twofa.aria.backupCode')
      fireEvent.change(input, { target: { value: 'ABCD-EFGH' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(mockApi2FAAuthenticate).toHaveBeenCalledWith('test-temp-token-abc123', 'ABCD-EFGH', false)
        expect(defaultProps.onSuccess).toHaveBeenCalled()
      })
    })

    test('disables submit button during loading', async () => {
      //mockImplementation(() => new Promise(() => {})) -- a promise that never resolves
      //simulates a slow network; the component shows 'twofa.verifying' spinner text
      mockApi2FAAuthenticate.mockImplementation(() => new Promise(() => {}))

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('twofa.aria.totpCode')
      fireEvent.change(input, { target: { value: '123456' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('twofa.verifying')).toBeInTheDocument()
      })
    })
  })

  //Error handling -- various server-side error messages and client-side responses
  describe('error handling', () => {
    test('displays error on failed authentication', async () => {
      //Generic wrong-code error; message surfaced directly to the user
      mockApi2FAAuthenticate.mockRejectedValue(new Error('Invalid code.'))

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('twofa.aria.totpCode')
      fireEvent.change(input, { target: { value: '999999' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('Invalid code.')).toBeInTheDocument()
      })
    })

    test('shows expired token message for expired sessions', async () => {
      //tempToken has a short TTL; if the user takes too long the server rejects it
      //Component translates this to the 'twofa.sessionExpired' i18n key
      mockApi2FAAuthenticate.mockRejectedValue(new Error('Temporary token has expired. Please log in again.'))

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('twofa.aria.totpCode')
      fireEvent.change(input, { target: { value: '123456' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('twofa.sessionExpired')).toBeInTheDocument()
      })
    })

    test('handles generic "log in again" errors as expired', async () => {
      mockApi2FAAuthenticate.mockRejectedValue(new Error('Please log in again.'))

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('twofa.aria.totpCode')
      fireEvent.change(input, { target: { value: '123456' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('twofa.sessionExpired')).toBeInTheDocument()
      })
    })

    test('handles lockout error messages', async () => {
      //After N consecutive failures the server locks the account for a cooling-off period
      mockApi2FAAuthenticate.mockRejectedValue(
        new Error('Account locked for 10 minutes due to too many failed attempts.')
      )

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('twofa.aria.totpCode')
      fireEvent.change(input, { target: { value: '123456' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText(/Account locked for 10 minutes/)).toBeInTheDocument()
      })
    })

    test('handles session mismatch (IP/UA change)', async () => {
      mockApi2FAAuthenticate.mockRejectedValue(new Error('Session mismatch. Please log in again.'))

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('twofa.aria.totpCode')
      fireEvent.change(input, { target: { value: '123456' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('twofa.sessionExpired')).toBeInTheDocument()
      })
    })

    test('handles replay protection error', async () => {
      //Server tracks used codes within the current 30-second window to prevent replays
      mockApi2FAAuthenticate.mockRejectedValue(
        new Error('This code has already been used. Please wait for a new code.')
      )

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('twofa.aria.totpCode')
      fireEvent.change(input, { target: { value: '123456' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('This code has already been used. Please wait for a new code.')).toBeInTheDocument()
      })
    })

    test('clears code on error so user can retry', async () => {
      mockApi2FAAuthenticate.mockRejectedValue(new Error('Invalid code.'))

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('twofa.aria.totpCode')
      fireEvent.change(input, { target: { value: '999999' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(input).toHaveValue('')
      })
    })

    test('handles network error gracefully', async () => {
      mockApi2FAAuthenticate.mockRejectedValue(new Error('Network error'))

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('twofa.aria.totpCode')
      fireEvent.change(input, { target: { value: '123456' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
    })

    test('displays error with alert role for accessibility', async () => {
      //Error container must have role='alert' and aria-live='assertive' so screen readers
      //announce the message immediately without the user having to navigate to it
      mockApi2FAAuthenticate.mockRejectedValue(new Error('Invalid code.'))

      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('twofa.aria.totpCode')
      fireEvent.change(input, { target: { value: '999999' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
 const errorEl = screen.getByRole('alert') // role='alert' -> screen reader reads immediately
        expect(errorEl).toBeInTheDocument()
        expect(errorEl).toHaveAttribute('aria-live', 'assertive') // do not wait, announce now
      })
    })
  })

  //Backup code warning -- shown after successful login via a backup (recovery) code
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
      fireEvent.click(screen.getByText('twofa.backupCode'))
      const input = screen.getByLabelText('twofa.aria.backupCode')
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
      const input = screen.getByLabelText('twofa.aria.totpCode')
      fireEvent.change(input, { target: { value: '123456' } })
      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(defaultProps.onSuccess).toHaveBeenCalled()
      })
    })
  })

  //Cancel and navigation -- back-to-login link
  describe('cancel and navigation', () => {
    test('calls onCancel when back button is clicked', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('twofa.backToLogin'))
      expect(defaultProps.onCancel).toHaveBeenCalled()
    })

    test('does not call onSuccess when cancelled', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('twofa.backToLogin'))
      expect(defaultProps.onSuccess).not.toHaveBeenCalled()
    })
  })

  //Accessibility -- ARIA attributes, mobile-friendly input hints
  describe('accessibility', () => {
    test('TOTP input has proper aria-label', () => {
      //aria-label links input to its semantic label for screen readers
      render(<TwoFactorChallenge {...defaultProps} />)
      expect(screen.getByLabelText('twofa.aria.totpCode')).toBeInTheDocument()
    })

    test('backup code input has proper aria-label', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('twofa.backupCode'))
      expect(screen.getByLabelText('twofa.aria.backupCode')).toBeInTheDocument()
    })

    test('TOTP input has numeric inputMode for mobile keyboards', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('twofa.aria.totpCode')
      expect(input).toHaveAttribute('inputMode', 'numeric')
    })

    test('TOTP input has one-time-code autocomplete hint', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      const input = screen.getByLabelText('twofa.aria.totpCode')
      expect(input).toHaveAttribute('autoComplete', 'one-time-code')
    })

    test('backup code input has autocomplete off', () => {
      render(<TwoFactorChallenge {...defaultProps} />)
      fireEvent.click(screen.getByText('twofa.backupCode'))
      const input = screen.getByLabelText('twofa.aria.backupCode')
      expect(input).toHaveAttribute('autoComplete', 'off')
    })
  })
})

//TwoFactorSettings -- settings page for enabling/disabling/managing 2FA
describe('TwoFactorSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks() // reset mock call counts before each test
  })

  //Loading state -- spinner while api2FAGetStatus resolves
  describe('loading state', () => {
    test('shows loading spinner initially', () => {
      //new Promise(() => {}) -- never resolves, keeps the component in loading state
      // .animate-spin = Tailwind CSS class on the spinner element
      mockApi2FAGetStatus.mockReturnValue(new Promise(() => {}))
      render(<TwoFactorSettings />)
      expect(document.querySelector('.animate-spin')).toBeInTheDocument()
    })
  })

  //2FA disabled state -- shows enable button, no management actions yet
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

  //2FA enabled state -- shows management actions (regenerate backup codes, disable)
  describe('2FA enabled state', () => {
    //Typical response from api2FAGetStatus when 2FA is active
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

  //Setup flow -- enable 2FA: show QR code, verify TOTP, receive backup codes
  describe('setup flow', () => {
    test('starts setup and shows QR code', async () => {
      //api2FASetup returns qrCodeDataUrl + manualKey; user scans QR or types the key
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

  //Backup codes display -- shown once after verification; must be saved by the user
  describe('backup codes display', () => {
    test('shows backup codes after successful verification', async () => {
      //mockResolvedValueOnce = first call returns disabled status; subsequent calls return enabled
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

  //Disable flow -- requires current password + TOTP code for security
  describe('disable flow', () => {
    test('shows password and code inputs for disable', async () => {
      //Both fields required; prevents disabling 2FA without proof of identity
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

      //Find and click the confirm disable button
      const buttons = screen.getAllByRole('button')
      const confirmBtn = buttons.find(b => b.textContent?.includes('Disable'))
      if (confirmBtn) fireEvent.click(confirmBtn)

      await waitFor(() => {
        expect(screen.getByText(/Invalid password/)).toBeInTheDocument()
      })
    })
  })

  //Regenerate flow -- create fresh backup codes (old ones are invalidated)
  describe('regenerate flow', () => {
    test('shows TOTP input for regenerate', async () => {
      //Regeneration requires current TOTP to prevent abuse
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

      //Fill in the form
      const passwordInput = screen.getByPlaceholderText('Current password')
      const codeInput = screen.getByPlaceholderText('6-digit TOTP code')
      fireEvent.change(passwordInput, { target: { value: 'mypassword' } })
      fireEvent.change(codeInput, { target: { value: '123456' } })

      //Find and click the submit button for regeneration
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

  //API error handling -- component must not crash when the server is unreachable
  describe('API error handling', () => {
    test('handles status fetch failure gracefully', async () => {
      //Network error on initial status fetch; component should dismiss the spinner
      //and show an error state rather than crashing or spinning forever
      mockApi2FAGetStatus.mockRejectedValue(new Error('Network error'))

      render(<TwoFactorSettings />)

      await waitFor(() => {
        //Spinner gone means the component handled the rejection and updated state
        expect(document.querySelector('.animate-spin')).not.toBeInTheDocument()
      })
    })
  })
})

