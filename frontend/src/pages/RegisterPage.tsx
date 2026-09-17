import { useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { AuthLayout } from "../components/auth/AuthLayout";

export function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const codeVerified = location.state?.codeVerified === true;
  const inviteCode = location.state?.inviteCode ?? "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setError("");

    if (password !== passwordConfirmation) {
      setError("Пароли не совпадают. Проверь оба поля и попробуй еще раз.");
      return;
    }

    setIsSubmitting(true);

    try {
      await register(email, password, displayName, inviteCode);

      navigate("/");
    } catch (err: any) {
      const errors = err.response?.data?.errors;

      setError(
        errors
          ? errors.join(", ")
          : (err.response?.data?.message ?? "Не удалось зарегистрироваться"),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!codeVerified) {
    navigate("/register/code", {
      replace: true,
    });

    return null;
  }

  return (
    <AuthLayout
      title="Регистрация"
      bottom={
        <>
          Уже есть аккаунт?{" "}
          <Link className="auth-link" to="/login">
            Войти
          </Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={handleSubmit}>
        <input
          className="auth-input"
          type="text"
          placeholder="Имя"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />

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
            placeholder="Пароль (мин. 8 символов)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          <button
            className="auth-password-toggle"
            type="button"
            aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
            onClick={() => setShowPassword((visible) => !visible)}
          >
            {showPassword ? "◉" : "◌"}
          </button>
        </div>

        <div className="auth-password-field">
          <input
            className="auth-input"
            type={showPasswordConfirmation ? "text" : "password"}
            placeholder="Повторите пароль"
            value={passwordConfirmation}
            onChange={(e) => setPasswordConfirmation(e.target.value)}
            required
            minLength={8}
          />
          <button
            className="auth-password-toggle"
            type="button"
            aria-label={showPasswordConfirmation ? "Скрыть пароль" : "Показать пароль"}
            onClick={() => setShowPasswordConfirmation((visible) => !visible)}
          >
            {showPasswordConfirmation ? "◉" : "◌"}
          </button>
        </div>

        {error && <p className="auth-error">{error}</p>}

        <button className="auth-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Регистрируем..." : "Создать аккаунт"}
        </button>
      </form>

      <p className="auth-description">
        Нажимая «Создать аккаунт», вы соглашаетесь с правилами и условиями
        использования.
      </p>
    </AuthLayout>
  );
}
