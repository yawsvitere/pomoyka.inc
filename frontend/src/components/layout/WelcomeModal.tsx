import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useAuth } from "../../context/AuthContext";
import * as authApi from "../../api/auth";
import "../../styles/components/welcome-modal.css";

const PHOTO_DIR = "/welcome/";

const PHOTOS = {
  chaos1: { file: "chaos-1.jpg", hint: "самая проклятая фотка с тусы" },
  chaos2: { file: "chaos-2.jpg", hint: "смазанная вспышка, 4 утра" },
  chaos3: { file: "chaos-3.jpg", hint: "кот с лицом бизнесмена" },
  chaos4: {
    file: "chaos-4.jpg",
    hint: "скрин мема, который поймут только свои",
  },
  chaos5: { file: "chaos-5.jpg", hint: "групповое фото, где все моргнули" },
  feed: {
    file: "feed.jpg",
    hint: "то, что не стыдно кинуть в ленту: кот, еда, закат",
  },
  day: { file: "day.jpg", hint: "обложка дня: самая яркая фотка из архива" },
  vault1: { file: "vault-1.jpg", hint: "море, Анапа" },
  vault2: { file: "vault-2.jpg", hint: "закат, Анапа" },
  vault3: { file: "vault-3.jpg", hint: "кринж на пляже" },
  vault4: { file: "vault-4.jpg", hint: "еда, которую не стоило есть" },
  vault5: { file: "vault-5.jpg", hint: "селфи против солнца" },
  vault6: { file: "vault-6.jpg", hint: "случайный кадр из телефона" },
  ticket: { file: "ticket.jpg", hint: "та самая мем-аватарка" },
} as const;

type PhotoId = keyof typeof PHOTOS;

const slides = [
  {
    eyebrow: "тебя поместили в надёжное место",
    title: "Добро пожаловать",
    text: "Хочу представить вам новый проект. Сразу определимся: это не социальная сеть в привычном понимании, а место для свалки социальной истории.",
  },
  {
    eyebrow: "что здесь есть",
    title: "Шитпост тварь и постишки",
    text: "На главной — лента в виде мессенджера. Кидай что хочешь, а каждый день в 0:00 по мск она обнуляется.",
  },
  {
    eyebrow: "ничего не пропадёт",
    title: "Архив",
    text: "В полночь все шитпосты улетают в архив, и любой день можно открыть. А постишка — это пост в виде статьи, который остаётся навека, она появится в архиве и на странице постишек. Потыкай в дни.",
  },
  {
    eyebrow: "Шя маме скину фотки с Анапы",
    title: "Файлы",
    text: "Не только шитпосты: кидай сюда фотки, видосы и любые файлы. Всё лежит в одном месте и не теряется в чатах. Можно поделиться с братвой, оставить только для себя или скинуть маме.",
  },
  {
    title: "Теперь можно в интернет",
  },
];

const vars = (v: Record<string, string | number>) =>
  v as unknown as CSSProperties;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function plural(n: number, forms: [string, string, string]) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

const MSK_OFFSET = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function msUntilMskMidnight() {
  return DAY_MS - ((Date.now() + MSK_OFFSET) % DAY_MS);
}

function formatLeft(ms: number) {
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

function useScramble(text: string, active: boolean, delay = 420) {
  const [out, setOut] = useState("\u00A0");

  useEffect(() => {
    if (!active) return;
    if (reducedMotion()) {
      setOut(text);
      return;
    }
    const glyphs = "▓▒░#@%&*+<>/";
    const total = 30;
    let frame = 0;
    let raf = 0;
    setOut("\u00A0");

    const tick = () => {
      frame += 1;
      const progress = frame / total;
      setOut(
        [...text]
          .map((ch, i) =>
            ch === " " || i < progress * text.length
              ? ch
              : glyphs[Math.floor(Math.random() * glyphs.length)],
          )
          .join(""),
      );
      if (frame < total) raf = requestAnimationFrame(tick);
      else setOut(text);
    };

    const t = window.setTimeout(tick, delay);
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
    };
  }, [text, active, delay]);

  return out;
}

function Photo({ id, className = "" }: { id: PhotoId; className?: string }) {
  const photo = PHOTOS[id];
  const [failed, setFailed] = useState(false);

  return (
    <span className={`wm-photo ${className}`}>
      {failed ? (
        <span className="wm-photo-ph">
          <b>{photo.file}</b>
          <small>{photo.hint}</small>
        </span>
      ) : (
        <img
          src={PHOTO_DIR + photo.file}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

function SplitTitle({ text }: { text: string }) {
  let offset = 0;
  return (
    <>
      {text.split(" ").map((word, w) => {
        const start = offset;
        offset += word.length + 1;
        return (
          <span key={w}>
            <span className="wm-word">
              {[...word].map((ch, c) => (
                <span
                  key={c}
                  className="wm-char"
                  style={vars({ "--i": start + c })}
                >
                  {ch}
                </span>
              ))}
            </span>{" "}
          </span>
        );
      })}
    </>
  );
}

const POLAROIDS: {
  id: PhotoId;
  x: string;
  y: string;
  w: string;
  r: string;
  d: number;
  cap: string;
}[] = [
  {
    id: "chaos1",
    x: "0%",
    y: "12%",
    w: "36%",
    r: "-8deg",
    d: 26,
    cap: "без фильтров",
  },
  { id: "chaos2", x: "31%", y: "0%", w: "34%", r: "5deg", d: -16, cap: "4:12" },
  { id: "chaos3", x: "60%", y: "14%", w: "38%", r: "9deg", d: 34, cap: "ору" },
  {
    id: "chaos4",
    x: "9%",
    y: "50%",
    w: "40%",
    r: "4deg",
    d: -30,
    cap: "кринж",
  },
  {
    id: "chaos5",
    x: "50%",
    y: "52%",
    w: "38%",
    r: "-6deg",
    d: 18,
    cap: "было",
  },
];

function IntroScene() {
  const [top, setTop] = useState(2);

  return (
    <div className="wm-collage">
      {POLAROIDS.map((p, i) => (
        <button
          key={p.id}
          type="button"
          className="wm-polaroid"
          style={vars({
            "--x": p.x,
            "--y": p.y,
            "--w": p.w,
            "--r": p.r,
            "--d": p.d,
            "--k": i,
            zIndex: top === i ? 30 : i + 1,
          })}
          onClick={() => setTop(i)}
          aria-label={`Вытащить фото: ${p.cap}`}
        >
          <span className="wm-polaroid-in">
            <span className="wm-polaroid-float">
              <Photo id={p.id} className="wm-polaroid-photo" />
              <span className="wm-polaroid-cap">{p.cap}</span>
            </span>
          </span>
        </button>
      ))}

      <svg className="wm-badge" viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <path
            id="wm-circle"
            d="M60,60 m-46,0 a46,46 0 1,1 92,0 a46,46 0 1,1 -92,0"
          />
        </defs>
        <text className="wm-badge-ring">
          <textPath href="#wm-circle" textLength="286" lengthAdjust="spacing">
            тебя поместили ✦ в надёжное место ✦{" "}
          </textPath>
        </text>
        <text className="wm-badge-star" x="60" y="72" textAnchor="middle">
          ✦
        </text>
      </svg>
    </div>
  );
}

type Post = {
  id: number;
  text: string;
  me?: boolean;
  photo?: boolean;
  late?: boolean;
};

const SEED_POSTS: Post[] = [
  { id: 1, text: "шя сижу не могу понять наебал ли меня китаец", me: true },
  { id: 2, text: "как будто улыбаеца", photo: true },
  { id: 3, text: "прям" },
];

function FeedScene() {
  const [posts, setPosts] = useState<Post[]>(SEED_POSTS);
  const [phase, setPhase] = useState<"live" | "wiping" | "empty">("live");
  const [left, setLeft] = useState(msUntilMskMidnight);
  const timer = useRef(0);

  useEffect(() => {
    const t = window.setInterval(() => setLeft(msUntilMskMidnight()), 1000);
    return () => {
      clearInterval(t);
      clearTimeout(timer.current);
    };
  }, []);

  function skipToMidnight() {
    if (phase !== "live") return;
    setPhase("wiping");
    timer.current = window.setTimeout(() => {
      setPosts([]);
      setPhase("empty");
    }, 1500);
  }

  return (
    <div className="wm-phone">
      <div className="wm-phone-head">
        <span>
          <i className="wm-live" />
          лента сегодня
        </span>
        <span className={`wm-timer${phase === "wiping" ? " is-hot" : ""}`}>
          обнуление через {phase === "wiping" ? "00:00:00" : formatLeft(left)}
        </span>
      </div>

      <div className={`wm-feed${phase === "wiping" ? " is-wiping" : ""}`}>
        {phase === "empty" && (
          <div className="wm-empty">
            <b>✦</b>
            <span>чисто. всё улетело в архив</span>
            <span>лента обнулилась</span>
          </div>
        )}
        {posts.map((p, i) => (
          <div
            key={p.id}
            className={`wm-bubble${p.me ? " is-me" : ""}${p.late ? " is-late" : ""}`}
            style={vars({ "--n": i })}
          >
            <small>{p.me ? "ты" : "кто-то"}</small>
            {p.text}
            {p.photo && <Photo id="feed" className="wm-bubble-photo" />}
          </div>
        ))}
      </div>

      <div className="wm-phone-actions">
        <button
          className="wm-pill"
          type="button"
          onClick={skipToMidnight}
          disabled={phase !== "live"}
        >
          ⏭ дождаться 00:00
        </button>
      </div>
    </div>
  );
}

const WEEK = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

const POST_TITLES: Record<number, string> = {
  4: "день, когда всё пошло не по плану",
  11: "мы застряли в лифте. втроём",
  17: "шашлыки, ровно три часа",
  23: "переезд, коробки, кринж",
};

const DAYS = Array.from({ length: 28 }, (_, i) => {
  const n = i + 1;
  const r = Math.abs(Math.sin(n * 12.9898) * 43758.5453) % 1;
  return { n, shits: r < 0.16 ? 0 : Math.round(r * 24) + 1 };
});

function ArchiveScene() {
  const [sel, setSel] = useState(11);

  const day = DAYS[sel - 1];
  const title = POST_TITLES[sel] ?? "твой день ещё ждёт записи";

  return (
    <div className="wm-archive">
      <div className="wm-cal" role="group" aria-label="Архив по дням">
        {WEEK.map((w) => (
          <span key={w} className="wm-cal-wd">
            {w}
          </span>
        ))}
        {DAYS.map((d, i) => {
          const post = d.n in POST_TITLES;
          return (
            <button
              key={d.n}
              type="button"
              className={`wm-day${post ? " is-post" : ""}${d.shits >= 16 ? " is-hot" : ""}${sel === d.n ? " is-sel" : ""}`}
              style={vars({
                "--lvl": Math.round((d.shits / 25) * 64),
                "--c": i % 7,
                "--r": Math.floor(i / 7),
              })}
              onClick={() => setSel(d.n)}
              aria-label={`${d.n} число: ${d.shits} ${plural(d.shits, ["шитпост", "шитпоста", "шитпостов"])}${post ? ", есть постишка" : ""}`}
              aria-pressed={sel === d.n}
            >
              <span>{d.n}</span>
            </button>
          );
        })}
      </div>

      <div className="wm-daycard" key={sel}>
        <Photo id="day" className="wm-day-thumb" />
        <div className="wm-daycard-body">
          <b>{sel} число</b>
          <span>
            в архиве: {day.shits}{" "}
            {plural(day.shits, ["шитпост", "шитпоста", "шитпостов"])}
          </span>
          <span className="wm-daycard-post">★ {title}</span>
        </div>
      </div>
    </div>
  );
}

const VAULT: {
  id: PhotoId;
  name: string;
  fx: number;
  fy: number;
  fr: number;
}[] = [
  { id: "vault1", name: "IMG_2041.jpg", fx: -160, fy: -300, fr: -25 },
  { id: "vault2", name: "IMG_2042.jpg", fx: 0, fy: -340, fr: 12 },
  { id: "vault3", name: "IMG_2047.jpg", fx: 160, fy: -300, fr: 30 },
  { id: "vault4", name: "IMG_2051.jpg", fx: -140, fy: -160, fr: -18 },
  { id: "vault5", name: "IMG_2058.jpg", fx: 20, fy: -210, fr: 22 },
  { id: "vault6", name: "IMG_2060.jpg", fx: 180, fy: -180, fr: -30 },
];

function VaultScene() {
  const [done, setDone] = useState(0);

  useEffect(() => {
    setDone(0);
    const ts = VAULT.map((_, i) =>
      window.setTimeout(() => setDone((c) => c + 1), 1650 + i * 140),
    );
    return () => ts.forEach(clearTimeout);
  }, []);

  return (
    <div className="wm-vault">
      <div className="wm-drop">
        <p className="wm-drop-label">фотки с анапы</p>
        <div className="wm-tiles">
          {VAULT.map((f, i) => (
            <div
              key={f.id}
              className="wm-tile"
              style={vars({
                "--k": i,
                "--fx": `${f.fx}px`,
                "--fy": `${f.fy}px`,
                "--fr": `${f.fr}deg`,
              })}
            >
              <Photo id={f.id} className="wm-tile-photo" />
              <span className="wm-tile-ok" aria-hidden="true">
                ✓
              </span>
              <span className="wm-tile-meta">
                {f.name}
                <span className="wm-bar" />
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="wm-vault-foot">
        <span>
          загружено <b>{done}</b> из {VAULT.length}
        </span>
      </div>
    </div>
  );
}

function StartScene({
  name,
  imageUrl,
}: {
  name?: string | null;
  imageUrl?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const motionSeen = useRef(false);
  const motionBase = useRef<{ beta: number; gamma: number } | null>(null);
  const [motionStatus, setMotionStatus] = useState<
    "idle" | "requesting" | "active" | "denied" | "unavailable"
  >("idle");

  useEffect(() => {
    if (
      (motionStatus !== "requesting" && motionStatus !== "active") ||
      typeof window === "undefined"
    )
      return;

    const onOrientation = (e: DeviceOrientationEvent) => {
      const el = ref.current;
      if (!el || e.beta === null || e.gamma === null) return;
      motionSeen.current = true;
      setMotionStatus("active");
      if (!motionBase.current) {
        motionBase.current = { beta: e.beta, gamma: e.gamma };
        return;
      }
      const beta = Math.max(
        -45,
        Math.min(45, e.beta - motionBase.current.beta),
      );
      const gamma = Math.max(
        -45,
        Math.min(45, e.gamma - motionBase.current.gamma),
      );
      el.style.setProperty("--rx", `${(beta / 45) * -18}deg`);
      el.style.setProperty("--ry", `${(gamma / 45) * 24}deg`);
      el.style.setProperty("--sx", `${50 + (gamma / 45) * 35}%`);
      el.style.setProperty("--sy", `${50 + (beta / 45) * 35}%`);
      el.style.setProperty("--ang", `${120 + gamma * 2}deg`);
    };

    window.addEventListener("deviceorientation", onOrientation, {
      passive: true,
    });
    const timeout =
      motionStatus === "requesting"
        ? window.setTimeout(() => {
            if (!motionSeen.current) setMotionStatus("unavailable");
          }, 2500)
        : undefined;

    return () => {
      window.removeEventListener("deviceorientation", onOrientation);
      if (timeout !== undefined) clearTimeout(timeout);
    };
  }, [motionStatus]);

  async function enableMotion() {
    if (
      !window.isSecureContext ||
      typeof DeviceOrientationEvent === "undefined"
    ) {
      setMotionStatus("unavailable");
      return;
    }

    setMotionStatus("requesting");
    motionSeen.current = false;
    motionBase.current = null;

    const orientation =
      DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<"granted" | "denied">;
      };

    if (orientation.requestPermission) {
      let permission: "granted" | "denied";
      try {
        permission = await orientation.requestPermission();
      } catch {
        setMotionStatus("denied");
        return;
      }
      if (permission !== "granted") {
        setMotionStatus("denied");
        return;
      }
    }
  }

  useEffect(() => {
    void enableMotion();
  }, []);

  function onMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse") return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--rx", `${((0.5 - y) * 16).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${((x - 0.5) * 20).toFixed(2)}deg`);
    el.style.setProperty("--sx", `${(x * 100).toFixed(1)}%`);
    el.style.setProperty("--sy", `${(y * 100).toFixed(1)}%`);
    el.style.setProperty("--ang", `${Math.round(x * 360)}deg`);
  }

  function onLeave() {
    const el = ref.current;
    if (!el) return;
    ["--rx", "--ry", "--sx", "--sy", "--ang"].forEach((p) =>
      el.style.removeProperty(p),
    );
  }

  return (
    <div className="wm-ticket-scene">
      <div className="wm-ticket-wrap">
        <div
          className="wm-ticket"
          ref={ref}
          onPointerMove={onMove}
          onPointerLeave={onLeave}
        >
          <div className="wm-ticket-top">
            <b>пропуск</b>
            <span>помойка.inc</span>
          </div>
          {imageUrl ? (
            <img
              className="wm-ticket-photo"
              src={`${import.meta.env.VITE_API_URL ?? ""}${imageUrl}`}
              alt=""
              draggable={false}
            />
          ) : (
            <Photo id="ticket" className="wm-ticket-photo" />
          )}
          <div className="wm-ticket-name">
            <small>участник</small>
            <strong>{name || "гость"}</strong>
          </div>
          <div className="wm-ticket-bar" aria-hidden="true" />
          <small className="wm-ticket-foot">действует, пока не надоест</small>
        </div>
      </div>
    </div>
  );
}

interface WelcomeModalProps {
  open: boolean;
  onClose: () => void;
  welcomeName?: string | null;
}

export function WelcomeModal({
  open,
  onClose,
  welcomeName,
}: WelcomeModalProps) {
  const { updateUser, user } = useAuth();
  const [slideIndex, setSlideIndex] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [wipeKey, setWipeKey] = useState(0);
  const [leaving, setLeaving] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const timers = useRef<number[]>([]);
  const touchX = useRef<number | null>(null);

  const slide = slides[slideIndex];
  const isLastSlide = slideIndex === slides.length - 1;
  const title =
    slideIndex === 0 && welcomeName
      ? `Добро пожаловать, ${welcomeName}`
      : slide.title;
  const eyebrow = useScramble(slide.eyebrow ?? "", open);

  const confetti = useMemo(() => {
    const glyphs = ["✦", "↗", "▦", "→", "★", "✺"];
    return Array.from({ length: 42 }, (_, i) => {
      const a = Math.PI * (1.05 + Math.random() * 0.9);
      const d = 220 + Math.random() * 520;
      return {
        g: glyphs[i % glyphs.length],
        x: Math.cos(a) * d,
        y: Math.sin(a) * d,
        r: Math.round(Math.random() * 720 - 360),
        s: 16 + Math.round(Math.random() * 26),
        dl: Math.round(Math.random() * 140),
        hot: i % 3 !== 0,
      };
    });
  }, []);

  function later(fn: () => void, ms: number) {
    timers.current.push(window.setTimeout(fn, ms));
  }

  function go(to: number) {
    if (
      busy.current ||
      leaving ||
      to === slideIndex ||
      to < 0 ||
      to >= slides.length
    )
      return;
    setDir(to > slideIndex ? 1 : -1);
    if (reducedMotion()) {
      setSlideIndex(to);
      return;
    }
    busy.current = true;
    setWipeKey((k) => k + 1);
    later(() => setSlideIndex(to), 340);
    later(() => {
      busy.current = false;
    }, 780);
  }

  function forward() {
    if (!isLastSlide) go(slideIndex + 1);
  }

  function back() {
    go(slideIndex - 1);
  }

  async function finish() {
    try {
      const updatedUser = await authApi.markWelcomeAsSeen();
      updateUser(updatedUser);
    } finally {
      onClose();
    }
  }

  function next() {
    if (!isLastSlide) {
      go(slideIndex + 1);
      return;
    }
    if (leaving) return;
    setLeaving(true);
    later(() => void finish(), reducedMotion() ? 0 : 1150);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse") return;
    const el = rootRef.current;
    if (!el) return;
    el.style.setProperty("--mx", `${e.clientX}px`);
    el.style.setProperty("--my", `${e.clientY}px`);
    el.style.setProperty(
      "--px",
      ((e.clientX / window.innerWidth) * 2 - 1).toFixed(3),
    );
    el.style.setProperty(
      "--py",
      ((e.clientY / window.innerHeight) * 2 - 1).toFixed(3),
    );
  }

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;

    if (!open) {
      setSlideIndex(0);
      setDir(1);
      setWipeKey(0);
      setLeaving(false);
      busy.current = false;
    } else {
      document.body.style.overflow = "hidden";
      rootRef.current?.focus();
    }
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [open]);

  // клавиатура: стрелки листают, Esc закрывает
  const live = useRef({ forward, back, onClose });
  live.current = { forward, back, onClose };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") live.current.forward();
      else if (e.key === "ArrowLeft") live.current.back();
      else if (e.key === "Escape") live.current.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={rootRef}
      className={`wm${leaving ? " is-leaving" : ""}`}
      data-dir={dir}
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      tabIndex={-1}
      onPointerMove={onPointerMove}
      onTouchStart={(e) => {
        touchX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 70) {
          if (dx < 0) forward();
          else back();
        }
      }}
    >
      {/* фон */}
      <div className="wm-fx wm-spot" aria-hidden="true" />
      <div className="wm-fx wm-grain" aria-hidden="true" />
      <div className="wm-bignum" key={`num-${slideIndex}`} aria-hidden="true">
        {String(slideIndex + 1).padStart(2, "0")}
      </div>

      {/* верх */}
      <header className="wm-top">
        <span className="wm-logo">
          помойка<b>.inc</b>
        </span>
        <div
          className="wm-progress"
          aria-label={`Слайд ${slideIndex + 1} из ${slides.length}`}
        >
          {slides.map((item, index) => (
            <button
              key={item.title}
              type="button"
              className={`wm-seg${index <= slideIndex ? " is-on" : ""}`}
              onClick={() => go(index)}
              aria-label={`Перейти к слайду ${index + 1}`}
              aria-current={index === slideIndex ? "step" : undefined}
            />
          ))}
        </div>
        <button
          className="wm-close"
          type="button"
          onClick={onClose}
          aria-label="Закрыть приветствие"
        >
          ×
        </button>
      </header>

      {/* слайд */}
      <main
        className={`wm-main wm-slide-${slideIndex}${isLastSlide ? " is-last" : ""}`}
        key={`slide-${slideIndex}`}
      >
        <div className="wm-copy">
          <p className="wm-eyebrow">{eyebrow}</p>
          <h2 id="welcome-title" className="wm-title" aria-label={title}>
            <span className="wm-title-full" aria-hidden="true">
              <SplitTitle text={title} />
            </span>
            {slideIndex === 1 && (
              <span className="wm-title-mobile" aria-hidden="true">
                <SplitTitle text="Шитпост" />
              </span>
            )}
          </h2>
          <p className="wm-text">{slide.text}</p>
        </div>

        <div className="wm-scene">
          {slideIndex === 0 && <IntroScene />}
          {slideIndex === 1 && <FeedScene />}
          {slideIndex === 2 && <ArchiveScene />}
          {slideIndex === 3 && <VaultScene />}
          {slideIndex === 4 && (
            <StartScene
              name={welcomeName}
              imageUrl={user?.welcomeImageUrl ?? null}
            />
          )}
        </div>

        {slideIndex === 0 && (
          <button
            className="wm-swipe-hint"
            type="button"
            onClick={forward}
            aria-label="Перейти к следующему слайду"
          />
        )}
      </main>

      {/* низ */}
      <footer className={`wm-foot${isLastSlide ? " is-final" : ""}`}>
        <div className="wm-nav">
          <button
            className="wm-prev"
            type="button"
            onClick={back}
            disabled={slideIndex === 0}
            aria-label="Назад"
          >
            ←
          </button>
          <button
            className={`btn btn-primary wm-next${isLastSlide ? " is-final" : ""}`}
            type="button"
            onClick={next}
          >
            {isLastSlide ? "Войти в помойку" : "Дальше"}
            {!isLastSlide && <span aria-hidden="true">→</span>}
          </button>
        </div>
      </footer>

      {/* переход между слайдами */}
      {wipeKey > 0 && (
        <>
          <div key={`a${wipeKey}`} className="wm-wipe" aria-hidden="true" />
          <div
            key={`b${wipeKey}`}
            className="wm-wipe is-2"
            aria-hidden="true"
          />
        </>
      )}

      {/* салют на финише */}
      {leaving && (
        <div className="wm-confetti" aria-hidden="true">
          {confetti.map((c, i) => (
            <span
              key={i}
              className={c.hot ? "is-hot" : undefined}
              style={vars({
                "--x": `${c.x}px`,
                "--y": `${c.y}px`,
                "--r": `${c.r}deg`,
                "--s": `${c.s}px`,
                "--dl": `${c.dl}ms`,
              })}
            >
              {c.g}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
