import React from 'react';

interface AvatarProps {
  name: string;
  color: string;
  size?: 'sm' | 'md' | 'lg';
  audioLevel?: number;
  onStage?: boolean;
}

export function Avatar({
  name,
  color,
  size = 'md',
  audioLevel = 0,
  onStage = false,
}: AvatarProps) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'S';

  const sizeClasses =
    size === 'sm'
      ? 'w-8 h-8 text-xs'
      : size === 'lg'
        ? 'w-12 h-12 text-base'
        : 'w-10 h-10 text-sm';

  const ringOpacity = onStage ? Math.min(1, 0.35 + (audioLevel / 100) * 0.65) : 0;

  return (
    <div
      className={`relative shrink-0 rounded-full flex items-center justify-center font-semibold text-white select-none ${sizeClasses}`}
      style={{
        backgroundColor: color,
        boxShadow: onStage
          ? `0 0 0 2px #0B0D12, 0 0 0 4px rgba(255, 90, 54, ${ringOpacity})`
          : undefined,
      }}
      aria-label={name}
    >
      {initials}
    </div>
  );
}
