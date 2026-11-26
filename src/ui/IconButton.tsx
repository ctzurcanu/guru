import type {ButtonHTMLAttributes} from 'react';
import type {LucideIcon} from 'lucide-react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /** Accessible name and tooltip. */
  label: string;
  /** Also show the label as text next to the icon. */
  showLabel?: boolean;
}

/** A button that shows an icon; its label is the tooltip and the screen-reader name. */
export function IconButton({icon: Icon, label, showLabel, className = '', type = 'button', ...rest}: Props) {
  return (
    <button {...rest} type={type} className={`icon ${className}`} aria-label={label} title={label}>
      <Icon size={18} strokeWidth={2} aria-hidden="true" />
      {showLabel && <span>{label}</span>}
    </button>
  );
}
