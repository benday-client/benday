// Display names for the content labels the appview returns. This is naming,
// not policy: the wire label stays raw in the model and every concealment,
// inert and reveal behaviour is unchanged.
const CONTENT_LABELS: Record<string, string> = {
  sexual: 'nsfw',
  porn: 'explicit sexual content',
  nudity: 'nudity',
  'graphic-media': 'graphic content',
}

export function displayContentLabel(label: string): string {
  return CONTENT_LABELS[label] ?? label
}
