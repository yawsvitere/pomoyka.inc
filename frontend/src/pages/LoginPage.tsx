import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { AuthLayout } from "../components/auth/AuthLayout";
import { useToast } from "../components/ui/useToast";
import eyeOffIcon from "../assets/icons/eye-off-outline.svg";
import eyeOpenIcon from "../assets/icons/eye-open.svg";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setIsSubmitting(true);

    try {
      await login(email, password);
      navigate("/");
    } catch (err: any) {
      const message = err.response?.data?.message ?? "Не удалось войти";
      notify("error", message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Войти"
      bottom={
        <>
          Нет аккаунта?{" "}
          <Link className="auth-link" to="/register/code">
            Регистрация
          </Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={handleSubmit}>
        <input
          className="auth-input"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <div className="auth-password-field">
          <input
            className="auth-input"
            type={showPassword ? "text" : "password"}
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            className="auth-password-toggle"
            type="button"
            aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
            onClick={() => setShowPassword((visible) => !visible)}
          >
            <img src={showPassword ? eyeOpenIcon : eyeOffIcon} alt="" />
          </button>
        </div>

        <button className="auth-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Входим..." : "Войти"}
        </button>
      </form>
    </AuthLayout>
  );
}
