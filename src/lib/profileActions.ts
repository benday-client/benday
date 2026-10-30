import { getAuthAgent } from './auth'
import type { ProfileActivitySubscription } from './types'

export interface ProfileWriteResult {
  uri: string
  cid: string
}

const BLOCK_COLLECTION = 'app.bsky.graph.block'

function requireAgent() {
  const agent = getAuthAgent()
  if (agent === null) throw new Error('sign in to change this profile')
  return agent
}

function requireRepo(): string {
  const agent = requireAgent()
  const repo = agent.did
  if (repo === undefined) throw new Error('sign in to change this profile')
  return repo
}

export async function follow(did: string): Promise<ProfileWriteResult> {
  const result = await requireAgent().follow(did)
  return { uri: result.uri, cid: result.cid }
}

export async function unfollow(followUri: string): Promise<void> {
  await requireAgent().deleteFollow(followUri)
}

export async function mute(did: string): Promise<void> {
  await requireAgent().mute(did)
}

export async function unmute(did: string): Promise<void> {
  await requireAgent().unmute(did)
}

export async function hideReposts(did: string): Promise<void> {
  await requireAgent().mute(did, { onlyReposts: true })
}

export async function showReposts(did: string): Promise<void> {
  await requireAgent().unmute(did)
}

export async function block(did: string): Promise<ProfileWriteResult> {
  const agent = requireAgent()
  const repo = requireRepo()
  const response = await agent.com.atproto.repo.createRecord({
    repo,
    collection: BLOCK_COLLECTION,
    record: {
      $type: BLOCK_COLLECTION,
      subject: did,
      createdAt: new Date().toISOString(),
    },
  })
  return { uri: response.data.uri, cid: response.data.cid }
}

export async function unblock(blockUri: string): Promise<void> {
  const parts = blockUri.split('/')
  const [scheme, authority, repo, collection, rkey] = parts
  const ownDid = requireRepo()
  if (
    parts.length !== 5 ||
    scheme !== 'at:' ||
    authority !== '' ||
    repo !== ownDid ||
    collection !== BLOCK_COLLECTION ||
    rkey === undefined ||
    rkey.length === 0
  ) {
    throw new Error('invalid block record')
  }

  await requireAgent().com.atproto.repo.deleteRecord({
    repo: ownDid,
    collection: BLOCK_COLLECTION,
    rkey,
  })
}

export async function setActivitySubscription(
  did: string,
  subscription: ProfileActivitySubscription,
): Promise<ProfileActivitySubscription> {
  const response = await requireAgent().app.bsky.notification.putActivitySubscription({
    subject: did,
    activitySubscription: { post: subscription.post, reply: subscription.reply },
  })
  const result = response.data.activitySubscription
  return {
    post: result?.post ?? subscription.post,
    reply: result?.reply ?? subscription.reply,
  }
}
