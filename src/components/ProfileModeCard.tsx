export type ProfileMode = 'posts' | 'replies' | 'media'

export interface ProfileModeOption {
  mode: ProfileMode
  name: string
  description: string
}

export const PROFILE_MODES: readonly ProfileModeOption[] = [
  {
    mode: 'posts',
    name: 'posts',
    description: 'standalone posts by this account',
  },
  {
    mode: 'replies',
    name: 'replies',
    description: 'replies this account has written',
  },
  {
    mode: 'media',
    name: 'media',
    description: 'posts with images or video',
  },
]

export function profileModeName(mode: ProfileMode): string {
  return PROFILE_MODES.find((option) => option.mode === mode)?.name ?? mode
}

export interface ProfileModeCardProps {
  option: ProfileModeOption
  active: boolean
  count: number
  onSelect: () => void
}

export function ProfileModeCard({ option, active, count, onSelect }: ProfileModeCardProps) {
  return (
    <button
      type="button"
      className="b-frame b-profile-mode-card"
      data-active={active ? 'true' : 'false'}
      aria-label={`show ${option.name}`}
      onClick={onSelect}
    >
      <header className="b-frame__head b-profile-mode-card__head">
        <span className="b-frame__label mono-label">mode</span>
        <span className="b-frame__meta">{active ? 'active' : 'enter'}</span>
      </header>
      <div className="b-frame__body b-profile-mode-card__body">
        <span className="b-profile-mode-card__title">{option.name}</span>
        <p className="b-profile-mode-card__description">{option.description}</p>
        <span className="b-profile-mode-card__count">
          {count} {count === 1 ? 'card' : 'cards'}
        </span>
        <span className="b-profile-mode-card__rule" aria-hidden="true" />
        <span className="b-profile-mode-card__hint">{active ? '← modes' : 'select mode'}</span>
      </div>
    </button>
  )
}

export interface ProfileModePeekProps {
  mode: ProfileMode
  count: number
  onOpen: () => void
}

export function ProfileModePeek({ mode, count, onOpen }: ProfileModePeekProps) {
  const name = profileModeName(mode)

  return (
    <button
      type="button"
      className="b-frame b-card-back b-profile-mode-peek"
      aria-label={`change mode, ${name}`}
      onClick={onOpen}
    >
      <header className="b-frame__head b-card-back__head">
        <span className="b-frame__label mono-label">modes</span>
        <span className="b-frame__meta">{name}</span>
      </header>
      <div className="b-frame__body b-card-back__body">
        <span className="b-card-back__index">[{String(Math.max(0, count)).padStart(2, '0')}]</span>
        <span className="b-card-back__feed">{name}</span>
        <span className="b-card-back__rule" aria-hidden="true" />
        <span className="b-card-back__appview">{count === 1 ? '1 card' : `${count} cards`}</span>
        <span className="b-card-back__hint">← modes</span>
      </div>
    </button>
  )
}

export interface ProfileModeBackProps {
  handle: string
  onClose: () => void
}

export function ProfileModeBack({ handle, onClose }: ProfileModeBackProps) {
  return (
    <button
      type="button"
      className="b-frame b-card-back b-profile-mode-peek"
      aria-label="back to profile"
      onClick={onClose}
    >
      <header className="b-frame__head b-card-back__head">
        <span className="b-frame__label mono-label">card back</span>
      </header>
      <div className="b-frame__body b-card-back__body">
        <span className="b-card-back__index">↩</span>
        <span className="b-card-back__feed">profile</span>
        <span className="b-card-back__rule" aria-hidden="true" />
        <span className="b-card-back__appview">@{handle}</span>
        <span className="b-card-back__hint">← profile</span>
      </div>
    </button>
  )
}
