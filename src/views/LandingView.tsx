import { Button } from '../components/ui'

export interface LandingViewProps {
  onSignIn: () => void
}

/**
 * The anonymous front door. It exists so a signed out visitor on `/` reads what
 * benday is instead of a sign-in card, and it opens the same dialog every other
 * gate opens rather than a second auth path.
 */
export default function LandingView({ onSignIn }: LandingViewProps) {
  return (
    <section className="b-landing" aria-labelledby="b-landing-headline">
      <p className="mono-label">closed beta</p>
      <h1 className="b-landing__headline" id="b-landing-headline">
        a card reader for your own bluesky
      </h1>
      <p className="b-landing__body">
        access is by invitation while it is polished, so an account has to be on the list before it
        can read. benday stays a client for your own account and nothing is written without your say
        so.
      </p>
      <div className="b-landing__action">
        <Button variant="solid" onClick={onSignIn}>
          log in with bluesky
        </Button>
      </div>
      <p className="b-landing__body">this is a social door not a security gate</p>
      <p className="b-landing__body">
        no invite yet? the door is the usual one,{' '}
        <a className="b-landing__link" href="https://bsky.app/profile/qex.at">
          ask @qex.at on bluesky
        </a>
        .
      </p>
    </section>
  )
}
