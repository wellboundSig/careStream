import { parseMentionSegments } from '../../utils/mentions.js';
import palette, { hexToRgba } from '../../utils/colors.js';

/**
 * Renders note content with @[Name](userId) tokens as inline mention pills.
 */
export default function MentionText({
  content,
  resolveUser,
  style = {},
  highlightUserId = null,
}) {
  const segments = parseMentionSegments(content || '');

  if (segments.length === 0) {
    return <span style={style}>{content || ''}</span>;
  }

  return (
    <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...style }}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return <span key={i}>{seg.value}</span>;
        }
        const resolved = resolveUser ? resolveUser(seg.userId) : null;
        const label = (resolved && resolved !== seg.userId ? resolved : null) || seg.label || 'Someone';
        const isYou = highlightUserId && seg.userId === highlightUserId;
        return (
          <span
            key={i}
            title={label}
            style={{
              display: 'inline',
              padding: '1px 7px',
              margin: '0 1px',
              borderRadius: 999,
              fontWeight: 650,
              fontSize: '0.92em',
              lineHeight: 1.45,
              background: isYou
                ? hexToRgba(palette.primaryMagenta.hex, 0.14)
                : hexToRgba(palette.accentBlue.hex, 0.12),
              color: isYou ? palette.primaryMagenta.hex : palette.accentBlue.hex,
              boxShadow: `inset 0 0 0 1px ${
                isYou
                  ? hexToRgba(palette.primaryMagenta.hex, 0.22)
                  : hexToRgba(palette.accentBlue.hex, 0.2)
              }`,
              whiteSpace: 'nowrap',
            }}
          >
            @{label}
          </span>
        );
      })}
    </span>
  );
}
