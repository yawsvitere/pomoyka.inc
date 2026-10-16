import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AuthLayout } from "../components/auth/AuthLayout";
import { useToast } from "../components/ui/useToast";
import { useAuth } from "../context/AuthContext";
import eyeOffIcon from "../assets/icons/eye-off-outline.svg";
import eyeOpenIcon from "../assets/icons/eye-open.svg";

type AuthMode = "login" | "register";

export function AuthPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode: AuthMode =
    searchParams.get("mode") === "register" ? "register" : "login";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [code, setCode] = useState("");
  const [registrationStep, setRegistrationStep] = useState<"code" | "details">(
    "code",
  );
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirmation, setShowPasswordConfirmation] =
    useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login, register } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();

  function changeMode(nextMode: AuthMode) {
    setSearchParams(nextMode === "login" ? {} : { mode: nextMode });
    if (nextMode === "register") {
      setRegistrationStep("code");
      setInviteCode("");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        if (registrationStep === "code") {
          if (!/^\w{4}-\w{4}-\w{4}$/.test(code)) {
            notify("error", "Введите код в формате XXXX-XXXX-XXXX");
            return;
          }

          const authApi = await import("../api/auth");
          await authApi.verifyInviteCode(code);
          setInviteCode(code);
          setRegistrationStep("details");
          return;
        }

        if (password.length < 8) {
          notify("error", "Пароль должен содержать не менее 8 символов.");
          return;
        }

        if (password !== passwordConfirmation) {
          notify(
            "error",
            "Пароли не совпадают. Проверь оба поля и попробуй еще раз.",
          );
          return;
        }

        await register(email, password, displayName, inviteCode);
      }

      navigate("/");
    } catch (err: any) {
      if (mode === "login") {
        notify("error", err.response?.data?.message ?? "Не удалось войти");
      } else if (registrationStep === "code") {
        notify("error", err.response?.data?.message ?? "Неверный код");
      } else {
        const errors = err.response?.data?.errors;
        notify(
          "error",
          errors
            ? errors.join(", ")
            : (err.response?.data?.message ?? "Не удалось зарегистрироваться"),
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const isEnteringCode = mode === "register" && registrationStep === "code";
  const title = mode === "login"
    ? "Войти"
    : isEnteringCode
      ? "Введите код"
      : "Регистрация";

  return (
    <AuthLayout title={title}>
      <div className="auth-mode-switch" role="tablist" aria-label="Авторизация">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "login"}
          onClick={() => changeMode("login")}
        >
          Вход
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "register"}
          onClick={() => changeMode("register")}
        >
          Регистрация
        </button>
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        {mode === "login" ? (
          <>
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
          </>
        ) : isEnteringCode ? (
          <input
            className="auth-input code-input"
            type="text"
            maxLength={14}
            placeholder="AB12-CD34-EF56"
            value={code}
            onChange={(e) => {
              const normalized = e.target.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, "")
                .slice(0, 12);
              setCode(normalized.match(/.{1,4}/g)?.join("-") ?? "");
            }}
            required
            autoFocus
          />
        ) : (
          <>
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
            <div className="auth-password-field">
              <input
                className="auth-input"
                type={showPasswordConfirmation ? "text" : "password"}
                placeholder="Повторите пароль"
                value={passwordConfirmation}
                onChange={(e) => setPasswordConfirmation(e.target.value)}
                required
              />
              <button
                className="auth-password-toggle"
                type="button"
                aria-label={
                  showPasswordConfirmation ? "Скрыть пароль" : "Показать пароль"
                }
                onClick={() =>
                  setShowPasswordConfirmation((visible) => !visible)
                }
              >
                <img
                  src={showPasswordConfirmation ? eyeOpenIcon : eyeOffIcon}
                  alt=""
                />
              </button>
            </div>
          </>
        )}

        <button className="auth-button" type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? mode === "login"
              ? "Входим..."
              : isEnteringCode
                ? "Проверяем..."
                : "Регистрируем..."
            : mode === "login"
              ? "Войти"
              : isEnteringCode
                ? "Продолжить"
                : "Создать аккаунт"}
        </button>
      </form>

      {isEnteringCode && (
        <p className="auth-description">
          Введите код приглашения, который вам предоставили.
        </p>
      )}
      {mode === "register" && !isEnteringCode && (
        <p className="auth-description">
          Нажимая «Создать аккаунт», вы соглашаетесь с правилами и условиями
          использования.
        </p>
      )}
    </AuthLayout>
  );
}
