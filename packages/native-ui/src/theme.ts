import { rgba, type Color, type Align } from './types';

export enum FrameStyle {
  Plain,
  /** Flat-shaded relief: boards with a thickness, raised tiles, recessed wells. */
  Carved,
}

export class Theme {
  radius = 7;
  fontSize = 13;
  rowHeight = 32;
  font = 'DejaVuSans';
  boldFont = 'DejaVuSans-Bold';
  /** Face for bold text of `titleFrom` px and larger; empty keeps the bold face. */
  titleFont = '';
  titleFrom = 14;
  /** The theme's own faces run smaller than the fallback face; this evens them out. */
  fontScale = 1;
  frameStyle = FrameStyle.Plain;
  reducedMotion = false;
  /** How far pieces stand out: 1 is the full thickness and shadow, 0 lays everything flat. */
  depth = 1;
  /** Light and shade that turn a fill into its lit and shaded planes. */
  light = rgba(255, 255, 255);
  dusk = rgba(0, 0, 0);
  /** Hard shadow a floating board casts on the world. */
  shadow = rgba(0, 0, 0, 80);
  /** Floor of a recessed well. */
  well = rgba(0, 0, 0, 60);
  /** Notes, tags and tooltips: a light sheet with dark writing. */
  paper = rgba(236, 226, 200);
  ink = rgba(48, 40, 46);
  inkMuted = rgba(110, 98, 96);
  /** A heading or a mark on paper. */
  inkAccent = rgba(150, 84, 40);
  /** A warning on paper. */
  inkDanger = rgba(170, 48, 36);
  constructor(
    public background: Color,
    public surface: Color,
    public raised: Color,
    public border: Color,
    public text: Color,
    public muted: Color,
    public accent: Color,
    public accentText: Color,
    public selection: Color,
    public success: Color,
    public danger: Color,
  ) {}
  static dark(): Theme {
    return new Theme(
      rgba(23, 25, 29),
      rgba(30, 33, 38),
      rgba(39, 43, 49),
      rgba(57, 62, 70),
      rgba(235, 237, 239),
      rgba(151, 158, 168),
      rgba(168, 190, 151),
      rgba(24, 36, 25),
      rgba(53, 67, 54),
      rgba(153, 194, 162),
      rgba(224, 148, 140),
    );
  }
  static light(): Theme {
    return new Theme(
      rgba(241, 240, 235),
      rgba(252, 251, 247),
      rgba(233, 233, 226),
      rgba(213, 215, 205),
      rgba(39, 46, 40),
      rgba(113, 121, 111),
      rgba(76, 107, 66),
      rgba(255, 255, 250),
      rgba(222, 232, 215),
      rgba(64, 122, 81),
      rgba(174, 71, 65),
    );
  }
}
export type ThemeColor =
  | 'background'
  | 'surface'
  | 'raised'
  | 'border'
  | 'text'
  | 'muted'
  | 'accent'
  | 'accentText'
  | 'selection'
  | 'success'
  | 'danger';
export type StyleColor = Color | { token: ThemeColor };
export interface Appearance {
  fill?: StyleColor;
  border?: StyleColor;
  text?: StyleColor;
  hoverFill?: StyleColor;
  pressedFill?: StyleColor;
  activeFill?: StyleColor;
  disabledFill?: StyleColor;
  radius?: number;
  borderWidth?: number;
  fontSize?: number;
  bold?: boolean;
  textAlign?: Align;
  focusRing?: boolean;
  /** A slot that holds something: a recess instead of a raised tile, unless it is the primary one. */
  sunken?: boolean;
}
export function resolve(color: StyleColor | undefined, theme: Theme, fallback: Color): Color {
  return color ? ('token' in color ? theme[color.token] : color) : fallback;
}
