import { FrameBody, FrameHead } from './ui'

export interface SignedOutCardProps {
  onSignIn: () => void
}

/** The leading peek of the anonymous feed deck: one native sign-in button. */
export function SignedOutCard({ onSignIn }: SignedOutCardProps) {
  return (
    <button
      type="button"
      className="b-frame b-card-back b-signedout-card"
      aria-label="sign in to personalize the feed"
      onClick={onSignIn}
    >
      <FrameHead as="span" className="b-card-back__head" label="welcome" />
      <FrameBody as="span" className="b-card-back__body">
        <span className="b-card-back__index">[00]</span>
        <span className="b-card-back__feed">discover</span>
        <span className="b-card-back__rule" aria-hidden="true" />
        <span className="b-signedout-card__note">
          sign in to follow people, pin feeds and keep your own deck
        </span>
        <span className="b-card-back__hint">← sign in</span>
      </FrameBody>
    </button>
  )
}
