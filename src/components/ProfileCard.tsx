import { profileWebUrl } from '../lib/postUrl'
import { formatAbsoluteTime } from '../lib/time'
import type { ProfileModel } from '../lib/types'
import { DitherImage } from './DitherImage'
import { Frame, Tag } from './ui'

export interface ProfileCardProps {
  profile: ProfileModel
}

export function ProfileCard({ profile }: ProfileCardProps) {
  const handle = profile.handle.length > 0 ? profile.handle : 'unknown'
  const displayName = profile.displayName.length > 0 ? profile.displayName : handle
  const initial = (displayName.length > 0 ? displayName : '?').slice(0, 1).toUpperCase()

  const counts = [
    { label: 'followers', value: profile.followersCount },
    { label: 'following', value: profile.followsCount },
    { label: 'posts', value: profile.postsCount },
  ] as const

  return (
    <Frame label="profile" meta={`@${handle}`} className="b-profile-card">
      <div className="b-profile__body">
        <div className="b-profile__banner">
          <DitherImage
            src={profile.banner}
            alt={`banner of @${handle}`}
            className="b-profile__banner-image"
            fallback="▚"
          />
        </div>

        <div className="b-profile__identity">
          <span className="b-profile__avatar">
            <DitherImage src={profile.avatar} alt={`avatar of @${handle}`} fallback={initial} />
          </span>
          <span className="b-profile__names">
            <span className="b-profile__name">{displayName}</span>
            <span className="b-profile__handle">@{handle}</span>
          </span>
        </div>

        {profile.description.length > 0 ? (
          <p className="b-profile__bio">{profile.description}</p>
        ) : null}

        <dl className="b-profile__counts">
          {counts.map((count) => (
            <div key={count.label} className="b-profile__count">
              <dt className="b-profile__count-label">{count.label}</dt>
              <dd className="b-profile__count-value">{count.value}</dd>
            </div>
          ))}
        </dl>

        {profile.createdAt !== null && profile.createdAt.length > 0 ? (
          <p className="b-profile__joined">joined {formatAbsoluteTime(profile.createdAt)}</p>
        ) : null}

        {profile.labels.length > 0 ? (
          <div className="b-profile__labels">
            {profile.labels.map((label) => (
              <Tag key={label} tone="warn" title={label}>
                {label}
              </Tag>
            ))}
          </div>
        ) : null}

        <a
          className="b-profile__external"
          href={profileWebUrl(handle)}
          target="_blank"
          rel="noreferrer noopener"
        >
          open profile ↗
        </a>
      </div>
    </Frame>
  )
}
