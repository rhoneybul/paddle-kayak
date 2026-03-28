/**
 * Custom SVG icon set — clean rounded line icons.
 * All icons accept: size (number), color (string), strokeWidth (number).
 */
import Svg, { Path, Circle, Line, Polyline, Rect } from 'react-native-svg';

const defaults = { size: 24, color: '#3a6a4a', strokeWidth: 1.7 };

function icon(renderFn) {
  return function Icon({ size = defaults.size, color = defaults.color, strokeWidth = defaults.strokeWidth }) {
    const props = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {renderFn(props)}
      </Svg>
    );
  };
}

export const HomeIcon = icon((p) => (
  <>
    <Path {...p} d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1v-9.5z" />
    <Path {...p} d="M9 21V12h6v9" />
  </>
));

export const TrashIcon = icon((p) => (
  <>
    <Polyline {...p} points="3 6 5 6 21 6" />
    <Path {...p} d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
    <Path {...p} d="M10 11v6M14 11v6" />
    <Path {...p} d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
  </>
));

export const BackIcon = icon((p) => (
  <Path {...p} d="M15 18l-6-6 6-6" />
));

export const HeartIconSvg = icon((p) => (
  <Path {...p} d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
));

export const SaveIcon = icon((p) => (
  <>
    <Path {...p} d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
    <Polyline {...p} points="17 21 17 13 7 13 7 21" />
    <Polyline {...p} points="7 3 7 8 15 8" />
  </>
));

export const MapPinIcon = icon((p) => (
  <>
    <Path {...p} d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z" />
    <Circle {...p} cx="12" cy="10" r="3" />
  </>
));

export const CalendarIcon = icon((p) => (
  <>
    <Rect {...p} x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <Line {...p} x1="16" y1="2" x2="16" y2="6" />
    <Line {...p} x1="8" y1="2" x2="8" y2="6" />
    <Line {...p} x1="3" y1="10" x2="21" y2="10" />
  </>
));

export const ChevronRightIcon = icon((p) => (
  <Path {...p} d="M9 18l6-6-6-6" />
));

export const PencilIcon = icon((p) => (
  <>
    <Path {...p} d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
    <Path {...p} d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
  </>
));

export const SettingsIcon = icon((p) => (
  <>
    <Circle {...p} cx="12" cy="12" r="3" />
    <Path {...p} d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
  </>
));

export const SearchIcon = icon((p) => (
  <>
    <Circle {...p} cx="10" cy="10" r="7" />
    <Line {...p} x1="15.5" y1="15.5" x2="21" y2="21" />
  </>
));

export const CrosshairIcon = icon((p) => (
  <>
    <Circle {...p} cx="12" cy="12" r="4" />
    <Line {...p} x1="12" y1="2" x2="12" y2="6" />
    <Line {...p} x1="12" y1="18" x2="12" y2="22" />
    <Line {...p} x1="2" y1="12" x2="6" y2="12" />
    <Line {...p} x1="18" y1="12" x2="22" y2="12" />
  </>
));
