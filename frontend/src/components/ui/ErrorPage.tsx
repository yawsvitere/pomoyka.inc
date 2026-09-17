import { Link } from "react-router-dom";
import { Audio, AudioPlayer, AudioSkin } from "@videojs/react/audio";
import "@videojs/react/audio/skin.css";
import "../../styles/components/error-page.css";

type ErrorPageProps = {
  status: 404 | 500;
  title?: string;
  description?: string;
};

const defaultContent = {
  404: {
    title: "Страница не найдена",
  },
  500: {
    title: "Доступ ограничен",
  },
} as const;

export function ErrorPage({ status, title, description }: ErrorPageProps) {
  const content = defaultContent[status];

  return (
    <main className="error-page">
      <div className="error-page-content">
        
        <span className="error-page-status">{status}</span>
        <h1>{title ?? content.title}</h1>
        {description && <p>{description}</p>}
        <img className="error-page-image" src="/eror.jpg" alt="eror" />
        <div className="error-page-audio">
          <AudioPlayer>
            <AudioSkin>
              <Audio src="/eror.mp3" playsInline />
            </AudioSkin>
          </AudioPlayer>
        </div>


        <Link to="/">Вернуться на главную</Link>
      </div>
    </main>
  );
}