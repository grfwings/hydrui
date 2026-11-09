import "./index.css";

interface PushButtonProps {
  children: React.ReactNode;
  className?: string;
  id?: string;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger" | "muted" | undefined;
}

const PushButton: React.FC<PushButtonProps> = ({
  children,
  className,
  id,
  onClick,
  disabled,
  variant = "primary",
}: PushButtonProps) => {
  return (
    <button
      id={id}
      className={`push-button ${className ?? ""} ${variant}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
};

export default PushButton;
