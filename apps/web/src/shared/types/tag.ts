/** A mark the user puts on expenses to follow them across kinds ("Hogar", "Gatos", "Universidad"…). */
export interface Tag {
  id: string;
  name: string;
  color: string;
}

/**
 * Colors offered for a tag: the app's categorical palette, validated together on the dark surface (lightness band,
 * chroma, colorblind and normal-vision separation, contrast), in its fixed order.
 */
export const TAG_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'] as const;

/** The tags an item carries that still exist (a deleted tag simply stops showing). */
export const tagsOf = (ids: string[] | undefined | null, all: Tag[]): Tag[] => (ids ?? []).map((id) => all.find((t) => t.id === id)).filter((t): t is Tag => !!t);
