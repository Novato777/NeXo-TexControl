import { Loader2, type LucideIcon } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'soft';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap select-none transition-colors disabled:opacity-55 disabled:cursor-not-allowed rounded-[var(--radius-btn)]';
const variants: Record<Variant, string> = {
  primary: 'bg-petrol-600 text-white hover:bg-petrol-700 active:bg-petrol-800 shadow-[0_1px_0_rgb(7_58_73/0.4)]',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-linen hover:border-petrol-200',
  ghost: 'text-petrol-700 hover:bg-petrol-50',
  danger: 'bg-risk-500 text-white hover:bg-risk-700',
  success: 'bg-ok-500 text-white hover:bg-ok-700',
  soft: 'bg-petrol-50 text-petrol-700 hover:bg-petrol-100',
};
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-[14px]',
  md: 'h-11 px-4 text-[15px]',
  lg: 'h-13 px-6 text-[16px] min-h-[52px]',
};

export function btnClass(variant: Variant = 'primary', size: Size = 'md', extra = '') {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  loading?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', icon: Icon, loading, children, className = '', disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={btnClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden /> : Icon ? <Icon className="h-[18px] w-[18px]" aria-hidden /> : null}
      {children}
    </button>
  );
});

export function ButtonLink({ variant = 'primary', size = 'md', icon: Icon, children, className = '', ...rest }: LinkProps & { variant?: Variant; size?: Size; icon?: LucideIcon }) {
  return (
    <Link className={btnClass(variant, size, className)} {...rest}>
      {Icon ? <Icon className="h-[18px] w-[18px]" aria-hidden /> : null}
      {children}
    </Link>
  );
}

export function IconButton({ icon: Icon, label, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={`inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-btn)] text-muted hover:bg-petrol-50 hover:text-petrol-700 ${className}`} {...rest}>
      <Icon className="h-5 w-5" aria-hidden />
    </button>
  );
}
