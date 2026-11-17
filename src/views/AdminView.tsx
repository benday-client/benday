import { useEffect, useRef, useState } from 'react'
import { Button, FrameBody, FrameHead } from '../components/ui'
import { inviteDigest } from '../lib/betaAccess'
import { resolveHandleDid } from '../lib/identity'

export default function AdminView() {
  const [identifier, setIdentifier] = useState('')
  const [drafted, setDrafted] = useState<{ did: string; digest: string } | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)

  useEffect(
    () => () => {
      request.current += 1
    },
    [],
  )

  async function mint() {
    const owner = ++request.current
    setDrafted(null)
    setError(null)
    setPending(true)

    try {
      const did = await resolveHandleDid(identifier)
      const digest = await inviteDigest(did)
      if (owner !== request.current) return
      setDrafted({ did, digest })
    } catch (cause) {
      if (owner !== request.current) return
      setError(cause instanceof Error ? cause.message : 'could not mint that invitation')
    } finally {
      if (owner === request.current) setPending(false)
    }
  }

  return (
    <section className="b-view b-admin-view" aria-labelledby="b-admin-title">
      <header className="b-admin__head">
        <h1 className="b-admin__title" id="b-admin-title">
          invites
        </h1>
        <p className="b-admin__note mono-label">closed beta · one digest per account</p>
      </header>

      <p className="b-admin__body">
        resolve a handle or enter a DID, then add the quoted JSON entry to the <code>sha256</code>{' '}
        array in <code>public/beta/invites.json</code> and republish the site. minting here does not
        grant access. handles can move; only the resolved DID is invited.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void mint()
        }}
      >
        <label className="b-admin__label" htmlFor="b-admin-identifier">
          handle or DID
        </label>
        <input
          id="b-admin-identifier"
          className="b-admin__textarea"
          value={identifier}
          required
          spellCheck={false}
          onChange={(event) => {
            request.current += 1
            setIdentifier(event.target.value)
            setDrafted(null)
            setError(null)
            setPending(false)
          }}
        />
        <div className="b-admin__actions">
          <Button variant="solid" type="submit" disabled={pending || identifier.trim() === ''}>
            {pending ? 'minting…' : 'mint an invite'}
          </Button>
        </div>
      </form>
      {error === null ? null : <p role="alert">{error}</p>}

      {drafted === null ? null : (
        <article className="b-frame b-admin__card">
          <FrameHead label="new invite" />
          <FrameBody>
            <dl className="b-admin__fields">
              <dt>DID</dt>
              <dd>
                <code className="b-admin__line">{drafted.did}</code>
              </dd>
              <dt>SHA-256 digest</dt>
              <dd>
                <output aria-label="invitation digest">
                  <code className="b-admin__line">{drafted.digest}</code>
                </output>
              </dd>
              <dt>JSON entry</dt>
              <dd>
                <output aria-label="invitation JSON entry">
                  <code className="b-admin__line">{JSON.stringify(drafted.digest)}</code>
                </output>
              </dd>
            </dl>
          </FrameBody>
        </article>
      )}
      <p className="b-admin__note">
        this static page saves no credentials and changes no published list. to revoke access,
        delete the digest from the array and republish. hashes obscure the list, but anyone who
        knows a DID can check its hash; they are not secrets.
      </p>
    </section>
  )
}
