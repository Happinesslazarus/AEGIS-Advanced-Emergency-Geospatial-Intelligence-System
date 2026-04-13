/**
 * Module: form-elements.test.tsx
 *
 * Tests for the shared form UI components used throughout the AEGIS client:
 *   - FormField         — label + children wrapper with error / hint / required support
 *   - Input             — styled text input with icon slots and size variants
 *   - Textarea          — multi-line text input with optional auto-resize
 *   - Select            — dropdown powered by a static options array
 *   - Checkbox          — labelled checkbox with description and error state
 *   - CharacterCounter  — live "N/Max" character count display for text inputs
 *
 * Also includes an integration test verifying FormField + Input work together correctly.
 *
 * Glossary:
 *   describe()              = groups related tests under a labelled block
 *   test()                  = a single scenario with one expected outcome
 *   expect()                = assertion helper
 *   vi.fn()                 = creates a trackable mock function
 *   vi.mock()               = replaces a module with a lightweight fake
 *   render()                = mounts a React component into the jsdom (in-memory DOM)
 *   screen                  = query helpers that search the rendered DOM
 *   fireEvent               = low-level synthetic event dispatcher
 *   userEvent               = high-level realistic user-interaction simulator
 *   user.setup()            = creates a fresh userEvent instance for one test
 *   user.type()             = types characters one at a time (triggers onChange per char)
 *   user.click()            = simulates a realistic pointer click
 *   user.selectOptions()    = selects options inside a <select> element
 *   rerender()              = re-renders the component with new props
 *   container.firstChild    = the root DOM element returned by render()
 *   toHaveClass()           = asserts a DOM element has a specific CSS class
 *   toHaveAttribute()       = asserts a DOM element has a specific HTML attribute
 *   toBeDisabled()          = asserts a form control is disabled
 *   toBeChecked()           = asserts a checkbox or radio is in the checked state
 *   FormField               = wrapper component: renders a <label>, error message, hint text,
 *                             and passes disabled/required/aria props to its children
 *   required prop           = adds a visible "*" and a screen-reader "(required)" annotation
 *   error prop              = shows red error text; hides hint text; sets aria-invalid on child
 *   hint prop               = shows greyed helper text below the field (hidden when error present)
 *   disabled prop           = passes the disabled attribute down to child form controls
 *   aria-invalid            = ARIA attribute set to 'true' on invalid inputs; tells screen readers
 *   aria-required           = ARIA attribute telling screen readers the field is required
 *   Input                   = styled <input> component; size="sm|md|lg", leftIcon, rightIcon,
 *                             hasError, fullWidth
 *   leftIcon / rightIcon    = icon elements rendered inside the Input; add padding to the input
 *                             text so it doesn't overlap the icon (pl-10 / pr-10)
 *   Textarea                = styled <textarea>; autoResize prop switches resize-y → resize-none
 *   Select                  = styled <select>; receives options:[{value,label,disabled?}]
 *   combobox role           = ARIA role for a <select> element
 *   placeholder option      = an initial disabled <option> that shows default "Select..." text
 *   Checkbox                = labelled <input type="checkbox">; defaultChecked, disabled, hasError
 *   CharacterCounter        = <span> showing "current/max"; colour changes at 80% (amber) and
 *                             100%+ (red) to warn the user they are near or over the limit
 *   aria-live='polite'      = ARIA attribute on CharacterCounter so screen readers re-read the
 *                             count when it changes without interrupting the current utterance
 *   t: key => key           = react-i18next mock returning raw translation keys
 *
 * How it connects:
 * - Run by the test runner (Vitest) with `vitest run` or `vitest watch`
 */

import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event' // realistic user-interaction library
import '@testing-library/jest-dom'
import React from 'react'

import {
  FormField,
  Input,
  Textarea,
  Select,
  Checkbox,
  CharacterCounter,
} from '../components/ui/FormElements'

// react-i18next — return raw keys so assertions are language-independent
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

// ---------------------------------------------------------------------------
// FormField — label/error/hint wrapper
// ---------------------------------------------------------------------------
describe('FormField', () => {
  test('renders label and children', () => {
    render(
      <FormField label="Email">
        <input type="email" />
      </FormField>
    )
    // The label text and the child input must both be in the DOM
    expect(screen.getByText('Email')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  test('shows required indicator', () => {
    render(
      <FormField label="Username" required>
        <input type="text" />
      </FormField>
    )
    // Visible "*" for sighted users and screen-reader "(required)" for assistive tech
    expect(screen.getByText('*')).toBeInTheDocument()
    expect(screen.getByText('(required)')).toBeInTheDocument()
  })

  test('shows error message', () => {
    render(
      <FormField label="Password" error="Password is required">
        <input type="password" />
      </FormField>
    )
    // Error text must be visible below the field
    expect(screen.getByText('Password is required')).toBeInTheDocument()
  })

  test('shows hint text when no error', () => {
    render(
      <FormField label="Bio" hint="Tell us about yourself">
        <textarea />
      </FormField>
    )
    // Hint text is the helper/placeholder description shown when the field is valid
    expect(screen.getByText('Tell us about yourself')).toBeInTheDocument()
  })

  test('hides hint when error is present', () => {
    render(
      <FormField label="Bio" hint="Tell us about yourself" error="Required">
        <textarea />
      </FormField>
    )
    // Error takes visual priority over hint; both must not appear simultaneously
    expect(screen.queryByText('Tell us about yourself')).not.toBeInTheDocument()
    expect(screen.getByText('Required')).toBeInTheDocument()
  })

  test('disables child input when disabled', () => {
    render(
      <FormField label="Name" disabled>
        <input type="text" />
      </FormField>
    )
    // FormField passes the disabled prop down to its child element
    expect(screen.getByRole('textbox')).toBeDisabled()
  })

  test('sets aria-invalid on child when error', () => {
    render(
      <FormField label="Email" error="Invalid email">
        <input type="email" />
      </FormField>
    )
    // aria-invalid='true' tells screen readers the field has a validation error
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true')
  })

  test('applies custom className', () => {
    const { container } = render(
      <FormField label="Test" className="custom-class">
        <input />
      </FormField>
    )
    // className is applied to the outer wrapper, not the child input
    expect(container.firstChild).toHaveClass('custom-class')
  })
})

// ---------------------------------------------------------------------------
// Input — styled text input with icon slots and size variants
// ---------------------------------------------------------------------------
describe('Input', () => {
  test('renders basic input', () => {
    render(<Input placeholder="Enter text" />)
    expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument()
  })

  test('applies size classes', () => {
    const { rerender } = render(<Input size="sm" data-testid="input" />)
    expect(screen.getByTestId('input')).toHaveClass('text-sm') // small: compact

    rerender(<Input size="md" data-testid="input" />)
    expect(screen.getByTestId('input')).toHaveClass('text-base') // medium: default

    rerender(<Input size="lg" data-testid="input" />)
    expect(screen.getByTestId('input')).toHaveClass('text-lg') // large: prominent
  })

  test('shows error state', () => {
    render(<Input hasError data-testid="input" />)
    // Red border communicates an invalid field state to sighted users
    expect(screen.getByTestId('input')).toHaveClass('border-red-500')
  })

  test('renders with left icon', () => {
    render(
      <Input
        leftIcon={<span data-testid="left-icon">🔍</span>}
        placeholder="Search"
      />
    )
    expect(screen.getByTestId('left-icon')).toBeInTheDocument()
    // pl-10 = left padding 2.5rem so text starts after the icon, not behind it
    expect(screen.getByPlaceholderText('Search')).toHaveClass('pl-10')
  })

  test('renders with right icon', () => {
    render(
      <Input
        rightIcon={<span data-testid="right-icon">✓</span>}
        placeholder="Enter"
      />
    )
    expect(screen.getByTestId('right-icon')).toBeInTheDocument()
    // pr-10 = right padding 2.5rem so text doesn't overlap the right icon
    expect(screen.getByPlaceholderText('Enter')).toHaveClass('pr-10')
  })

  test('handles disabled state', () => {
    render(<Input disabled placeholder="Disabled" />)
    expect(screen.getByPlaceholderText('Disabled')).toBeDisabled()
  })

  test('passes through aria-invalid', () => {
    render(<Input aria-invalid="true" data-testid="input" />)
    // The attribute must be forwarded to the underlying <input> element
    expect(screen.getByTestId('input')).toHaveAttribute('aria-invalid', 'true')
  })

  test('handles onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn() // tracks how many times the change handler fires

    render(<Input onChange={onChange} placeholder="Type here" />)

    await user.type(screen.getByPlaceholderText('Type here'), 'hello')
    // user.type fires one change event per character → onChange called at least once
    expect(onChange).toHaveBeenCalled()
  })

  test('fullWidth prop controls width', () => {
    const { rerender } = render(<Input fullWidth data-testid="input" />)
    expect(screen.getByTestId('input')).toHaveClass('w-full') // fills container width

    rerender(<Input fullWidth={false} data-testid="input" />)
    expect(screen.getByTestId('input')).not.toHaveClass('w-full') // intrinsic width
  })
})

// ---------------------------------------------------------------------------
// Textarea — multi-line text input
// ---------------------------------------------------------------------------
describe('Textarea', () => {
  test('renders basic textarea', () => {
    render(<Textarea placeholder="Enter description" />)
    expect(screen.getByPlaceholderText('Enter description')).toBeInTheDocument()
  })

  test('has default resize-y class', () => {
    render(<Textarea data-testid="textarea" />)
    // resize-y = user can drag the bottom edge to change height (default behaviour)
    expect(screen.getByTestId('textarea')).toHaveClass('resize-y')
  })

  test('applies resize-none when autoResize is true', () => {
    render(<Textarea autoResize data-testid="textarea" />)
    // autoResize means JavaScript manages the height; the manual resize handle is removed
    expect(screen.getByTestId('textarea')).toHaveClass('resize-none')
  })

  test('shows error state', () => {
    render(<Textarea hasError data-testid="textarea" />)
    // Red border matches the same error styling as Input
    expect(screen.getByTestId('textarea')).toHaveClass('border-red-500')
  })

  test('handles disabled state', () => {
    render(<Textarea disabled placeholder="Disabled" />)
    expect(screen.getByPlaceholderText('Disabled')).toBeDisabled()
  })

  test('sets rows attribute', () => {
    render(<Textarea rows={5} data-testid="textarea" />)
    // rows=5 sets the visible height (5 text lines) for the initial render
    expect(screen.getByTestId('textarea')).toHaveAttribute('rows', '5')
  })
})

// ---------------------------------------------------------------------------
// Select — dropdown from a static options list
// ---------------------------------------------------------------------------
describe('Select', () => {
  const options = [
    { value: 'opt1', label: 'Option 1' },
    { value: 'opt2', label: 'Option 2' },
    { value: 'opt3', label: 'Option 3' },
  ]

  test('renders select with options', () => {
    render(<Select options={options} />)

    const select = screen.getByRole('combobox') // <select> has ARIA role 'combobox'
    expect(select).toBeInTheDocument()
    expect(screen.getByText('Option 1')).toBeInTheDocument()
    expect(screen.getByText('Option 2')).toBeInTheDocument()
  })

  test('shows placeholder option', () => {
    render(<Select options={options} placeholder="Select..." />)
    // Placeholder is an initial disabled option that prompts the user to choose
    expect(screen.getByText('Select...')).toBeInTheDocument()
  })

  test('applies size classes', () => {
    const { rerender } = render(<Select options={options} size="sm" data-testid="select" />)
    expect(screen.getByTestId('select')).toHaveClass('text-sm')

    rerender(<Select options={options} size="lg" data-testid="select" />)
    expect(screen.getByTestId('select')).toHaveClass('text-lg')
  })

  test('shows error state', () => {
    render(<Select options={options} hasError data-testid="select" />)
    expect(screen.getByTestId('select')).toHaveClass('border-red-500')
  })

  test('handles disabled state', () => {
    render(<Select options={options} disabled />)
    expect(screen.getByRole('combobox')).toBeDisabled()
  })

  test('handles disabled options', () => {
    const optionsWithDisabled = [
      { value: 'opt1', label: 'Option 1' },
      { value: 'opt2', label: 'Option 2', disabled: true }, // individual option disabled
    ]

    render(<Select options={optionsWithDisabled} />)

    const disabledOption = screen.getByText('Option 2').closest('option')
    expect(disabledOption).toBeDisabled() // .closest() finds the <option> element
  })

  test('handles onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<Select options={options} onChange={onChange} />)

    await user.selectOptions(screen.getByRole('combobox'), 'opt2') // pick by value

    expect(onChange).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Checkbox — labelled toggle with description and error state
// ---------------------------------------------------------------------------
describe('Checkbox', () => {
  test('renders checkbox with label', () => {
    render(<Checkbox label="Accept terms" />)
    expect(screen.getByText('Accept terms')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeInTheDocument()
  })

  test('renders with minimal label', () => {
    render(<Checkbox label="Toggle option" />)
    expect(screen.getByRole('checkbox')).toBeInTheDocument()
  })

  test('shows description', () => {
    render(<Checkbox label="Newsletter" description="Receive weekly updates" />)
    // description appears below the label — extra context for the user's decision
    expect(screen.getByText('Receive weekly updates')).toBeInTheDocument()
  })

  test('handles checked state', () => {
    render(<Checkbox label="Option" defaultChecked />)
    // defaultChecked = pre-ticked checkbox (uncontrolled); checked = controlled
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  test('handles disabled state', () => {
    render(<Checkbox label="Disabled" disabled />)
    expect(screen.getByRole('checkbox')).toBeDisabled()
  })

  test('shows error state', () => {
    render(<Checkbox label="Required" hasError />)
    // Red border on the checkbox communicates a validation error
    expect(screen.getByRole('checkbox')).toHaveClass('border-red-500')
  })

  test('handles onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<Checkbox label="Toggle" onChange={onChange} />)

    await user.click(screen.getByRole('checkbox'))

    expect(onChange).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// CharacterCounter — live "N/Max" counter with colour-coded warning levels
// ---------------------------------------------------------------------------
describe('CharacterCounter', () => {
  test('displays current and max count', () => {
    render(<CharacterCounter current={50} max={200} />)
    expect(screen.getByText('50/200')).toBeInTheDocument()
  })

  test('shows warning color when approaching limit (80%+)', () => {
    // 180/200 = 90% — within the warning threshold
    render(<CharacterCounter current={180} max={200} />)
    const span = screen.getByText('180/200')
    expect(span).toHaveClass('text-amber-600') // amber = "you're getting close"
  })

  test('shows error color when at limit (100%)', () => {
    // 200/200 = 100% — at the limit; user cannot type more characters
    render(<CharacterCounter current={200} max={200} />)
    const span = screen.getByText('200/200')
    expect(span).toHaveClass('text-red-600') // red = "you've hit the limit"
  })

  test('shows error color when over limit', () => {
    // 250/200 = 125% — over limit; submission should be blocked
    render(<CharacterCounter current={250} max={200} />)
    const span = screen.getByText('250/200')
    expect(span).toHaveClass('text-red-600')
  })

  test('normal gray color when well under limit', () => {
    // 10/200 = 5% — well within limit; neutral colour, no warning
    render(<CharacterCounter current={10} max={200} />)
    const span = screen.getByText('10/200')
    expect(span).toHaveClass('text-gray-500') // gray = neutral / no concern
  })

  test('applies custom className to container', () => {
    const { container } = render(
      <CharacterCounter current={50} max={200} className="custom-class" />
    )
    expect(container.firstChild).toHaveClass('custom-class')
  })

  test('has aria-live polite for accessibility', () => {
    // aria-live='polite' makes screen readers re-announce the count on each change
    // without interrupting current speech
    const { container } = render(<CharacterCounter current={50} max={200} />)
    expect(container.firstChild).toHaveAttribute('aria-live', 'polite')
  })
})

// ---------------------------------------------------------------------------
// Integration: FormField + Input working together
// ---------------------------------------------------------------------------
describe('FormField + Input integration', () => {
  test('full form field with input works correctly', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(e => e.preventDefault()) // prevent jsdom URL change

    render(
      <form onSubmit={onSubmit}>
        <FormField
          label="Username"
          required                      // adds "*" and sets aria-required on child
          error=""                       // empty string = no error currently shown
          hint="Choose a unique username"
        >
          <Input placeholder="Enter username" name="username" />
        </FormField>
        <button type="submit">Submit</button>
      </form>
    )

    const input = screen.getByPlaceholderText('Enter username')
    // FormField with required=true must propagate aria-required to the Input
    expect(input).toHaveAttribute('aria-required', 'true')

    await user.type(input, 'testuser')            // type a value
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(onSubmit).toHaveBeenCalled() // form was submitted successfully
  })

  test('form field with error state', () => {
    render(
      <FormField label="Email" error="Invalid email format">
        <Input type="email" />
      </FormField>
    )

    const input = screen.getByRole('textbox')
    // FormField detects error and sets aria-invalid on the child Input
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Invalid email format')).toBeInTheDocument()
  })
})

// FormField Tests

