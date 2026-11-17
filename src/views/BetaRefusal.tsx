import { Button } from '../components/ui'

export interface BetaRefusalProps {
  reason: 'refused' | 'unreadable'
  onSignOut: () => void
}

/**
 * The wall after a sign in that is not on the list. It offers only the way out,
 * and the shell signs the account out through the local-first path so a reload
 * cannot land back inside.
 */
export default function BetaRefusal({ reason, onSignOut }: BetaRefusalProps) {
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
        <Button variant="solid" onClick={onSignOut}>
          sign out
        </Button>
      </div>
    </section>
  )
}
