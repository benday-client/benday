import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { useSettings } from '../lib/store'
import type { Theme } from '../lib/types'
import { resolveSrgbColor, type SrgbColor } from '../test/colors'
import { postFixture } from '../test/fixtures'
import { createTestQueryClient } from '../test/queryClient'
import { renderStage } from '../test/stage'
import { Deck } from './Deck'
import { DitherDefs } from './DitherDefs'
import { FeedCard } from './FeedCard'
import { InlineComposer } from './InlineComposer'
import { PostCard } from './PostCard'
import { RefreshCard } from './RefreshCard'
import { SettingsDialog } from './SettingsDialog'
import { ThemePreview } from './ThemePreview'
import {
  Button,
  CardBack,
  CardBackButton,
  cardBackIndex,
  Dialog,
  ErrorNotice,
  Frame,
  Kbd,
  ModeCard,
  Tag,
  TextInput,
} from './ui'

function halfTheme(light: string, dark: string): HTMLElement[] {
  useSettings.setState({
    appearance: 'system',
    lightTheme: light as Theme,
    darkTheme: dark as Theme,
  })
  const { container } = render(<ThemePreview />)
  const halves = [...container.querySelectorAll<HTMLElement>('.b-theme-preview__half')]
  expect(halves).toHaveLength(2)
  return halves
}

function splitContainer(): HTMLElement {
  const split = document.querySelector<HTMLElement>('.b-theme-preview--split')
  if (split === null) throw new Error('no split preview')
  return split
}

/**
 * The colour a readable role resolves to in the current theme scope. The raw
 * custom property may itself be a `var()` alias, so a probe element is the only
 * way to read the value the cascade actually computes.
 */
function painted(input: string): SrgbColor {
  return resolveSrgbColor(input)
}

/** The `rgb()` serialization a computed gradient contains for one colour. */
function cssRgb(color: string): string {
  const { r, g, b } = resolveSrgbColor(color)
  return `rgb(${r}, ${g}, ${b})`
}

function roleColor(property: '--text-muted' | '--text-link'): SrgbColor {
  const probe = document.createElement('span')
  probe.style.color = `var(${property})`
  document.documentElement.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return resolveSrgbColor(color)
}

/**
 * A theme without decoration composes a transparent zero shadow so a themed
 * list stays valid; `none` is the older, equally invisible spelling.
 */
function expectNoShadow(value: string): void {
  expect(['none', 'rgba(0, 0, 0, 0) 0px 0px 0px 0px']).toContain(value)
}

interface Signature {
  headImage: string
  headRule: string
  headRuleWidth: string
  edge: string
  radius: string
  lift: string
  inset: string
  glow: string
  faceSize: string
}

/**
 * Renders one real frame under a root theme and snapshots the computed values
 * that carry the theme's non-colour mark. Snapshots are taken immediately,
 * because the next call changes the root theme for everything already mounted.
 */
function frameSignature(theme: Theme): Signature {
  document.documentElement.dataset['theme'] = theme
  const { container } = render(
    <Frame label="signature" meta="now">
      <p>body</p>
    </Frame>,
  )
  const frame = container.querySelector<HTMLElement>('.b-frame')
  const head = container.querySelector<HTMLElement>('.b-frame__head')
  const body = container.querySelector<HTMLElement>('.b-frame__body')
  const label = container.querySelector<HTMLElement>('.b-frame__label')
  if (frame === null || head === null || body === null || label === null) {
    throw new Error(`frame did not render for ${theme}`)
  }

  const frameStyle = getComputedStyle(frame)
  const headStyle = getComputedStyle(head)
  return {
    headImage: headStyle.backgroundImage,
    headRule: headStyle.borderBottomStyle,
    headRuleWidth: headStyle.borderBottomWidth,
    edge: frameStyle.borderTopStyle,
    radius: frameStyle.borderRadius,
    lift: frameStyle.boxShadow,
    inset: getComputedStyle(body).boxShadow,
    glow: getComputedStyle(label).textShadow,
    faceSize: frameStyle.backgroundSize,
  }
}

interface PostSignature {
  authorImage: string
  authorRule: string
  authorRuleWidth: string
  frameTop: string
  frameTopStyle: string
  frameShadow: string
  glow: string
  radius: string
  height: number
}

/**
 * Renders the real PostCard in the app stage under a root theme and snapshots
 * the properties a reader can actually see. A post card has no frame head, so
 * this is the surface the theme signature has to reach.
 */
function postSignature(theme: Theme): PostSignature {
  document.documentElement.dataset['theme'] = theme
  const { container } = renderStage(
    <QueryClientProvider client={createTestQueryClient()}>
      <Router hook={memoryLocation({ path: '/' }).hook}>
        <PostCard post={postFixture()} index={1} />
      </Router>
    </QueryClientProvider>,
  )
  const card = container.querySelector<HTMLElement>('.b-post-card')
  const author = container.querySelector<HTMLElement>('.b-post-card__author')
  const name = container.querySelector<HTMLElement>('.b-post-card__name')
  if (card === null || author === null || name === null) {
    throw new Error(`post card did not render for ${theme}`)
  }

  const cardStyle = getComputedStyle(card)
  const authorStyle = getComputedStyle(author)
  return {
    authorImage: authorStyle.backgroundImage,
    authorRule: authorStyle.borderBottomStyle,
    authorRuleWidth: authorStyle.borderBottomWidth,
    frameTop: cardStyle.borderTopWidth,
    frameTopStyle: cardStyle.borderTopStyle,
    frameShadow: cardStyle.boxShadow,
    glow: getComputedStyle(name).textShadow,
    radius: cardStyle.borderRadius,
    height: author.getBoundingClientRect().height,
  }
}

describe('canonical upstream palettes', () => {
  interface Canonical {
    theme: Theme
    name: string
    base: string
    text: string
    panel: string
    raised: string
    line: string
    blue: string
    radius: string
    /** the readable link role is ink on these light themes, raw blue elsewhere */
    linkInk?: boolean
  }

  /**
   * Upstream values, not benday wording: Catppuccin's palette JSON
   * (base/mantle/surface/text/subtext/overlay, blue) and Dracula's published
   * palette plus its UI variants. `--void`/`--paper` map to the base pane,
   * `--panel` to the chrome pane (mantle / BGDark), `--panel-raised` to the
   * raised trim (surface0 / BGLight) and `--line` to surface1 / Selection.
   */
  const canonical: readonly Canonical[] = [
    {
      theme: 'catppuccin-mocha',
      name: 'catppuccin mocha',
      base: '#1e1e2e',
      text: '#cdd6f4',
      panel: '#181825',
      raised: '#313244',
      line: '#45475a',
      blue: '#89b4fa',
      radius: '4px',
    },
    {
      theme: 'catppuccin-latte',
      name: 'catppuccin latte',
      base: '#eff1f5',
      text: '#4c4f69',
      panel: '#e6e9ef',
      raised: '#ccd0da',
      line: '#bcc0cc',
      blue: '#1e66f5',
      radius: '4px',
      linkInk: true,
    },
    {
      theme: 'dracula',
      name: 'dracula',
      base: '#282a36',
      text: '#f8f8f2',
      panel: '#21222c',
      raised: '#343746',
      line: '#44475a',
      blue: '#bd93f9',
      radius: '0px',
    },
  ]

  function rgb(hex: string): SrgbColor {
    return resolveSrgbColor(hex)
  }

  interface Rendered {
    root: SrgbColor
    frame: SrgbColor
    body: SrgbColor
    label: SrgbColor
    meta: SrgbColor
    head: SrgbColor
    tag: SrgbColor
    border: SrgbColor
    link: SrgbColor
    radius: string
    face: string
    faceSize: string
  }

  /**
   * Renders real chrome and reads the resolved colours. The tag uses --panel,
   * the frame uses --paper, the head uses --panel-raised and the anchor uses
   * --blue, so every role is observed on the element that consumes it.
   */
  function rendered(theme: Theme): Rendered {
    document.documentElement.dataset['theme'] = theme
    const { container } = renderStage(
      <Frame label="canonical" meta="now">
        <p className="b-post-card__text">
          body text <a href="#canonical">accent link</a>
        </p>
        <span className="b-tag b-tag--default">tag</span>
      </Frame>,
    )
    const app = container.querySelector<HTMLElement>('.b-app')
    const frame = container.querySelector<HTMLElement>('.b-frame')
    const body = container.querySelector<HTMLElement>('.b-post-card__text')
    const label = container.querySelector<HTMLElement>('.b-frame__label')
    const meta = container.querySelector<HTMLElement>('.b-frame__meta')
    const head = container.querySelector<HTMLElement>('.b-frame__head')
    const link = container.querySelector<HTMLElement>('a')
    const tag = container.querySelector<HTMLElement>('.b-tag')
    if (
      app === null ||
      frame === null ||
      body === null ||
      label === null ||
      meta === null ||
      head === null ||
      link === null ||
      tag === null
    ) {
      throw new Error(`canonical chrome did not render for ${theme}`)
    }

    const frameStyle = getComputedStyle(frame)
    return {
      root: resolveSrgbColor(getComputedStyle(app).backgroundColor),
      frame: resolveSrgbColor(frameStyle.backgroundColor),
      body: resolveSrgbColor(getComputedStyle(body).color),
      label: resolveSrgbColor(getComputedStyle(label).color),
      meta: resolveSrgbColor(getComputedStyle(meta).color),
      head: resolveSrgbColor(getComputedStyle(head).backgroundColor),
      tag: resolveSrgbColor(getComputedStyle(tag).backgroundColor),
      border: resolveSrgbColor(frameStyle.borderTopColor),
      link: resolveSrgbColor(getComputedStyle(link).color),
      radius: frameStyle.borderRadius,
      face: frameStyle.backgroundImage,
      faceSize: frameStyle.backgroundSize,
    }
  }

  for (const expected of canonical) {
    it(`resolves ${expected.name} to its upstream palette`, () => {
      const actual = rendered(expected.theme)

      // page field and card surface are the upstream base pane
      expect(actual.root).toEqual(rgb(expected.base))
      expect(actual.frame).toEqual(rgb(expected.base))
      // body copy is the upstream text colour; the label and meta are the
      // readable muted role, which is the dim ramp on these themes
      expect(actual.body).toEqual(rgb(expected.text))
      expect(actual.label).toEqual(roleColor('--text-muted'))
      expect(actual.meta).toEqual(roleColor('--text-muted'))
      // chrome and raised trim are the palette's secondary panes / surface0
      expect(actual.head).toEqual(rgb(expected.raised))
      expect(actual.tag).toEqual(rgb(expected.panel))
      expect(actual.border).toEqual(rgb(expected.line))
      // the anchor consumes the readable link role: ink on latte, raw blue here
      expect(actual.link).toEqual(roleColor('--text-link'))
      expect(actual.link).toEqual(rgb(expected.linkInk === true ? expected.text : expected.blue))
      // catppuccin keeps soft corners, dracula stays square
      expect(actual.radius).toBe(expected.radius)
    })
  }

  it('draws the dracula bracket in the corrected purple', () => {
    const dracula = rendered('dracula')
    expect(dracula.face).toContain(cssRgb('#bd93f9'))
    expect(dracula.faceSize.startsWith('12px 1px')).toBe(true)
  })
})

describe('the split theme preview', () => {
  it('lets each half own its own surface while the container stays neutral', async () => {
    document.documentElement.dataset['theme'] = 'cyberpunk'
    await page.viewport(1280, 800)
    const halves = halfTheme('bone', 'cyberpunk')
    const split = splitContainer()

    const splitStyle = getComputedStyle(split)
    expect(splitStyle.clipPath).toBe('none')
    expect(splitStyle.borderRadius).toBe('0px')
    expect(splitStyle.backgroundImage).toBe('none')
    expect(getComputedStyle(split, '::before').content).toBe('none')

    const bone = halves[0]
    const cyber = halves[1]
    expect(bone).toBeDefined()
    expect(cyber).toBeDefined()
    if (bone === undefined || cyber === undefined) return

    // the cyberpunk half carries the hud and the octagonal clip
    expect(getComputedStyle(cyber).clipPath.startsWith('polygon(')).toBe(true)
    expect(getComputedStyle(cyber, '::before').content).not.toBe('none')
    // the bone half keeps a plain rectangle and the baseline tracking
    expect(getComputedStyle(bone).clipPath).toBe('none')
    expect(getComputedStyle(bone).borderRadius).toBe('0px')
    const cyberLabel = cyber.querySelector('.mono-label')
    const boneLabel = bone.querySelector('.mono-label')
    expect(cyberLabel).not.toBeNull()
    expect(boneLabel).not.toBeNull()
    const cyberSpacing = Number.parseFloat(getComputedStyle(cyberLabel as Element).letterSpacing)
    const boneSpacing = Number.parseFloat(getComputedStyle(boneLabel as Element).letterSpacing)
    // the HUD's tracked caps are ~1.76px at this size; the baseline is tighter
    expect(cyberSpacing).toBeGreaterThan(1.5)
    expect(boneSpacing).toBeLessThan(cyberSpacing)
  })

  it('keeps the cyberpunk hud on whichever half is cyberpunk', async () => {
    document.documentElement.dataset['theme'] = 'cyberpunk'
    const halves = halfTheme('cyberpunk', 'bone')
    const cyber = halves[0]
    const bone = halves[1]
    expect(cyber).toBeDefined()
    expect(bone).toBeDefined()
    if (cyber === undefined || bone === undefined) return

    expect(getComputedStyle(cyber, '::before').content).not.toBe('none')
    expect(getComputedStyle(bone, '::before').content).toBe('none')
    expect(getComputedStyle(cyber).clipPath.startsWith('polygon(')).toBe(true)
    expect(getComputedStyle(bone).clipPath).toBe('none')
  })

  it('keeps a seasonal flourish inside the seasonal half only', async () => {
    document.documentElement.dataset['theme'] = 'pumpkin-ember'
    const halves = halfTheme('bone', 'pumpkin-ember')
    const bone = halves[0]
    const pumpkin = halves[1]
    expect(bone).toBeDefined()
    expect(pumpkin).toBeDefined()
    if (bone === undefined || pumpkin === undefined) return

    const boneTag = bone.querySelector('.b-tag')
    const pumpkinTag = pumpkin.querySelector('.b-tag')
    expect(boneTag).not.toBeNull()
    expect(pumpkinTag).not.toBeNull()
    expect(getComputedStyle(boneTag as Element).borderTopStyle).toBe('solid')
    expect(getComputedStyle(pumpkinTag as Element).borderTopStyle).toBe('dashed')

    // rounded root, but the split container stays square while the seasonal half rounds
    expect(getComputedStyle(splitContainer()).borderRadius).toBe('0px')
    expect(getComputedStyle(bone).borderRadius).toBe('0px')
    expect(getComputedStyle(pumpkin).borderRadius).toBe('2px')
  })

  it('stacks the halves on a narrow viewport without overflowing', async () => {
    document.documentElement.dataset['theme'] = 'cyberpunk'
    await page.viewport(390, 844)
    const halves = halfTheme('bone', 'dead-leaves')
    const split = splitContainer()
    const [first, second] = halves
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    if (first === undefined || second === undefined) return

    const firstRect = first.getBoundingClientRect()
    const secondRect = second.getBoundingClientRect()
    expect(secondRect.top).toBeGreaterThanOrEqual(firstRect.bottom - 1)
    expect(split.getBoundingClientRect().width).toBeLessThanOrEqual(window.innerWidth)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  })

  it('gives the head a different mark per theme family', () => {
    const bone = frameSignature('bone')
    const voidFrame = frameSignature('void')
    const github = frameSignature('github-light')
    const oxide = frameSignature('oxide')

    // the base theme keeps a hatch but sharpens its pitch and its rule
    expect(bone.headImage).toContain('repeating-linear-gradient')
    expect(voidFrame.headImage).toContain('repeating-linear-gradient')
    expect(voidFrame.headImage).not.toBe(bone.headImage)

    // github's head is flat: no hatch and no rule at all
    expect(github.headImage).toBe('none')
    expect(github.headRule).toBe('none')

    // oxide trades the hatch for a rust double rule
    expect(oxide.headImage).toBe('none')
    expect(oxide.headRule).toBe('double')
    expect(oxide.headRuleWidth).toBe('3px')
  })

  it('differs on the card edge, body inset, label glow and lift', () => {
    const cottage = frameSignature('cottagecore')
    const atom = frameSignature('atom')
    const phosphor = frameSignature('phosphor')
    const bone = frameSignature('bone')
    const plain = frameSignature('bluesky')

    // a stitched edge, not just a different palette
    expect(plain.edge).toBe('solid')
    // a printed plate: solid plate edge, and the one stitch sits under the label
    expect(cottage.edge).toBe('solid')
    expect(cottage.headRule).toBe('dashed')
    // the pasted label is plain paper: no hatch behind it, unlike the base theme
    expect(cottage.headImage).toBe('none')
    expect(cottage.inset).toContain('inset')

    // a cool grey inset inside the body
    expect(atom.inset).toContain('inset')
    expectNoShadow(plain.inset)

    // a faint glow on the head label
    expect(phosphor.glow).not.toBe('none')
    expect(plain.glow).toBe('none')

    // a warm paper shadow under the card
    expect(bone.lift).not.toBe('none')
    expectNoShadow(plain.lift)
  })

  it('softens catppuccin and brackets dracula on the card face', () => {
    const mocha = frameSignature('catppuccin-mocha')
    const bone = frameSignature('bone')
    const dracula = frameSignature('dracula')
    const plain = frameSignature('bluesky')

    expect(bone.radius).toBe('0px')
    expect(mocha.radius).toBe('4px')
    expect(mocha.headImage).toContain('linear-gradient')
    expect(mocha.headImage).not.toContain('repeating-linear-gradient')
    expect(bone.headImage).toContain('repeating-linear-gradient')

    // dracula paints four corner rules over the card face, the others do not
    expect(plain.faceSize).toBe('auto')
    expect(dracula.faceSize.startsWith('12px 1px')).toBe(true)
  })

  it('strips decoration but keeps the boundaries in high contrast', () => {
    document.documentElement.dataset['contrast'] = 'high'
    const cottage = frameSignature('cottagecore')
    const atom = frameSignature('atom')
    const bone = frameSignature('bone')

    expect(cottage.headImage).toBe('none')
    expect(cottage.edge).toBe('solid')
    expect(cottage.headRule).toBe('dashed')
    expectNoShadow(atom.inset)
    expectNoShadow(bone.lift)
    expect(cottage.glow).toBe('none')
  })

  it("keeps every half's signature inside the split preview", () => {
    // the root carries the sharp void hatch; the halves must not inherit it
    document.documentElement.dataset['theme'] = 'void'
    const halves = halfTheme('bone', 'github-light')
    const boneHalf = halves[0]
    const githubHalf = halves[1]
    expect(boneHalf).toBeDefined()
    expect(githubHalf).toBeDefined()
    if (boneHalf === undefined || githubHalf === undefined) return

    const boneHead = boneHalf.querySelector('.b-theme-preview__head')
    const githubHead = githubHalf.querySelector('.b-theme-preview__head')
    expect(boneHead).not.toBeNull()
    expect(githubHead).not.toBeNull()
    if (boneHead === null || githubHead === null) return

    const boneHeadImage = getComputedStyle(boneHead).backgroundImage
    expect(boneHeadImage).toContain('5px')
    expect(boneHeadImage).not.toContain('3px')
    expect(getComputedStyle(githubHead).backgroundImage).toBe('none')

    // truth to materials keeps its heavy grain in its half only
    const textured = halfTheme('bone', 'truth-to-materials')
    const bonePaper = textured[0]
    const truthPaper = textured[1]
    expect(bonePaper).toBeDefined()
    expect(truthPaper).toBeDefined()
    if (bonePaper === undefined || truthPaper === undefined) return

    const boneTexture = getComputedStyle(bonePaper).backgroundImage
    const truthTexture = getComputedStyle(truthPaper).backgroundImage
    expect(boneTexture).toContain('3px')
    expect(truthTexture).toContain('1px')
    expect(truthTexture).not.toBe(boneTexture)

    // the one ancestor-keyed signature must not stamp the neutral split
    document.documentElement.dataset['theme'] = 'dracula'
    const bracketed = halfTheme('bone', 'github-light')
    const firstHalf = bracketed[0]
    expect(firstHalf).toBeDefined()
    if (firstHalf === undefined) return
    const stampedSplit = firstHalf.closest('.b-theme-preview--split')
    if (!(stampedSplit instanceof HTMLElement)) throw new Error('no split preview')
    expect(getComputedStyle(stampedSplit).backgroundImage).toBe('none')
    expect(getComputedStyle(firstHalf).backgroundImage.startsWith('linear-gradient(')).toBe(false)
  })

  it('prints the family signature on a real post card', () => {
    const bone = postSignature('bone')
    const voidCard = postSignature('void')
    const oxide = postSignature('oxide')
    const github = postSignature('github-light')
    const pumpkin = postSignature('pumpkin-ember')
    const phosphor = postSignature('phosphor')

    // a post card renders no frame head: the author row is the head band
    expect(bone.authorImage).toContain('repeating-linear-gradient')
    expect(bone.authorRule).toBe('solid')
    expect(bone.frameTop).toBe('1px')
    expect(bone.height).toBeGreaterThan(0)

    // void sharpens the hatch and adds a crisp top hairline
    expect(voidCard.authorImage).toContain('repeating-linear-gradient')
    expect(voidCard.authorImage).not.toBe(bone.authorImage)
    expect(voidCard.frameShadow).toContain('inset')

    // oxide's rust double rule reads on the author row and inside the frame top
    expect(oxide.authorRule).toBe('double')
    expect(oxide.authorRuleWidth).toBe('3px')
    expect(oxide.authorRule).not.toBe(bone.authorRule)
    expect(oxide.frameShadow).toContain('inset')

    // github keeps a flat head but its frame top grows a list rule
    expect(github.authorImage).toBe('none')
    expect(github.authorRule).toBe('none')
    expect(github.frameTop).toBe('2px')
    expect(github.frameTop).not.toBe(bone.frameTop)
    expect(github.frameTopStyle).toBe('solid')
    expect(github.radius).toBe('6px')

    // a seasonal hatch and phosphor's glow read on the same card
    expect(pumpkin.authorImage).toContain('115deg')
    expect(pumpkin.authorImage).not.toBe(bone.authorImage)
    expect(phosphor.glow).not.toBe('none')
    expect(bone.glow).toBe('none')
  })
})

/* cyberpunk corner language ------------------------------------------ */

function must<T extends Element | null>(value: T): NonNullable<T> {
  if (value === null) throw new Error('element did not render')
  return value as NonNullable<T>
}

function styleOf(selector: string, root: ParentNode = document): CSSStyleDeclaration {
  return getComputedStyle(must(root.querySelector<HTMLElement>(selector)))
}

/** The shape a surface resolves, read from real computed style. */
function clipOf(selector: string, root: ParentNode = document): string {
  return styleOf(selector, root).clipPath
}

/** A theme token as the `rgb()` serialization a computed gradient contains. */
function paintedTokenCss(name: string, scope: Element = document.documentElement): string {
  const probe = document.createElement('span')
  probe.style.color = `var(${name})`
  scope.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return cssRgb(color)
}

/** Compares two colours as painted pixels, never as a serialization format. */
function expectPainted(actual: string, expected: string): void {
  expect(painted(actual)).toEqual(painted(expected))
}

/** `background-position` layers as plain numbers, so `0px`/`0%` compare equally. */
function positions(value: string): string[] {
  return value.split(/,\s*/).map((layer) =>
    layer
      .trim()
      .split(/\s+/)
      .map((part) => part.replace(/(%|px)$/, ''))
      .join(' '),
  )
}

/* cottagecore herbarium ----------------------------------------------- */

const PLATE_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

function plateCard() {
  return postFixture({
    embed: {
      type: 'images',
      images: [
        { thumb: PLATE_IMAGE, fullsize: PLATE_IMAGE, alt: 'a pressed plate', width: 8, height: 4 },
      ],
    },
  })
}

describe('cottagecore herbarium', () => {
  function renderPlate() {
    document.documentElement.dataset['theme'] = 'cottagecore'
    return renderStage(
      <QueryClientProvider client={createTestQueryClient()}>
        <Router hook={memoryLocation({ path: '/' }).hook}>
          <Frame label="pressed plate" meta="no. 12">
            <p className="b-post-card__text">
              body text <a href="#plate">herbarium index</a>
            </p>
            <span className="b-tag b-tag--default">pressed</span>
          </Frame>
          <PostCard post={plateCard()} index={1} focused />
        </Router>
      </QueryClientProvider>,
    )
  }

  it('draws linen, pressed paper and olive ink with the measured text ramp', () => {
    const { container } = renderPlate()
    const frame = must(container.querySelector<HTMLElement>('.b-frame'))
    const focused = must(container.querySelector<HTMLElement>('.b-post-card--focused'))

    // page and card surfaces: linen #f2ebd8 under pressed sheet #ebe1cb
    expectPainted(
      getComputedStyle(must(container.querySelector<HTMLElement>('.b-app'))).backgroundColor,
      '#f2ebd8',
    )
    expectPainted(getComputedStyle(frame).backgroundColor, '#ebe1cb')
    // body 10.86:1, dim 6.98:1, faint 5.01:1 on paper
    expectPainted(
      getComputedStyle(must(container.querySelector<HTMLElement>('.b-post-card__text'))).color,
      '#2f2b21',
    )
    expectPainted(
      getComputedStyle(must(container.querySelector<HTMLElement>('.b-frame__label'))).color,
      '#4f4837',
    )
    expect(
      painted(getComputedStyle(must(container.querySelector<HTMLElement>('.b-frame__meta'))).color),
    ).toEqual(roleColor('--text-muted'))
    // links 5.91:1 on paper
    expectPainted(
      getComputedStyle(must(container.querySelector<HTMLElement>('a'))).color,
      '#3f5a3a',
    )
    // a meaningful selected edge consumes the raw --blue accent, 5.91:1 here
    expectPainted(getComputedStyle(focused).borderLeftColor, '#3f5a3a')

    // the plate: solid engraved edge, one stitched rule under the label, no
    // hatch, an inner mount rule and a resting-sheet shadow
    const frameStyle = getComputedStyle(frame)
    expect(frameStyle.borderTopStyle).toBe('solid')
    expectPainted(frameStyle.borderTopColor, '#ccbc9e')
    const head = getComputedStyle(must(container.querySelector<HTMLElement>('.b-frame__head')))
    expect(head.backgroundImage).toBe('none')
    expect(head.borderBottomStyle).toBe('dashed')
    expectPainted(head.borderBottomColor, '#8b7754')
    expect(
      getComputedStyle(must(container.querySelector<HTMLElement>('.b-frame__body'))).boxShadow,
    ).toContain('inset')
    // laid paper: one axis of chain lines on a 6px pitch
    expect(getComputedStyle(focused).backgroundImage).toContain('6px')
    // a tag is a printed label on raised paper, not a kraft chip
    const tag = getComputedStyle(must(container.querySelector<HTMLElement>('.b-tag')))
    expectPainted(tag.backgroundColor, '#f4ebd7')
    expectPainted(tag.borderTopColor, '#8b7754')
  })

  function imageEffect(theme: Theme) {
    useSettings.setState({ theme, imageEffects: true })
    document.documentElement.dataset['theme'] = theme
    const { container } = renderStage(
      <QueryClientProvider client={createTestQueryClient()}>
        <Router hook={memoryLocation({ path: '/' }).hook}>
          <PostCard post={plateCard()} index={1} />
        </Router>
      </QueryClientProvider>,
    )
    const image = must(container.querySelector<HTMLElement>('.b-post-card__media img.dither-image'))
    const style = getComputedStyle(image)
    return {
      effect: image.dataset['effect'] ?? '',
      filter: style.filter,
      imageRendering: style.imageRendering,
    }
  }

  it('screens a real post image as a halftone and leaves the other effects alone', () => {
    const { container } = render(<DitherDefs />)

    const cottage = imageEffect('cottagecore')
    expect(cottage.effect).toBe('halftone')
    expect(cottage.filter).toContain('benday-dither-cottagecore')
    // a print has no source pixels: the screen resamples the image itself
    expect(cottage.imageRendering).toBe('auto')

    const cottageFilter = must(
      container.querySelector<SVGFilterElement>('#benday-dither-cottagecore'),
    )
    const compare = must(cottageFilter.querySelector('feComposite[result="mixed"]'))
    // a full-range compare, not the old 0.85/-0.425 pair that crushed both ends
    expect(compare.getAttribute('k3')).toBe('1')
    expect(compare.getAttribute('k4')).toBe('-0.5')
    // the same numbers compared in linear light print a much darker screen
    expect(cottageFilter.getAttribute('color-interpolation-filters')).toBe('sRGB')
    // the paper tooth is a zero-mean 8% modulation, not per-pixel static
    const tooth = must(cottageFilter.querySelector('feComposite[result="tooth"]'))
    expect(tooth.getAttribute('k3')).toBe('0.08')
    expect(tooth.getAttribute('k4')).toBe('-0.04')
    const pattern = must(cottageFilter.querySelector('feImage'))
    expect(pattern.getAttribute('width')).toBe('16')
    expect(pattern.getAttribute('height')).toBe('16')
    const href = pattern.getAttribute('href') ?? ''
    const tile = atob(href.slice(href.indexOf(',') + 1))
    expect(tile).toContain('shape-rendering="crispEdges"')
    // clustered one-pixel dots, not sixty-four 2x2 bayer cells
    expect(tile).not.toContain('<rect')
    expect(tile.match(/h1v1h-1z/g) ?? []).toHaveLength(256)

    // the two control themes keep the effects they already had
    const bone = imageEffect('bone')
    expect(bone.effect).toBe('grunge')
    expect(bone.filter).toContain('benday-dither-bone')
    expect(bone.imageRendering).toBe('pixelated')
    const boneCompare = must(
      must(container.querySelector<SVGFilterElement>('#benday-dither-bone')).querySelector(
        'feComposite[result="mixed"]',
      ),
    )
    expect(boneCompare.getAttribute('k3')).toBe('0.85')

    const truth = imageEffect('truth-to-materials')
    expect(truth.effect).toBe('industrial')
    expect(truth.filter).toContain('benday-dither-truth-to-materials')
  })
})

describe('cyberpunk corner language', () => {
  // every boxed card surface, the dialogs that already own the shape and the
  // three boxes that previously stayed square: one token produces all of them
  const CUT_SURFACES = [
    '.b-frame',
    '.b-card-back',
    '.b-card-back--button',
    '.b-post-card',
    '.b-refresh-card',
    '.b-mode-card',
    '.b-feed-card',
    '.b-compose-dock',
    '.b-deck__skeleton',
    '.b-deck__load-error',
    '.b-error',
    '.b-empty',
    '.b-palette',
    '.b-media-viewer',
  ] as const

  it('cuts every boxed surface with the one theme polygon', async () => {
    document.documentElement.dataset['theme'] = 'cyberpunk'
    await page.viewport(1280, 800)
    const { container } = render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Router hook={memoryLocation({ path: '/' }).hook}>
          <Frame label="corner" meta="now">
            <p>body</p>
          </Frame>
          <CardBack label="back" index={cardBackIndex(1)} title="a feed" hint="← feeds" />
          <CardBackButton
            label="back"
            index={cardBackIndex(2)}
            title="another feed"
            hint="← feeds"
            ariaLabel="show another feed"
            onClick={() => {}}
          />
          <RefreshCard index={3} onRefresh={() => {}} />
          <ModeCard
            label="mode"
            name="feeds"
            description="switch the deck"
            active
            countLabel="4 cards"
            activeHint="← modes"
            onSelect={() => {}}
          />
          <PostCard post={postFixture()} index={1} />
          <FeedCard
            choice={{
              kind: 'discover',
              key: 'discover',
              name: 'discover',
              description: 'popular right now',
              avatar: null,
              source: { kind: 'discover' },
            }}
            active={false}
            focused={false}
            onSelect={() => {}}
          />
          <InlineComposer request={{ mode: 'reply', post: postFixture() }} onClose={() => {}} />
          <ErrorNotice message="couldn't load this feed" onRetry={() => {}} />
          <Deck<string>
            items={[]}
            getKey={(item) => item}
            renderItem={() => null}
            pending
            label="loading deck"
          />
          <Deck<string>
            items={[]}
            getKey={(item) => item}
            renderItem={() => null}
            loadMoreError
            onRetryLoadMore={() => {}}
            label="error deck"
          />
          <Deck<string>
            items={[]}
            getKey={(item) => item}
            renderItem={() => null}
            label="empty deck"
          />
          <Dialog open title="palette" className="b-palette" onClose={() => {}}>
            <p>commands</p>
          </Dialog>
          <Dialog open title="media" className="b-media-viewer" onClose={() => {}}>
            <p>media</p>
          </Dialog>
        </Router>
      </QueryClientProvider>,
    )

    // the polygon comes from the token, so every surface that claims the cut
    // must resolve the very same six points
    const polygon = clipOf('.b-frame', container)
    expect(polygon).toMatch(/^polygon\(/)
    expect(polygon).toContain('18px')
    for (const selector of CUT_SURFACES) {
      expect(clipOf(selector, container), selector).toBe(polygon)
    }
  })

  it('hides child bleed on a cut frame and keeps the hud marks on the edge', () => {
    document.documentElement.dataset['theme'] = 'cyberpunk'
    const { container } = render(
      <Frame label="corner" meta="now">
        <p>body</p>
      </Frame>,
    )
    const frame = must(container.querySelector<HTMLElement>('.b-frame'))

    // the bleed guard the other shaped themes already had: no square child
    // corner can paint through the notch
    expect(getComputedStyle(frame).overflow).toBe('hidden')

    // both marks survive the clip: the diagonal is the cut edge itself (its
    // -1px inset cancels the 1px border) and the brackets fold the square ends
    const diagonal = getComputedStyle(frame, '::before')
    expect(diagonal.content).not.toBe('none')
    expect(diagonal.backgroundSize).toBe('18px 18px, 18px 18px')
    expect(diagonal.top).toBe('-1px')
    expect(diagonal.left).toBe('-1px')
    expect(positions(diagonal.backgroundPosition)).toEqual(['0 0', '100 100'])

    const bracket = getComputedStyle(frame, '::after')
    expect(bracket.content).not.toBe('none')
    expect(positions(bracket.backgroundPosition)).toEqual(['100 0', '100 0', '0 100', '0 100'])
    const accent = paintedTokenCss('--blue')
    expect(bracket.backgroundImage).toContain(accent)
    expect(bracket.backgroundImage).not.toContain('light-dark')
    expect(bracket.backgroundImage).not.toContain('var(')

    // the guard is theme-scoped: a plain frame stays square and unclipped
    document.documentElement.dataset['theme'] = 'void'
    const { container: plain } = render(
      <Frame label="plain" meta="now">
        <p>body</p>
      </Frame>,
    )
    expect(styleOf('.b-frame', plain).overflow).toBe('visible')
    expect(clipOf('.b-frame', plain)).toBe('none')
  })

  it('guards the boxes that only just joined the cut', () => {
    document.documentElement.dataset['theme'] = 'cyberpunk'
    const { container } = render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Router hook={memoryLocation({ path: '/' }).hook}>
          <Deck<string>
            items={[]}
            getKey={(item) => item}
            renderItem={() => null}
            pending
            label="loading deck"
          />
          <Deck<string>
            items={[]}
            getKey={(item) => item}
            renderItem={() => null}
            loadMoreError
            onRetryLoadMore={() => {}}
            label="error deck"
          />
          <ErrorNotice message="couldn't load this feed" onRetry={() => {}} />
          <InlineComposer request={{ mode: 'reply', post: postFixture() }} onClose={() => {}} />
        </Router>
      </QueryClientProvider>,
    )
    const polygon = clipOf('.b-deck__skeleton', container)
    expect(polygon).toMatch(/^polygon\(/)
    // the transient boxes clip their own paint like the frame does
    expect(clipOf('.b-deck__load-error', container)).toBe(polygon)
    expect(clipOf('.b-compose-dock', container)).toBe(polygon)
    expect(styleOf('.b-deck__skeleton', container).overflow).toBe('hidden')
    expect(styleOf('.b-deck__load-error', container).overflow).toBe('hidden')
    // the dock is a scroller, which already clips its own children
    expect(styleOf('.b-compose-dock', container).overflowY).toBe('auto')

    // the alert and the deck load error are cut like the empty state and keep
    // its marks; the pending card is shape-only, its ::after is its texture
    const error = must(container.querySelector<HTMLElement>('.b-error'))
    expect(clipOf('.b-error', container)).toBe(polygon)
    expect(getComputedStyle(error, '::before').content).not.toBe('none')
    expect(getComputedStyle(error, '::after').content).not.toBe('none')
    const loadError = must(container.querySelector<HTMLElement>('.b-deck__load-error'))
    expect(getComputedStyle(loadError, '::after').content).not.toBe('none')
    expect(
      getComputedStyle(must(container.querySelector<HTMLElement>('.b-deck__skeleton')), '::before')
        .content,
    ).toBe('none')
    expect(
      getComputedStyle(must(container.querySelector<HTMLElement>('.b-compose-dock')), '::before')
        .content,
    ).toBe('none')

    // ...but the guard is not a new rule for everybody else: a plain theme
    // leaves the same boxes square and unclipped
    document.documentElement.dataset['theme'] = 'bone'
    const { container: plain } = render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Router hook={memoryLocation({ path: '/' }).hook}>
          <Deck<string>
            items={[]}
            getKey={(item) => item}
            renderItem={() => null}
            pending
            label="loading deck"
          />
          <ErrorNotice message="plain" />
          <InlineComposer request={{ mode: 'reply', post: postFixture() }} onClose={() => {}} />
        </Router>
      </QueryClientProvider>,
    )
    expect(styleOf('.b-deck__skeleton', plain).overflow).toBe('visible')
    expect(clipOf('.b-deck__skeleton', plain)).toBe('none')
    expect(clipOf('.b-error', plain)).toBe('none')
    expect(clipOf('.b-compose-dock', plain)).toBe('none')
  })

  it('cuts only the cyberpunk half of a split preview under another root', () => {
    document.documentElement.dataset['theme'] = 'cyberpunk'
    const { container: reference } = render(
      <Frame label="reference" meta="now">
        <p>body</p>
      </Frame>,
    )
    // snapshots are strings immediately: the root theme is about to change
    const polygon = clipOf('.b-frame', reference)
    const referenceDiagonalSize = getComputedStyle(
      must(reference.querySelector<HTMLElement>('.b-frame')),
      '::before',
    ).backgroundSize

    document.documentElement.dataset['theme'] = 'bone'
    const halves = halfTheme('bone', 'cyberpunk')
    const [boneHalf, cyberHalf] = halves
    if (boneHalf === undefined || cyberHalf === undefined) throw new Error('halves missing')

    // the half resolves the same polygon the root does, and the bone half and
    // the neutral split container stay square
    expect(getComputedStyle(cyberHalf).clipPath).toBe(polygon)
    expect(getComputedStyle(boneHalf).clipPath).toBe('none')
    expect(getComputedStyle(splitContainer()).clipPath).toBe('none')

    // the marks stay on the cyberpunk half only: diagonals on the cut corners,
    // brackets on the two square ones, in that half's own accent
    expect(getComputedStyle(boneHalf, '::before').content).toBe('none')
    expect(getComputedStyle(boneHalf, '::after').content).toBe('none')
    const diagonal = getComputedStyle(cyberHalf, '::before')
    expect(diagonal.content).not.toBe('none')
    expect(diagonal.backgroundSize).toBe(referenceDiagonalSize)
    expect(positions(diagonal.backgroundPosition)).toEqual(['0 0', '100 100'])
    const bracket = getComputedStyle(cyberHalf, '::after')
    expect(positions(bracket.backgroundPosition)).toEqual(['100 0', '100 0', '0 100', '0 100'])
    const accent = paintedTokenCss('--blue', cyberHalf)
    expect(bracket.backgroundImage).toContain(accent)
  })

  it('leaves the focusable chrome and the settings rows square', () => {
    document.documentElement.dataset['theme'] = 'cyberpunk'
    const { container } = render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Button onClick={() => {}}>action</Button>
        <TextInput label="handle" value="" onChange={() => {}} />
        <Tag>label</Tag>
        <Kbd>g</Kbd>
        <SettingsDialog open onClose={() => {}} />
      </QueryClientProvider>,
    )

    // a control keeps its whole focus outline: the corner language never clips
    // a focusable element or a flat settings row that only groups controls
    const square = [
      '.b-button',
      '.b-input__control',
      '.b-tag',
      '.b-kbd',
      '.b-settings__section',
      '.b-settings__theme',
      '.b-settings__appview',
    ]
    for (const selector of square) {
      expect(clipOf(selector, container), selector).toBe('none')
    }

    // the window those rows live in is a cut surface, like every dialog
    expect(clipOf('.b-dialog', container)).toMatch(/^polygon\(/)
  })

  it('cuts each surface once and never cuts a wrapper', () => {
    document.documentElement.dataset['theme'] = 'cyberpunk'
    const { container } = render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Router hook={memoryLocation({ path: '/' }).hook}>
          <Deck<string>
            items={['feed']}
            getKey={(item) => item}
            renderItem={(item, index) => (
              <CardBackButton
                label="back"
                index={cardBackIndex(index)}
                title={item}
                hint="← feeds"
                ariaLabel="show feed"
                onClick={() => {}}
              />
            )}
            leadingPeek={
              <CardBack label="back" index={cardBackIndex(0)} title="peek" hint="← peek" />
            }
            label="feed deck"
          />
          <Dialog open title="settings" onClose={() => {}}>
            <Frame label="inner" meta="now">
              <p>nested</p>
            </Frame>
          </Dialog>
        </Router>
      </QueryClientProvider>,
    )
    const polygon = clipOf('.b-card-back--button', container)

    // a card back inside a deck peek is cut; its deck slot is a layout box
    for (const selector of [
      '.b-deck',
      '.b-deck__item',
      '.b-deck__peek',
      '.b-dialog__body',
      '.b-dialog__head',
    ]) {
      expect(clipOf(selector, container), selector).toBe('none')
    }
    expect(clipOf('.b-card-back', container)).toBe(polygon)

    // a frame inside a dialog: one cut per box, and the body padding keeps the
    // inner notch off the dialog's own, so no cut lands on another cut
    expect(clipOf('.b-dialog', container)).toBe(polygon)
    expect(clipOf('.b-dialog .b-frame', container)).toBe(polygon)
    const padding = Number.parseFloat(styleOf('.b-dialog__body', container).paddingLeft)
    expect(padding).toBeGreaterThan(0)
    const bodyBox = must(
      container.querySelector<HTMLElement>('.b-dialog__body'),
    ).getBoundingClientRect()
    const innerBox = must(
      container.querySelector<HTMLElement>('.b-dialog .b-frame'),
    ).getBoundingClientRect()
    expect(innerBox.left - bodyBox.left).toBeCloseTo(padding, 0)
  })

  it('keeps the geometry in high contrast and the boot off in reduced motion', () => {
    document.documentElement.dataset['theme'] = 'cyberpunk'
    document.documentElement.dataset['contrast'] = 'high'
    const { container } = render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Deck<string>
          items={['card']}
          getKey={(item) => item}
          renderItem={() => (
            <Frame label="card" meta="now">
              <p>focused</p>
            </Frame>
          )}
          label="focused deck"
        />
        <Dialog open title="settings" onClose={() => {}}>
          <p>body</p>
        </Dialog>
      </QueryClientProvider>,
    )

    const frame = must(
      container.querySelector<HTMLElement>('.b-deck__item[data-focused="true"] > .b-frame'),
    )
    const frameStyle = getComputedStyle(frame)
    // high contrast changes colours only: the octagon and its zero radius stay
    expect(frameStyle.clipPath).toMatch(/^polygon\(/)
    expect(frameStyle.borderRadius).toBe('0px')
    // focus still reads: the double rule is inset, the glow wraps the cut
    expect(frameStyle.outlineStyle).toBe('solid')
    expect(frameStyle.outlineOffset).toBe('-3px')
    expect(frameStyle.boxShadow).toContain('inset')
    expect(frameStyle.filter).toContain('drop-shadow')
    // no neon left, but the corner marks keep drawing in the accent
    expect(getComputedStyle(document.documentElement).getPropertyValue('--neon').trim()).toBe(
      'transparent',
    )
    expect(getComputedStyle(frame, '::before').content).not.toBe('none')
    const accent = cssRgb('#9ecbff')
    expect(getComputedStyle(frame, '::after').backgroundImage).toContain(accent)
    expect(getComputedStyle(frame, '::after').backgroundImage).not.toContain('rgb(255, 42, 109)')

    // the browser context asks for reduced motion, so the boot never runs
    const body = must(container.querySelector<HTMLElement>('.b-dialog__body'))
    expect(getComputedStyle(body).animationName).toBe('none')
    expect(
      getComputedStyle(must(container.querySelector<HTMLElement>('.b-dialog__head')), '::after')
        .animationName,
    ).toBe('none')
  })
})
