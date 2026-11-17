export const OAUTH_SCOPE = 'atproto transition:generic'
// Tokens are bound to the client identity. Both client types use one callback
// rather than deriving it from the route open at sign-in or restore.
export const OAUTH_REDIRECT_PATH = '/feed'

export function createOAuthClientMetadata(publicOrigin: string) {
  const url = new URL(publicOrigin)
  if (
    url.protocol !== 'https:' ||
    // the client id is the bare origin and every token is bound to it, so an
    // explicit port would silently become part of the deployment identity
    url.port !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error(
      'BENDAY_PUBLIC_ORIGIN must be an https origin with no port, path or credentials',
    )
  }

  const origin = url.origin
  return {
    client_id: `${origin}/oauth-client-metadata.json`,
    client_name: 'benday',
    client_uri: origin,
    redirect_uris: [`${origin}${OAUTH_REDIRECT_PATH}`],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: OAUTH_SCOPE,
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  }
}
