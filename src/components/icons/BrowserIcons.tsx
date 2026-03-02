import React, { FC } from "react";

interface IconProps {
  className?: string;
}

export const SketchIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 14L7 2l4 8-3 1 2 3" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
);

export const BodyIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M4 6l4-3 4 3v4l-4 3-4-3V6z" strokeLinejoin="round" />
    <path d="M4 6l4 3 4-3" strokeLinejoin="round" />
    <path d="M8 9v4" />
  </svg>
);

export const ProfileIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="3" y="4" width="10" height="8" rx="0.5" />
  </svg>
);

export const PlaneIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 10l5-6h5l2 2-5 6H4L2 10z" strokeLinejoin="round" />
  </svg>
);

export const AxisIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 8h12" strokeLinecap="round" />
    <path d="M11 5l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const OriginPointIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="8" cy="8" r="3" />
    <circle cx="8" cy="8" r="1" fill="currentColor" />
  </svg>
);

export const UnionIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="6" cy="8" r="4" />
    <circle cx="10" cy="8" r="4" />
  </svg>
);

export const DifferenceIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="6" cy="8" r="4" />
    <circle cx="10" cy="8" r="4" strokeDasharray="2 2" />
  </svg>
);

export const IntersectionIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="6" cy="8" r="4" strokeDasharray="2 2" />
    <circle cx="10" cy="8" r="4" strokeDasharray="2 2" />
    <path d="M8 4.5a4 4 0 0 1 0 7" />
    <path d="M8 4.5a4 4 0 0 0 0 7" />
  </svg>
);

export const ExtrudeIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="4" y="10" width="8" height="4" rx="0.5" />
    <path d="M5 10V6h6v4" />
    <path d="M8 6V2" strokeLinecap="round" />
    <path d="M6 4l2-2 2 2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const SweepIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="2" y="5" width="4" height="6" rx="0.5" />
    <path d="M6 8c2-3 5-3 8 0" strokeLinecap="round" />
    <path d="M12 6l2 2-2 2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const LoftIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="4" y="2" width="8" height="3" rx="0.5" />
    <rect x="5" y="11" width="6" height="3" rx="0.5" />
    <path d="M4 5c-1 3-1 3 1 6M12 5c1 3 1 3-1 6" strokeLinecap="round" />
  </svg>
);

export const EyeIcon: FC<IconProps> = ({ className = "w-3.5 h-3.5" }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5S1 8 1 8z" />
    <circle cx="8" cy="8" r="2" />
  </svg>
);

export const EyeOffIcon: FC<IconProps> = ({ className = "w-3.5 h-3.5" }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5S1 8 1 8z" />
    <path d="M3 13L13 3" strokeLinecap="round" />
  </svg>
);

export const OrbitIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M8 2a6 6 0 1 1-4.24 1.76" strokeLinecap="round" />
    <path d="M5 1l-1.5 3L7 5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const PanIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M8 2v12M2 8h12" strokeLinecap="round" />
    <path d="M8 2l-2 2M8 2l2 2M8 14l-2-2M8 14l2-2M2 8l2-2M2 8l2 2M14 8l-2-2M14 8l-2 2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ZoomIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" strokeLinecap="round" />
    <path d="M5 7h4M7 5v4" strokeLinecap="round" />
  </svg>
);

export const FitAllIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="5" y="5" width="6" height="6" rx="0.5" />
  </svg>
);

export const ChevronIcon: FC<IconProps & { expanded?: boolean }> = ({ className = "w-3 h-3", expanded }) => (
  <svg
    className={`${className} transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
    viewBox="0 0 16 16"
    fill="currentColor"
  >
    <path d="M6 3l5 5-5 5V3z" />
  </svg>
);
