/**
 * The assistant's face. A small inline SVG rather than an image file: it scales, it inherits
 * colour, and it carries no network request or licensing baggage.
 *
 * The state is the point — the avatar must show whether it is idle, listening, thinking or
 * speaking, because a voice interface with no visible state is unnerving.
 */
import React from 'react';

export function AssistantAvatar({ state = 'idle', size = 32, className = '' }) {
  const rings = state === 'listening' || state === 'speaking';
  const eyeShift = state === 'thinking' ? 1.6 : 0;
  return (
    <span
      className={`relative inline-grid place-items-center rounded-full shrink-0 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {rings && (
        <span
          className={`absolute inset-0 rounded-full ${state === 'listening' ? 'bg-danger-500/25' : 'bg-brand-500/25'} animate-ping`}
        />
      )}
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        role="img"
        className="relative rounded-full"
        style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
      >
        {/* face */}
        <circle cx="24" cy="25" r="13" fill="#eef2ff" />
        {/* hair / headset band */}
        <path d="M11 23a13 13 0 0 1 26 0" fill="none" stroke="#312e81" strokeWidth="2.5" strokeLinecap="round" />
        <rect x="7" y="22" width="4" height="7" rx="2" fill="#312e81" />
        <rect x="37" y="22" width="4" height="7" rx="2" fill="#312e81" />
        {/* eyes — shift slightly while thinking */}
        <circle cx={19 + eyeShift} cy="25" r="1.9" fill="#1b2230" />
        <circle cx={29 + eyeShift} cy="25" r="1.9" fill="#1b2230" />
        {/* mouth changes with state so the face is readable at 24px */}
        {state === 'speaking' ? (
          <ellipse cx="24" cy="31" rx="3.4" ry="2.2" fill="#4338ca" />
        ) : state === 'listening' ? (
          <path d="M21 31.5h6" stroke="#dc2626" strokeWidth="1.8" strokeLinecap="round" />
        ) : (
          <path d="M21 31q3 2 6 0" stroke="#4338ca" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        )}
        {/* mic dot when listening */}
        {state === 'listening' && <circle cx="38" cy="12" r="3" fill="#dc2626" />}
      </svg>
    </span>
  );
}

export const AVATAR_STATE_LABEL = {
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
};
