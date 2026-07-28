import {
  ACCOUNT_MANAGER_INFO_MENTION_ID,
  isSpecialMentionId,
  parseMentionSegments,
} from '../../utils/mentions.js';
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
        const special = isSpecialMentionId(seg.userId)
          || seg.userId === ACCOUNT_MANAGER_INFO_MENTION_ID;
        const resolved = special ? null : (resolveUser ? resolveUser(seg.userId) : null);
        const label = special
          ? (seg.label || 'Account manager info')
          : ((resolved && resolved !== seg.userId ? resolved : null) || seg.label || 'Someone');
        const isYou = !special && highlightUserId && seg.userId === highlightUserId;
        const accent = special
          ? palette.accentOrange.hex
          : isYou
            ? palette.primaryMagenta.hex
            : palette.accentBlue.hex;
        return (
          <span
            key={i}
            title={special ? 'Routed to Pending Log · Account manager info' : label}
            style={{
              display: 'inline',
              padding: '1px 7px',
              margin: '0 1px',
              borderRadius: 999,
              fontWeight: 650,
              fontSize: '0.92em',
              lineHeight: 1.45,
              background: hexToRgba(accent, special || isYou ? 0.14 : 0.12),
              color: accent,
              boxShadow: `inset 0 0 0 1px ${hexToRgba(accent, 0.22)}`,
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
