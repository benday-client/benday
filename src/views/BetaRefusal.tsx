import { Button } from '../components/ui'

export interface BetaRefusalProps {
  reason: 'refused' | 'unreadable'
  onReturn: () => void
}

/**
 * The shell has already signed the account out after a refused sign in or an
 * unreadable list. Return to the anonymous landing page without signing out again.
 */
export default function BetaRefusal({ reason, onReturn }: BetaRefusalProps) {
  return (
    <section className="b-refusal" aria-labelledby="b-refusal-headline">
      <p className="mono-label">closed beta</p>
      <h1 className="b-refusal__headline" id="b-refusal-headline">
        {reason === 'unreadable' ? 'the beta list could not be read' : 'this beta is invite only'}
      </h1>
      <p className="b-refusal__body">
        {reason === 'unreadable'
          ? 'benday could not read its own invitation list, so it will not let anyone in.'
          : 'your account is not on the invitation list and has been signed out.'}
      </p>
      <div className="b-refusal__action">
        <Button variant="solid" onClick={onReturn}>
          back to benday
        </Button>
      </div>
    </section>
  )
}
