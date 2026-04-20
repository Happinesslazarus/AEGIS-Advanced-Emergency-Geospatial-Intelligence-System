/**
 * Barrel export for every reusable UI primitive.
 * Consumed via `import { Button, Modal, ... } from '@/components/ui'`
 */

//LOADING STATES

export {
  Spinner,
  Skeleton,
  SkeletonText,
  SkeletonCard,
  SkeletonTable,
  ProgressBar,
  LoadingOverlay,
  SuspenseFallback,
  LoadingDots,
} from './LoadingStates'

//ERROR STATES

export {
  ErrorBoundary,
  ErrorDisplay,
  InlineError,
  EmptyState,
  OfflineIndicator,
  RetryWrapper,
  NotFound,
  AccessDenied,
} from './ErrorStates'

//TOAST

export {
  ToastProvider,
  useToast,
  toastAnimations,
} from './Toast'

export type {
  Toast,
  ToastVariant,
  ToastPosition,
  ToastOptions,
  ToastAction,
} from './Toast'

//FORM ELEMENTS

export {
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
} from './FormElements'

//BUTTON

export {
  Button,
  ButtonGroup,
  IconButton,
  CloseButton,
} from './Button'

//SKIP LINKS

export {
  SkipLinks,
  SkipLinkTarget,
  skipLinkStyles,
} from './SkipLinks'

export type { SkipLink } from './SkipLinks'

//MODAL

export {
  Modal,
  ModalBody,
  ModalFooter,
  ConfirmDialog,
  AlertDialog,
} from './Modal'

//NAVIGATION

export {
  Navbar,
  Breadcrumbs,
  SidebarNav,
  MobileDrawer,
} from './Navigation'

export type { NavItem } from './Navigation'
