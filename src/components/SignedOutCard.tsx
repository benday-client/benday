export interface SignedOutCardProps {
  onSignIn: () => void
}

export function SignedOutCard({ onSignIn }: SignedOutCardProps) {
  return (
    <button
      type="button"
      className="b-frame b-card-back b-signedout-card"
      aria-label="sign in to personalize the feed"
      onClick={onSignIn}
    >
      <header className="b-frame__head b-card-back__head">
        <span className="b-frame__label mono-label">welcome</span>
      </header>
      <div className="b-frame__body b-card-back__body">
        <span className="b-card-back__index">[00]</span>
        <span className="b-card-back__feed">discover</span>
        <span className="b-card-back__rule" aria-hidden="true" />
        <span className="b-signedout-card__note">
          sign in to follow people, pin feeds and keep your own deck
        </span>
        <span className="b-card-back__hint">← sign in</span>
      </div>
    </button>
  )
}
