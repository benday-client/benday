import { useSettings } from '../lib/store'
import { THEME_EFFECTS } from '../lib/themes'
import type { Theme } from '../lib/types'
import { Tag } from './ui'

function PreviewSample({ theme, imageEffects }: { theme: Theme; imageEffects: boolean }) {
  const effect = imageEffects ? THEME_EFFECTS[theme] : 'none'
  return (
    <img
      className="dither-image b-theme-preview__image"
      data-effect={effect}
      src="/theme-preview.svg"
      alt="abstract theme sample"
      loading="eager"
      decoding="async"
    />
  )
}

function PreviewContent({
  theme,
  label,
  imageEffects,
}: {
  theme: Theme
  label: string
  imageEffects: boolean
}) {
  return (
    <>
      <div className="b-theme-preview__head">
        <span className="b-theme-preview__label mono-label">{label}</span>
        <span className="b-theme-preview__meta">@lexa.test · now</span>
      </div>
      <div className="b-theme-preview__body">
        <div className="b-theme-preview__main">
          <p className="b-theme-preview__text">this is how a post reads.</p>
          <div className="b-theme-preview__tags">
            <Tag>#design</Tag>
            <Tag>label</Tag>
          </div>
          <div className="b-theme-preview__actions">
            <span data-kind="comments">re 2</span>
            <span data-kind="like">like 7</span>
            <span data-kind="repost">rt 1</span>
            <span data-kind="quote">quote</span>
            <span className="b-theme-preview__link">accent link</span>
          </div>
          <div className="b-theme-preview__controls">
            <span className="b-button b-button--solid">post</span>
            <span className="b-button b-button--outline">outline</span>
            <span className="b-button b-button--ghost">ghost</span>
            <span className="b-theme-preview__input">search</span>
            <span className="b-kbd">g / G</span>
          </div>
        </div>
        <PreviewSample theme={theme} imageEffects={imageEffects} />
      </div>
    </>
  )
}

export function ThemePreview() {
  const appearance = useSettings((state) => state.appearance)
  const theme = useSettings((state) => state.theme)
  const lightTheme = useSettings((state) => state.lightTheme)
  const darkTheme = useSettings((state) => state.darkTheme)
  const imageEffects = useSettings((state) => state.imageEffects)

  if (appearance === 'system') {
    return (
      <div className="b-theme-preview b-theme-preview--split" aria-hidden="true">
        <div className="b-theme-preview__half" data-theme={lightTheme}>
          <PreviewContent theme={lightTheme} label="light" imageEffects={imageEffects} />
        </div>
        <div className="b-theme-preview__half" data-theme={darkTheme}>
          <PreviewContent theme={darkTheme} label="dark" imageEffects={imageEffects} />
        </div>
      </div>
    )
  }

  return (
    <div className="b-theme-preview" aria-hidden="true">
      <PreviewContent theme={theme} label="preview" imageEffects={imageEffects} />
    </div>
  )
}
