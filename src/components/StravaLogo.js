import React from 'react';
import Svg, { Path } from 'react-native-svg';

/**
 * Strava wordmark-style logo rendered as SVG.
 * Uses the official Strava brand orange (#FC4C02).
 *
 * @param {object} props
 * @param {number} [props.size=20]  - Height of the logo
 * @param {string} [props.color='#FC4C02'] - Fill colour
 */
export default function StravaLogo({ size = 20, color = '#FC4C02' }) {
  // Strava arrow logo — simplified two-chevron mark
  // viewBox chosen so the arrow pair is centred
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityLabel="Strava logo"
    >
      <Path
        d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066l-2.084 4.116z"
        fill={color}
        opacity={0.6}
      />
      <Path
        d="M10.233 13.828L15.387 24l5.15-10.172h-3.066l-2.084 4.116-2.089-4.116z"
        fill={color}
        opacity={0.6}
      />
      <Path
        d="M7.164 0l6.072 13.828h-3.065L7.164 7.45 4.077 13.828H1.01L7.164 0z"
        fill={color}
      />
    </Svg>
  );
}
