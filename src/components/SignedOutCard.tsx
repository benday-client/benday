import { FrameBody, FrameHead } from './ui'

export interface SignedOutCardProps {
  onSignIn: () => void
}

/** The anonymous shell: one native sign-in control and nothing readable behind it. */
export function SignedOutCard({ onSignIn }: SignedOutCardProps) {
  return (
    <button
      type="button"
      className="b-frame b-card-back b-signedout-card"
      aria-label="sign in to read benday"
      onClick={onSignIn}
    >
      <FrameHead as="span" className="b-card-back__head" label="signed out" />
      <FrameBody as="span" className="b-card-back__body">
        <span className="b-card-back__feed">sign in to read benday</span>
        <span className="b-card-back__rule" aria-hidden="true" />
        <span className="b-signedout-card__note">
          feeds, notifications, replies and the people you follow all need your own account
        </span>
        <span className="b-card-back__hint">sign in</span>
      </FrameBody>
    </button>
  )
}
