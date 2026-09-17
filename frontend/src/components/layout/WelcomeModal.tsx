import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import * as authApi from "../../api/auth";
import "../../styles/components/welcome-modal.css";

const slides = [
  {
    number: "01",
    eyebrow: "тебя пригласили в надёжное место",

    text: "Хочу представить вам новый проект, помойка.inc. Для начала определимся, это не социальная сеть в привычном понимании, а место для слепка вашей социальной активности .",
    accent: "✦",
  },
  {
    number: "02",
    eyebrow: "что здесь есть",
    title: "Шитпост тварь и постишки",
    text: "На главной вы можете увидеть некую ленту в виде мессенджера, лента обнуляеться каждый день в 0:00 по мск. А нажав кнопку постишка вы можете написать пост в виде статьи который останеться навека, так можете отметить событие задним числом и он отобразиться в архиве и на странице постишек.",
    accent: "↗",
  },
  {
    number: "03",
    eyebrow: "ничего не пропадёт",
    title: "Архив",
    text: "Каждый день в архив улетают все шитпосты, но так же отмечаються постишки которые были написаны в этот день, так что вы можете вернуться к ним в любое время. Но так же они будут на странице постишек. А события, будут храниться задним числом",
    accent: "▦",
  },
    {
    number: "04",
    eyebrow: "Шя маме скину фотки с Анапы",
    title: "Файлохранилище",
    text: "Каждый день в архив улетают все шитпосты, но так же отмечаються постишки которые были написаны в этот день, так что вы можете вернуться к ним в любое время. Но так же они будут на странице постишек. А события, будут храниться задним числом",
    accent: "▦",
  },
  {
    number: "05",
    eyebrow: "начинаем",
    title: "Твоя очередь",
    text: "Загляни в ленту, найди людей и оставь первую постишку. Здесь можно быть собой и не полировать каждую мысль.",
    accent: "→",
  },
];

interface WelcomeModalProps {
  open: boolean;
  onClose: () => void;
  welcomeName?: string | null;
}

export function WelcomeModal({ open, onClose, welcomeName }: WelcomeModalProps) {
  const { updateUser } = useAuth();
  const [slideIndex, setSlideIndex] = useState(0);
  const slide = slides[slideIndex];
  const isLastSlide = slideIndex === slides.length - 1;

  useEffect(() => {
    if (!open) setSlideIndex(0);
  }, [open]);

  if (!open) return null;

  async function finish() {
    try {
      const updatedUser = await authApi.markWelcomeAsSeen();
      updateUser(updatedUser);
    } finally {
      onClose();
    }
  }

  function next() {
    if (isLastSlide) {
      void finish();
      return;
    }
    setSlideIndex((current) => current + 1);
  }

  return (
    <div className="welcome-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="welcome-modal" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <button className="welcome-modal-close" type="button" onClick={onClose} aria-label="Закрыть приветствие">
          ×
        </button>
        <div className="welcome-modal-visual" aria-hidden="true">
          <span className="welcome-modal-mark">{slide.accent}</span>
          <span className="welcome-modal-index">{slide.number} / 05</span>
        </div>
        <div className="welcome-modal-content">
          <p className="welcome-modal-eyebrow">{slide.eyebrow}</p>
          <h2 id="welcome-title">{slideIndex === 0 && welcomeName ? `Добро пожаловать ${welcomeName}` : slide.title}</h2>
          <p className="welcome-modal-text">{slide.text}</p>
          <div className="welcome-modal-footer">
            <div className="welcome-modal-dots" aria-label={`Слайд ${slideIndex + 1} из ${slides.length}`}>
              {slides.map((item, index) => (
                <button
                  key={item.number}
                  className={`welcome-modal-dot${index === slideIndex ? " is-active" : ""}`}
                  type="button"
                  onClick={() => setSlideIndex(index)}
                  aria-label={`Перейти к слайду ${index + 1}`}
                />
              ))}
            </div>
            <button className="btn btn-primary welcome-modal-next" type="button" onClick={next}>
              {isLastSlide ? "Войти в помойку" : "Дальше"}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}