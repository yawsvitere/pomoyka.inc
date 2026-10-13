import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "../components/auth/AuthLayout";
import { useToast } from "../components/ui/useToast";
import * as authApi from "../api/auth";

export function CodePage() {
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { notify } = useToast();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!/^\w{4}-\w{4}-\w{4}$/.test(code)) {
      const message = "Введите код в формате XXXX-XXXX-XXXX";
      notify("error", message);
      return;
    }

    setIsSubmitting(true);

    try {
      await authApi.verifyInviteCode(code);
      navigate("/register", {
        state: {
          codeVerified: true,
          inviteCode: code,
        },
      });
    } catch (err: any) {
      const message = err.response?.data?.message ?? "Неверный код";
      notify("error", message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Введите код"
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
          autoFocus
        />

        <button className="auth-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Проверяем..." : "Продолжить"}
        </button>
      </form>

      <p className="auth-description">
        Введите код приглашения, который вам предоставили.
      </p>
    </AuthLayout>
  );
}
