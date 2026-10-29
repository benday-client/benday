import { Tag } from './ui'

export function ThemePreview() {
  return (
    <div className="b-theme-preview" aria-hidden="true">
      <div className="b-theme-preview__head">
        <span className="b-theme-preview__label mono-label">preview</span>
        <span className="b-theme-preview__meta">@lexa.test · now</span>
      </div>
      <p className="b-theme-preview__text">
        a theme is a whole surface. it carries the card the type and the controls.
      </p>
      <div className="b-theme-preview__tags">
        <Tag>#design</Tag>
        <Tag>label</Tag>
      </div>
      <div className="b-theme-preview__actions">
        <span>re 2</span>
        <span>like 7</span>
        <span>rt 1</span>
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
  )
}
