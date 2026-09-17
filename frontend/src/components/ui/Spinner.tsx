type SpinnerProps = {
  label?: string;
  className?: string;
};

export function Spinner({ label = "Загрузка", className }: SpinnerProps) {
  return (
    <span
      className={className ? `spinner ${className}` : "spinner"}
      role="status"
      aria-label={label}
    />
  );
}
